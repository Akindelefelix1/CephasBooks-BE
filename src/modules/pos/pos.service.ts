import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.ts';
@Injectable()
export class PosService {
  constructor(private readonly db: PrismaService) {}
  list(org: string) { return this.db.posSale.findMany({ where: { organizationId: org }, include: { items: true, payments: true, customer: true }, orderBy: { createdAt: 'desc' } }); }
  async complete(org: string, data: { customerId?: string; items: Array<{ productId: string; quantity: number; discount?: number }>; payments: Array<{ method: string; amount: number; reference?: string }> }) {
    if (!data.items?.length || !data.payments?.length) throw new BadRequestException('Items and payment are required');
    return this.db.$transaction(async (tx) => {
      const warehouse = await tx.warehouse.findFirst({ where: { organizationId: org, isActive: true }, orderBy: { createdAt: 'asc' } });
      if (!warehouse) throw new BadRequestException('Create an active warehouse before completing a POS sale');
      const products = await tx.product.findMany({ where: { organizationId: org, id: { in: data.items.map((x) => x.productId) }, isActive: true } });
      if (products.length !== data.items.length) throw new BadRequestException('One or more products are unavailable');
      let subtotal = new Prisma.Decimal(0), discountTotal = new Prisma.Decimal(0), taxTotal = new Prisma.Decimal(0);
      const items = data.items.map((line) => {
        const product = products.find((x) => x.id === line.productId)!;
        const base = new Prisma.Decimal(product.salePrice).mul(line.quantity), discount = new Prisma.Decimal(line.discount || 0);
        const taxable = base.sub(discount), tax = taxable.mul(product.taxRate).div(100);
        subtotal = subtotal.add(base); discountTotal = discountTotal.add(discount); taxTotal = taxTotal.add(tax);
        return { product, quantity: new Prisma.Decimal(line.quantity), discount, total: taxable.add(tax) };
      });
      const total = subtotal.sub(discountTotal).add(taxTotal), paid = data.payments.reduce((sum, p) => sum.add(p.amount), new Prisma.Decimal(0));
      if (paid.lt(total)) throw new BadRequestException('Payment is less than the total due');
      const count = await tx.posSale.count({ where: { organizationId: org } }); const receiptNumber = `POS-${String(count + 1).padStart(6, '0')}`;
      for (const item of items.filter((x) => x.product.type === 'PRODUCT')) {
        const movements = await tx.stockMovement.findMany({ where: { organizationId: org, productId: item.product.id, warehouseId: warehouse.id }, select: { type: true, quantity: true } });
        const available = movements.reduce((sum, m) => sum.add(['ISSUE','TRANSFER_OUT'].includes(m.type) ? new Prisma.Decimal(m.quantity).neg() : m.quantity), new Prisma.Decimal(0));
        if (available.lt(item.quantity)) throw new BadRequestException(`${item.product.name}: insufficient stock`);
      }
      const sale = await tx.posSale.create({ data: { organizationId: org, customerId: data.customerId || null, receiptNumber, currency: 'NGN', subtotal, discountTotal, taxTotal, total, paidAmount: paid, changeAmount: paid.sub(total), items: { create: items.map((x) => ({ productId: x.product.id, description: x.product.name, quantity: x.quantity, unitPrice: x.product.salePrice, discount: x.discount, taxRate: x.product.taxRate, lineTotal: x.total })) }, payments: { create: data.payments } }, include: { items: true, payments: true, customer: true } });
      await Promise.all(items.filter((x) => x.product.type === 'PRODUCT').map((x) => tx.stockMovement.create({ data: { organizationId: org, productId: x.product.id, warehouseId: warehouse.id, type: 'ISSUE', quantity: x.quantity, unitCost: x.product.costPrice, movementDate: new Date(), reference: `${receiptNumber}-${x.product.sku}`, notes: 'POS sale' } })));
      return sale;
    });
  }
}
