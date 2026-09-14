import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.ts';
import { CreateInvoiceDto } from './dto/create-invoice.dto.ts';

@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}
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
    return this.prisma.invoice.create({
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
  }
}
