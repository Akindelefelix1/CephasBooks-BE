import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.ts';
import { CreateInvoiceDto } from './dto/create-invoice.dto.ts';
import { WorkflowService } from '../workflow/workflow.service.ts';
import { MailService } from '../mail/mail.service.ts';

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
      include: { customer: true, items: true },
      orderBy: { createdAt: 'desc' },
    });
  }
  async get(organizationId: string, id: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, organizationId },
      include: { customer: true, items: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }
  async create(organizationId: string, dto: CreateInvoiceDto) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, organizationId, isActive: true },
    });
    if (!customer) throw new BadRequestException('Customer does not belong to this organization');
    if (new Date(dto.dueDate) < new Date(dto.issueDate))
      throw new BadRequestException('Due date cannot be before issue date');
    const items = dto.items.map((item) => {
      const base = new Prisma.Decimal(item.quantity).mul(item.unitPrice);
      const tax = base.mul(item.taxRate).div(100);
      return { ...item, lineTotal: base.add(tax) };
    });
    const subtotal = items.reduce(
      (sum, item) => sum.add(new Prisma.Decimal(item.quantity).mul(item.unitPrice)),
      new Prisma.Decimal(0),
    );
    const total = items.reduce((sum, item) => sum.add(item.lineTotal), new Prisma.Decimal(0));
    const invoice = await this.prisma.invoice.create({
      data: {
        organizationId,
        customerId: dto.customerId,
        number: dto.number,
        status: dto.status,
        currency: dto.currency.toUpperCase(),
        issueDate: new Date(dto.issueDate),
        dueDate: new Date(dto.dueDate),
        notes: dto.notes,
        subtotal,
        taxTotal: total.sub(subtotal),
        total,
        items: { create: items },
      },
      include: { customer: true, items: true },
    });
    await this.workflows?.executeEvent(organizationId, 'INVOICE_CREATED', {
      entityType: 'INVOICE',
      entityId: invoice.id,
      reference: invoice.number,
      title: `Approve invoice ${invoice.number}`,
      amount: Number(invoice.total),
    });
    return invoice;
  }
  async send(organizationId: string, id: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, organizationId },
      include: { customer: true, items: true, organization: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (!invoice.customer.email) throw new BadRequestException('This customer does not have an email address');
    const money = new Intl.NumberFormat('en-NG', { style: 'currency', currency: invoice.currency });
    const rows = invoice.items.map((item) => `<tr><td>${escapeHtml(item.description)}</td><td align="center">${item.quantity}</td><td align="right">${money.format(Number(item.unitPrice))}</td><td align="right">${money.format(Number(item.lineTotal))}</td></tr>`).join('');
    await this.mail?.send({
      to: invoice.customer.email,
      subject: `Invoice ${invoice.number} from ${invoice.organization.name}`,
      html: `<main style="max-width:680px;margin:auto;padding:32px;font-family:Arial,sans-serif;color:#3d3025;background:#f8f1e2"><h1 style="letter-spacing:2px;margin:0">INVOICE</h1><p>${escapeHtml(invoice.organization.name)}</p><p><strong>Invoice no.</strong> ${escapeHtml(invoice.number)}<br><strong>Due date:</strong> ${invoice.dueDate.toLocaleDateString('en-NG')}</p><p><strong>Bill to:</strong> ${escapeHtml(invoice.customer.displayName)}</p><table width="100%" cellspacing="0" cellpadding="10" style="border-collapse:collapse;background:#fff"><thead style="background:#5b432e;color:white"><tr><th align="left">Description</th><th>Qty</th><th align="right">Unit price</th><th align="right">Amount</th></tr></thead><tbody>${rows}</tbody></table><p style="text-align:right;font-size:18px"><strong>Total: ${money.format(Number(invoice.total))}</strong></p><p>Thank you for your business.</p></main>`,
    });
    if (invoice.status === 'DRAFT') await this.prisma.invoice.update({ where: { id }, data: { status: 'SENT' } });
    return { sent: true };
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!);
}
