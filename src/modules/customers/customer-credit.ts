import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

type CreditClient = Pick<Prisma.TransactionClient, 'invoice' | 'posSale' | 'organization'>;
type CreditTransaction = Pick<Prisma.TransactionClient, '$executeRaw'>;

export async function lockCustomerCredit(
  tx: CreditTransaction,
  organizationId: string,
  customerId: string,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer-credit:${organizationId}:${customerId}`}))`;
}

export async function customerCreditExposure(
  tx: CreditClient,
  organizationId: string,
  customerId: string,
) {
  const { baseCurrency } = await tx.organization.findUniqueOrThrow({
    where: { id: organizationId }, select: { baseCurrency: true },
  });
  const [invoices, foreignCurrencyInvoices, creditSales] = await Promise.all([
    tx.invoice.aggregate({
      where: {
        organizationId,
        customerId,
        currency: baseCurrency,
        status: { notIn: ['DRAFT', 'VOID'] },
      },
      _sum: { total: true, paidAmount: true, creditedAmount: true },
    }),
    tx.invoice.groupBy({
      by: ['currency'],
      where: {
        organizationId,
        customerId,
        currency: { not: baseCurrency },
        status: { notIn: ['DRAFT', 'VOID'] },
      },
      _sum: { total: true, paidAmount: true, creditedAmount: true },
    }),
    tx.posSale.findMany({
      where: {
        organizationId,
        customerId,
        status: 'COMPLETED',
        payments: { some: { method: 'CREDIT', status: 'APPROVED' } },
      },
      select: {
        payments: { where: { method: 'CREDIT', status: 'APPROVED' }, select: { amount: true } },
        returns: { select: { creditAmount: true } },
      },
    }),
  ]);
  const unresolvedForeignCurrencies = foreignCurrencyInvoices
    .filter((invoice) => new Prisma.Decimal(invoice._sum.total ?? 0)
      .sub(invoice._sum.paidAmount ?? 0)
      .sub(invoice._sum.creditedAmount ?? 0)
      .gt(0))
    .map((invoice) => invoice.currency);
  if (unresolvedForeignCurrencies.length)
    throw new BadRequestException(
      `Customer has outstanding invoices in ${unresolvedForeignCurrencies.join(', ')}. Settle them before extending additional credit; credit limits are tracked in ${baseCurrency}.`,
    );
  const invoicedExposure = new Prisma.Decimal(invoices._sum.total ?? 0)
    .sub(invoices._sum.paidAmount ?? 0)
    .sub(invoices._sum.creditedAmount ?? 0);
  const posExposure = creditSales.reduce((sum, sale) => {
    const credit = sale.payments.reduce((value, payment) => value.add(payment.amount), new Prisma.Decimal(0));
    const creditReturned = sale.returns.reduce(
      (value, returned) => value.add(returned.creditAmount),
      new Prisma.Decimal(0),
    );
    return sum.add(Prisma.Decimal.max(new Prisma.Decimal(0), credit.sub(creditReturned)));
  }, new Prisma.Decimal(0));
  return Prisma.Decimal.max(new Prisma.Decimal(0), invoicedExposure).add(posExposure);
}

export function requireCreditOverride(
  actor: { role: string; permissions?: string[] },
  requested: boolean | undefined,
  reason: string | undefined,
) {
  if (!requested) throw new BadRequestException('Customer credit limit would be exceeded');
  const authorized = ['OWNER', 'ADMIN', 'APPROVER'].includes(actor.role) ||
    actor.permissions?.includes('credit.limit.approve') === true;
  if (!authorized) throw new ForbiddenException('You are not authorized to approve a credit limit exception');
  if (!reason?.trim()) throw new BadRequestException('An approval reason is required for a credit limit exception');
}
