import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SalesDocumentStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.ts';
import { CreditNoteDto, CreateQuotationDto, PaymentDto } from './dto/sales.dto.ts';
import { assertBranch } from '../../common/branch-scope.ts';
@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService) {}
  private totals(items: Array<{ quantity: number; unitPrice: number; taxRate?: number }>) {
    const subtotal = items.reduce(
      (s, x) => s.add(new Prisma.Decimal(x.quantity).mul(x.unitPrice)),
      new Prisma.Decimal(0),
    );
    const total = items.reduce((s, x) => {
      const base = new Prisma.Decimal(x.quantity).mul(x.unitPrice);
      return s.add(base.add(base.mul(x.taxRate ?? 0).div(100)));
    }, new Prisma.Decimal(0));
    return { subtotal, taxTotal: total.sub(subtotal), total };
  }
  private filter(org: string, q: Record<string, string>) {
    return {
      organizationId: org,
      ...(q.search
        ? {
            OR: [
              { number: { contains: q.search, mode: 'insensitive' as const } },
              { customer: { displayName: { contains: q.search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
      ...(q.status ? { status: q.status as never } : {}),
    };
  }
  async summary(org: string) {
    const [customers, quotes, invoices, payments, credits] = await this.prisma.$transaction([
      this.prisma.customer.count({ where: { organizationId: org, isActive: true } }),
      this.prisma.quotation.count({
        where: { organizationId: org, status: { notIn: ['CONVERTED', 'VOID'] } },
      }),
      this.prisma.invoice.aggregate({
        where: { organizationId: org, status: { not: 'VOID' } },
        _sum: { total: true, paidAmount: true, creditedAmount: true },
      }),
      this.prisma.paymentReceived.aggregate({
        where: { organizationId: org },
        _sum: { amount: true },
      }),
      this.prisma.creditNote.aggregate({
        where: { organizationId: org, isVoid: false },
        _sum: { amount: true },
      }),
    ]);
    const total = invoices._sum.total ?? new Prisma.Decimal(0),
      paid = invoices._sum.paidAmount ?? new Prisma.Decimal(0),
      credited = invoices._sum.creditedAmount ?? new Prisma.Decimal(0);
    return {
      customers,
      openQuotations: quotes,
      invoiced: total,
      received: payments._sum.amount ?? 0,
      credited: credits._sum.amount ?? 0,
      receivable: total.sub(paid).sub(credited),
    };
  }
  quotations(org: string, q: Record<string, string>) {
    return this.prisma.quotation.findMany({
      where: this.filter(org, q),
      include: { customer: true },
      orderBy: { createdAt: 'desc' },
    });
  }
  async createQuotation(org: string, d: CreateQuotationDto) {
    await assertBranch(this.prisma, org, d.branchId);
    if (!d.items.length) throw new BadRequestException('At least one line item is required');
    const customer = await this.prisma.customer.findFirst({
      where: { id: d.customerId, organizationId: org, isActive: true },
    });
    if (!customer) throw new BadRequestException('Customer not found');
    if (new Date(d.expiryDate) < new Date(d.issueDate))
      throw new BadRequestException('Expiry date cannot be before issue date');
    const currency = d.currency?.toUpperCase() ?? (await this.prisma.organization.findUniqueOrThrow({
      where: { id: org },
      select: { baseCurrency: true },
    })).baseCurrency;
    return this.prisma.quotation.create({
      data: {
        ...d,
        currency,
        organizationId: org,
        issueDate: new Date(d.issueDate),
        expiryDate: new Date(d.expiryDate),
        items: d.items as unknown as Prisma.InputJsonValue,
        ...this.totals(d.items),
      },
      include: { customer: true },
    });
  }
  async updateQuotation(org: string, id: string, d: CreateQuotationDto) {
    const row = await this.prisma.quotation.findFirst({ where: { id, organizationId: org } });
    if (!row) throw new NotFoundException('Quotation not found');
    if (row.status === 'CONVERTED')
      throw new BadRequestException('Converted quotation cannot be edited');
    return this.prisma.quotation.update({
      where: { id },
      data: {
        ...d,
        issueDate: new Date(d.issueDate),
        expiryDate: new Date(d.expiryDate),
        items: d.items as unknown as Prisma.InputJsonValue,
        ...this.totals(d.items),
      },
      include: { customer: true },
    });
  }
  async quotationStatus(org: string, id: string, status: string) {
    const allowed = Object.values(SalesDocumentStatus);
    if (!allowed.includes(status as SalesDocumentStatus))
      throw new BadRequestException('Invalid status');
    const row = await this.prisma.quotation.findFirst({ where: { id, organizationId: org } });
    if (!row) throw new NotFoundException('Quotation not found');
    return this.prisma.quotation.update({
      where: { id },
      data: { status: status as SalesDocumentStatus },
    });
  }
  async convertQuotation(org: string, id: string) {
    const quote = await this.prisma.quotation.findFirst({
      where: { id, organizationId: org },
      include: { customer: true },
    });
    if (!quote) throw new NotFoundException('Quotation not found');
    if (quote.status === 'CONVERTED' || quote.status === 'VOID')
      throw new BadRequestException('Quotation cannot be converted');
    const items = quote.items as unknown as Array<{
      description: string;
      quantity: number;
      unitPrice: number;
      taxRate: number;
    }>;
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.create({
        data: {
          organizationId: org,
          branchId: quote.branchId,
          customerId: quote.customerId,
          number: `INV-${Date.now()}`,
          status: 'DRAFT',
          currency: quote.currency,
          issueDate: new Date(),
          dueDate: new Date(Date.now() + 30 * 86400000),
          subtotal: quote.subtotal,
          taxTotal: quote.taxTotal,
          total: quote.total,
          notes: quote.notes,
          items: {
            create: items.map((x) => {
              const base = new Prisma.Decimal(x.quantity).mul(x.unitPrice);
              return { ...x, lineTotal: base.add(base.mul(x.taxRate ?? 0).div(100)) };
            }),
          },
        },
        include: { customer: true, items: true },
      });
      await tx.quotation.update({
        where: { id },
        data: { status: 'CONVERTED', convertedInvoiceId: invoice.id },
      });
      return invoice;
    });
  }
  payments(org: string, q: Record<string, string>) {
    return this.prisma.paymentReceived.findMany({
      where: {
        organizationId: org,
        ...(q.search
          ? {
              OR: [
                { reference: { contains: q.search, mode: 'insensitive' } },
                { customer: { displayName: { contains: q.search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: { customer: true, invoice: true },
      orderBy: { paymentDate: 'desc' },
    });
  }
  async recordPayment(org: string, d: PaymentDto) {
    await assertBranch(this.prisma, org, d.branchId);
    return this.prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findFirst({
        where: { id: d.invoiceId, organizationId: org, status: { not: 'VOID' } },
      });
      if (!inv) throw new NotFoundException('Invoice not found');
      const outstanding = inv.total.sub(inv.paidAmount).sub(inv.creditedAmount),
        amount = new Prisma.Decimal(d.amount);
      if (amount.gt(outstanding)) throw new BadRequestException('Payment exceeds invoice balance');
      const paid = inv.paidAmount.add(amount);
      const payment = await tx.paymentReceived.create({
        data: {
          ...d,
          organizationId: org,
          branchId: d.branchId ?? inv.branchId,
          customerId: inv.customerId,
          currency: inv.currency,
          paymentDate: new Date(d.paymentDate),
          amount,
        },
      });
      await tx.invoice.update({
        where: { id: inv.id },
        data: {
          paidAmount: paid,
          status: paid.add(inv.creditedAmount).gte(inv.total) ? 'PAID' : 'PARTIALLY_PAID',
        },
      });
      return payment;
    });
  }
  async reversePayment(org: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const p = await tx.paymentReceived.findFirst({ where: { id, organizationId: org } });
      if (!p) throw new NotFoundException('Payment not found');
      await tx.paymentReceived.delete({ where: { id } });
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id: p.invoiceId } }),
        paid = inv.paidAmount.sub(p.amount);
      await tx.invoice.update({
        where: { id: inv.id },
        data: {
          paidAmount: paid,
          status: paid.add(inv.creditedAmount).gte(inv.total)
            ? 'PAID'
            : paid.gt(0) || inv.creditedAmount.gt(0)
              ? 'PARTIALLY_PAID'
              : 'SENT',
        },
      });
      return { reversed: true };
    });
  }
  creditNotes(org: string, q: Record<string, string>) {
    return this.prisma.creditNote.findMany({
      where: {
        organizationId: org,
        ...(q.search
          ? {
              OR: [
                { number: { contains: q.search, mode: 'insensitive' } },
                { customer: { displayName: { contains: q.search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: { customer: true, invoice: true },
      orderBy: { issueDate: 'desc' },
    });
  }
  async createCreditNote(org: string, d: CreditNoteDto) {
    await assertBranch(this.prisma, org, d.branchId);
    return this.prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findFirst({
        where: { id: d.invoiceId, organizationId: org, status: { not: 'VOID' } },
      });
      if (!inv) throw new NotFoundException('Invoice not found');
      const amount = new Prisma.Decimal(d.amount),
        outstanding = inv.total.sub(inv.paidAmount).sub(inv.creditedAmount);
      if (amount.gt(outstanding)) throw new BadRequestException('Credit exceeds invoice balance');
      const note = await tx.creditNote.create({
        data: {
          ...d,
          organizationId: org,
          branchId: d.branchId ?? inv.branchId,
          customerId: inv.customerId,
          currency: inv.currency,
          issueDate: new Date(d.issueDate),
          amount,
        },
      });
      await tx.invoice.update({
        where: { id: inv.id },
        data: {
          creditedAmount: { increment: amount },
          status: inv.paidAmount.add(inv.creditedAmount).add(amount).gte(inv.total)
            ? 'PAID'
            : 'PARTIALLY_PAID',
        },
      });
      return note;
    });
  }
  async voidCredit(org: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const note = await tx.creditNote.findFirst({
        where: { id, organizationId: org, isVoid: false },
      });
      if (!note) throw new NotFoundException('Credit note not found');
      await tx.creditNote.update({ where: { id }, data: { isVoid: true } });
      const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: note.invoiceId } });
      const creditedAmount = invoice.creditedAmount.sub(note.amount);
      await tx.invoice.update({
        where: { id: note.invoiceId },
        data: {
          creditedAmount,
          status: invoice.paidAmount.add(creditedAmount).gte(invoice.total)
            ? 'PAID'
            : invoice.paidAmount.gt(0) || creditedAmount.gt(0)
              ? 'PARTIALLY_PAID'
              : 'SENT',
        },
      });
      return { voided: true };
    });
  }
  receivables(org: string, q: Record<string, string>) {
    return this.prisma.invoice.findMany({
      where: {
        organizationId: org,
        status: { notIn: ['PAID', 'VOID'] },
        ...(q.search
          ? { customer: { displayName: { contains: q.search, mode: 'insensitive' } } }
          : {}),
      },
      include: { customer: true },
      orderBy: { dueDate: 'asc' },
    });
  }
}
