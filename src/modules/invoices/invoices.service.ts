import { BadRequestException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.ts';
import { CreateInvoiceDto } from './dto/create-invoice.dto.ts';
import { WorkflowService } from '../workflow/workflow.service.ts';
import { MailService } from '../mail/mail.service.ts';
import { assertBranch } from '../../common/branch-scope.ts';
import { postAutomaticJournal } from '../../common/automatic-accounting.ts';
import { customerCreditExposure, lockCustomerCredit, requireCreditOverride } from '../customers/customer-credit.ts';
import { addPaymentTermDays } from '../../common/payment-terms.ts';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows?: WorkflowService,
    private readonly mail?: MailService,
  ) {}
  list(organizationId: string) {
    return this.prisma.invoice.findMany({
      where: { organizationId },
      include: {
        customer: true,
        project: { select: { id: true, code: true, name: true } },
        items: true,
        payments: { orderBy: { paymentDate: 'desc' } },
        organization: { select: { name: true, countryCode: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  projects(organizationId: string) {
    return this.prisma.project.findMany({
      where: { organizationId, status: { not: 'CANCELLED' } },
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    });
  }
  async nextNumber(organizationId: string) {
    const invoices = await this.prisma.invoice.findMany({
      where: { organizationId },
      select: { number: true },
    });
    const last = invoices.reduce((highest, invoice) => {
      const match = /^INV-(\d+)$/i.exec(invoice.number);
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0);
    return { number: `INV-${String(last + 1).padStart(5, '0')}` };
  }
  async get(organizationId: string, id: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, organizationId },
      include: {
        customer: true,
        project: { select: { id: true, code: true, name: true } },
        items: true,
        organization: { select: { name: true, countryCode: true } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }
  async create(organizationId: string, actor: { id: string; role: string; permissions?: string[] }, dto: CreateInvoiceDto) {
    await assertBranch(this.prisma, organizationId, dto.branchId);
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, organizationId, isActive: true },
    });
    if (!customer) throw new BadRequestException('Customer does not belong to this organization');
    if (dto.projectId && !(await this.prisma.project.findFirst({ where: { id: dto.projectId, organizationId } })))
      throw new BadRequestException('Project does not belong to this organization');
    if (dto.dueDate && dto.dueDate.slice(0, 10) < dto.issueDate.slice(0, 10))
      throw new BadRequestException('Due date cannot be before issue date');
    // Keep the submitted due-date snapshot stable for offline-created invoices;
    // callers that omit it still get the customer terms calculated here.
    const dueDate = dto.dueDate
      ? new Date(dto.dueDate)
      : addPaymentTermDays(dto.issueDate, customer.paymentTermsDays);
    const items = dto.items.map((item) => {
      const base = new Prisma.Decimal(item.quantity).mul(item.unitPrice);
      const tax = base.mul(item.taxRate).div(100);
      return { ...item, lineTotal: base.add(tax) };
    });
    const subtotal = items.reduce(
      (sum, item) => sum.add(new Prisma.Decimal(item.quantity).mul(item.unitPrice)),
      new Prisma.Decimal(0),
    );
    const lineTotal = items.reduce((sum, item) => sum.add(item.lineTotal), new Prisma.Decimal(0));
    const shippingAmount = new Prisma.Decimal(dto.shippingAmount ?? 0);
    const number = (await this.nextNumber(organizationId)).number;
    const baseCurrency = (await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { baseCurrency: true },
    })).baseCurrency;
    const currency = dto.currency?.toUpperCase() ?? baseCurrency;
    if (dto.projectId && currency !== baseCurrency)
      throw new BadRequestException('Project invoices must use the organization base currency for variance reporting');
    const sendEmail = dto.sendEmail === true;
    const invoice = await this.prisma.$transaction(async (tx) => {
      const created = await tx.invoice.create({
      data: {
        organizationId,
        branchId: dto.branchId ?? customer.branchId,
        customerId: dto.customerId,
        projectId: dto.projectId,
        number,
        status: 'DRAFT',
        currency,
        issueDate: new Date(dto.issueDate),
        dueDate,
        notes: dto.notes,
        shippingAddress: dto.shippingAddress,
        shippingAmount,
        subtotal,
        taxTotal: lineTotal.sub(subtotal),
        total: lineTotal.add(shippingAmount),
        items: { create: items },
      },
      include: {
        customer: true,
        items: true,
        organization: { select: { name: true, countryCode: true } },
      },
    });
      if (!['DRAFT', 'VOID'].includes(created.status))
        await postAutomaticJournal(tx, {
          organizationId,
          number: `AUTO-INVOICE-${created.id}`,
          journalDate: created.issueDate,
          description: `Invoice ${created.number}`,
          lines: [
            { accountCode: '1100', debit: created.total, credit: 0, memo: 'Accounts receivable' },
            {
              accountCode: '4000',
              debit: 0,
              credit: created.total.sub(created.taxTotal),
              memo: 'Sales revenue',
            },
            { accountCode: '2100', debit: 0, credit: created.taxTotal, memo: 'Tax payable' },
          ],
        });
      return created;
    });
    await this.workflows?.executeEvent(organizationId, 'INVOICE_CREATED', {
      entityType: 'INVOICE',
      entityId: invoice.id,
      reference: invoice.number,
      title: `Approve invoice ${invoice.number}`,
      amount: Number(invoice.total),
    });
    if (sendEmail) {
      try {
        await this.send(organizationId, invoice.id, actor, dto);
        return { ...invoice, status: 'SENT', emailSent: true };
      } catch (error) {
        if (error instanceof HttpException) throw error;
        return {
          ...invoice,
          status: 'SENT',
          emailSent: false,
          emailError: error instanceof Error ? error.message : 'Email delivery failed.',
        };
      }
    }
    return invoice;
  }
  async send(organizationId: string, id: string, actor: { id: string; role: string; permissions?: string[] }, approval: { creditLimitOverride?: boolean; creditLimitOverrideReason?: string } = {}) {
    let invoice = await this.prisma.invoice.findFirst({
      where: { id, organizationId },
      include: { customer: true, items: true, organization: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === 'VOID') throw new BadRequestException('A void invoice cannot be sent');
    if (!invoice.customer.email)
      throw new BadRequestException('This customer does not have an email address');
    if (invoice.status === 'DRAFT') {
      invoice = await this.prisma.$transaction(async (tx) => {
        await lockCustomerCredit(tx, organizationId, invoice!.customerId);
        const current = await tx.invoice.findFirst({
          where: { id, organizationId },
          include: { customer: true, items: true, organization: true },
        });
        if (!current) throw new NotFoundException('Invoice not found');
        if (current.status !== 'DRAFT') return current;
        const baseCurrency = (await tx.organization.findUniqueOrThrow({
          where: { id: organizationId }, select: { baseCurrency: true },
        })).baseCurrency;
        if (current.currency !== baseCurrency)
          throw new BadRequestException(`Credit sales must use the organization base currency (${baseCurrency}) so customer limits can be checked accurately.`);
        const exposure = await customerCreditExposure(tx, organizationId, current.customerId);
        const invoiceBalance = Prisma.Decimal.max(new Prisma.Decimal(0), current.total.sub(current.paidAmount).sub(current.creditedAmount));
        if (exposure.add(invoiceBalance).gt(current.customer.creditLimit)) {
          requireCreditOverride(actor, approval.creditLimitOverride, approval.creditLimitOverrideReason);
          await tx.customerCreditOverrideApproval.create({
            data: {
              organizationId,
              customerId: current.customerId,
              approverId: actor.id,
              targetType: 'INVOICE',
              targetId: current.id,
              creditLimit: current.customer.creditLimit,
              existingExposure: exposure,
              requestedAmount: invoiceBalance,
              reason: approval.creditLimitOverrideReason!.trim(),
            },
          });
        }
        const sent = await tx.invoice.update({ where: { id }, data: { status: 'SENT' } });
        await postAutomaticJournal(tx, {
          organizationId,
          number: `AUTO-INVOICE-${sent.id}`,
          journalDate: sent.issueDate,
          description: `Invoice ${sent.number}`,
          lines: [
            { accountCode: '1100', debit: sent.total, credit: 0, memo: 'Accounts receivable' },
            { accountCode: '4000', debit: 0, credit: sent.total.sub(sent.taxTotal), memo: 'Sales revenue' },
            { accountCode: '2100', debit: 0, credit: sent.taxTotal, memo: 'Tax payable' },
          ],
        });
        return { ...current, ...sent, status: 'SENT' as const };
      });
    }
    const money = new Intl.NumberFormat('en-NG', { style: 'currency', currency: invoice.currency });
    const rows = invoice.items
      .map(
        (item) =>
          `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.description)}</td><td align="center">${item.quantity.toString()}</td><td align="right">${money.format(Number(item.unitPrice))}</td><td align="right">${money.format(Number(item.lineTotal))}</td></tr>`,
      )
      .join('');
    const statementInvoices = await this.prisma.invoice.findMany({
      where: {
        organizationId,
        customerId: invoice.customerId,
        OR: [{ status: { notIn: ['VOID', 'DRAFT'] } }, { id: invoice.id }],
      },
      orderBy: [{ issueDate: 'asc' }, { createdAt: 'asc' }],
    });
    const statementRows = statementInvoices.map((entry) => {
      const balance = Prisma.Decimal.max(
        new Prisma.Decimal(0),
        entry.total.sub(entry.paidAmount).sub(entry.creditedAmount),
      );
      const effectiveStatus = entry.id === invoice.id && entry.status === 'DRAFT' ? 'SENT' : entry.status;
      const dueDate = entry.dueDate.toISOString().slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);
      const statementStatus = balance.greaterThan(0) && dueDate < today ? 'OVERDUE' : effectiveStatus;
      return `<tr><td>${escapeHtml(entry.number)}</td><td>${entry.issueDate.toLocaleDateString('en-NG')}</td><td>${entry.dueDate.toLocaleDateString('en-NG')}</td><td>${escapeHtml(statementStatus)}</td><td align="right">${money.format(Number(entry.total))}</td><td align="right">${money.format(Number(entry.paidAmount))}</td><td align="right">${money.format(Number(entry.creditedAmount))}</td><td align="right">${money.format(Number(balance))}</td></tr>`;
    }).join('');
    const outstanding = statementInvoices.reduce(
      (sum, entry) => sum.add(Prisma.Decimal.max(new Prisma.Decimal(0), entry.total.sub(entry.paidAmount).sub(entry.creditedAmount))),
      new Prisma.Decimal(0),
    );
    const statementPayments = await this.prisma.paymentReceived.findMany({
      where: { organizationId, customerId: invoice.customerId },
      include: { invoice: { select: { number: true } } },
      orderBy: [{ paymentDate: 'asc' }, { createdAt: 'asc' }],
    });
    const paymentRows = statementPayments.map((payment) =>
      `<tr><td>${payment.paymentDate.toLocaleDateString('en-NG')}</td><td>${escapeHtml(payment.reference)}</td><td>${escapeHtml(payment.invoice.number)}</td><td>${escapeHtml(payment.method)}</td><td align="right">${money.format(Number(payment.amount))}</td></tr>`,
    ).join('');
    await this.mail?.send({
      to: invoice.customer.email!,
      subject: `Invoice ${invoice.number} and account statement from ${invoice.organization.name}`,
      html: `<main style="max-width:900px;margin:auto;padding:32px;font-family:Arial,sans-serif;color:#20242c;border-top:8px solid #ff8500"><h1 style="margin:0">Invoice</h1><p>${escapeHtml(invoice.organization.name)}</p><p><strong>Invoice no.</strong> ${escapeHtml(invoice.number)}<br><strong>Due date:</strong> ${invoice.dueDate.toLocaleDateString('en-NG')}</p><p><strong>Bill to:</strong> ${escapeHtml(invoice.customer.displayName)}${invoice.shippingAddress ? `<br><strong>Ship to:</strong> ${escapeHtml(invoice.shippingAddress)}` : ''}</p><table width="100%" cellspacing="0" cellpadding="10" style="border-collapse:collapse;background:#fff"><thead style="background:#f3f4f6"><tr><th align="left">Product/service</th><th align="left">Description</th><th>Qty</th><th align="right">Unit price</th><th align="right">Amount</th></tr></thead><tbody>${rows}</tbody></table><p style="text-align:right">Shipping: ${money.format(Number(invoice.shippingAmount))}</p><p style="text-align:right;font-size:18px"><strong>Total: ${money.format(Number(invoice.total))}</strong></p><p>${escapeHtml(invoice.notes || 'Thank you for your business.')}</p><hr style="margin:32px 0;border:0;border-top:1px solid #ddd"><h2>Customer statement</h2><p>Account activity and outstanding balances for ${escapeHtml(invoice.customer.displayName)}.</p><div style="overflow-x:auto"><table width="100%" cellspacing="0" cellpadding="8" style="border-collapse:collapse"><thead style="background:#f3f4f6"><tr><th align="left">Invoice</th><th align="left">Date</th><th align="left">Due</th><th align="left">Status</th><th align="right">Total</th><th align="right">Paid</th><th align="right">Credits</th><th align="right">Balance</th></tr></thead><tbody>${statementRows}</tbody></table></div><p style="text-align:right;font-size:18px"><strong>Outstanding balance: ${money.format(Number(outstanding))}</strong></p><h3>Payments received</h3><div style="overflow-x:auto"><table width="100%" cellspacing="0" cellpadding="8" style="border-collapse:collapse"><thead style="background:#f3f4f6"><tr><th align="left">Date</th><th align="left">Reference</th><th align="left">Invoice number</th><th align="left">Method</th><th align="right">Amount</th></tr></thead><tbody>${paymentRows || '<tr><td colspan="5">No payments recorded.</td></tr>'}</tbody></table></div></main>`,
    });

    return { sent: true };
  }
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!,
  );
}
