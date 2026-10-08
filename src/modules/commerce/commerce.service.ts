import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.ts';
import type { CreateCommerceChannelDto, UpdateCommerceChannelDto } from './dto/commerce.dto.ts';

@Injectable()
export class CommerceService {
  constructor(private readonly db: PrismaService) {}

  async summary(org: string) {
    const now = new Date();
    const today = new Date(now);
    today.setUTCHours(0, 0, 0, 0);
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [organization, todaySales, monthSales, units, pendingInvoices, channels, products, movements] =
      await Promise.all([
        this.db.organization.findUniqueOrThrow({
          where: { id: org },
          select: { baseCurrency: true },
        }),
        this.db.posSale.aggregate({
          where: { organizationId: org, status: 'COMPLETED', createdAt: { gte: today } },
          _sum: { total: true },
          _count: true,
        }),
        this.db.posSale.aggregate({
          where: { organizationId: org, status: 'COMPLETED', createdAt: { gte: month } },
          _sum: { total: true },
          _count: true,
        }),
        this.db.posSaleItem.aggregate({
          where: { sale: { organizationId: org, status: 'COMPLETED', createdAt: { gte: today } } },
          _sum: { quantity: true },
        }),
        this.db.invoice.count({
          where: { organizationId: org, status: { in: ['DRAFT', 'SENT', 'PARTIALLY_PAID'] } },
        }),
        this.db.commerceChannel.findMany({ where: { organizationId: org } }),
        this.db.product.findMany({ where: { organizationId: org, isActive: true } }),
        this.db.stockMovement.findMany({
          where: { organizationId: org },
          select: { productId: true, type: true, quantity: true },
        }),
      ]);
    const stock = this.stockMap(movements);
    let inventoryValue = new Prisma.Decimal(0);
    let lowStock = 0;
    let outOfStock = 0;
    for (const product of products.filter((item) => item.type === 'PRODUCT')) {
      const quantity = stock.get(product.id) ?? new Prisma.Decimal(0);
      inventoryValue = inventoryValue.add(quantity.mul(product.costPrice));
      if (quantity.lte(0)) outOfStock += 1;
      else if (quantity.lte(product.reorderLevel)) lowStock += 1;
    }
    const monthRevenue = monthSales._sum.total ?? new Prisma.Decimal(0);
    return {
      currency: organization.baseCurrency,
      todaySales: todaySales._sum.total ?? 0,
      todayOrders: todaySales._count,
      todayUnits: units._sum.quantity ?? 0,
      monthSales: monthRevenue,
      averageOrderValue: monthSales._count ? monthRevenue.div(monthSales._count) : 0,
      pendingOrders: pendingInvoices,
      inventoryValue,
      products: products.length,
      lowStock,
      outOfStock,
      activeChannels: channels.filter((channel) => channel.status === 'ACTIVE').length,
      channelCount: channels.length,
    };
  }

  channels(org: string) {
    return this.db.commerceChannel.findMany({
      where: { organizationId: org },
      include: { warehouse: { select: { id: true, code: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createChannel(org: string, data: CreateCommerceChannelDto) {
    await this.requireWarehouse(org, data.warehouseId);
    return this.db.commerceChannel.create({
      data: { ...data, organizationId: org, name: data.name.trim() },
      include: { warehouse: { select: { id: true, code: true, name: true } } },
    });
  }

  async updateChannel(org: string, id: string, data: UpdateCommerceChannelDto) {
    const channel = await this.db.commerceChannel.findFirst({ where: { id, organizationId: org } });
    if (!channel) throw new NotFoundException('Sales channel not found');
    await this.requireWarehouse(org, data.warehouseId);
    return this.db.commerceChannel.update({
      where: { id },
      data: { ...data, name: data.name.trim() },
      include: { warehouse: { select: { id: true, code: true, name: true } } },
    });
  }

  async syncChannel(org: string, id: string) {
    const channel = await this.db.commerceChannel.findFirst({ where: { id, organizationId: org } });
    if (!channel) throw new NotFoundException('Sales channel not found');
    if (channel.status !== 'ACTIVE') throw new BadRequestException('Activate this channel before syncing');
    return this.db.commerceChannel.update({
      where: { id },
      data: { lastSyncedAt: new Date() },
      include: { warehouse: { select: { id: true, code: true, name: true } } },
    });
  }

  async orders(org: string) {
    const [posSales, invoices] = await Promise.all([
      this.db.posSale.findMany({
        where: { organizationId: org },
        include: { customer: { select: { displayName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.db.invoice.findMany({
        where: { organizationId: org },
        include: { customer: { select: { displayName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);
    return [
      ...posSales.map((sale) => ({
        id: sale.id,
        reference: sale.receiptNumber,
        source: 'Cephas POS',
        customer: sale.customer?.displayName ?? 'Walk-in customer',
        total: sale.total,
        currency: sale.currency,
        status: sale.status,
        createdAt: sale.createdAt,
      })),
      ...invoices.map((invoice) => ({
        id: invoice.id,
        reference: invoice.number,
        source: 'Direct sales',
        customer: invoice.customer.displayName,
        total: invoice.total,
        currency: invoice.currency,
        status: invoice.status,
        createdAt: invoice.createdAt,
      })),
    ]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 75);
  }

  async catalog(org: string) {
    const [products, movements, channels] = await Promise.all([
      this.db.product.findMany({
        where: { organizationId: org, isActive: true },
        orderBy: { name: 'asc' },
      }),
      this.db.stockMovement.findMany({
        where: { organizationId: org },
        select: { productId: true, type: true, quantity: true },
      }),
      this.db.commerceChannel.findMany({
        where: { organizationId: org, status: 'ACTIVE' },
        select: { id: true, name: true },
      }),
    ]);
    const stock = this.stockMap(movements);
    return products.map((product) => ({
      id: product.id,
      sku: product.sku,
      name: product.name,
      category: product.category,
      unit: product.unit,
      salePrice: product.salePrice,
      stockQuantity: stock.get(product.id) ?? 0,
      channelCount: channels.length,
    }));
  }

  private async requireWarehouse(org: string, warehouseId: string) {
    const warehouse = await this.db.warehouse.findFirst({
      where: { id: warehouseId, organizationId: org, isActive: true },
      select: { id: true },
    });
    if (!warehouse) throw new BadRequestException('Select an active inventory warehouse');
  }

  private stockMap(rows: Array<{ productId: string; type: string; quantity: Prisma.Decimal }>) {
    const stock = new Map<string, Prisma.Decimal>();
    for (const row of rows) {
      const quantity = ['ISSUE', 'TRANSFER_OUT'].includes(row.type)
        ? row.quantity.neg()
        : row.quantity;
      stock.set(row.productId, (stock.get(row.productId) ?? new Prisma.Decimal(0)).add(quantity));
    }
    return stock;
  }
}
