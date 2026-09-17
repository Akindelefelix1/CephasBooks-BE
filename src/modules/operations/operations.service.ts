import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AdjustmentStatus, Prisma, ProjectStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.ts';
import type {
  AdjustmentDto,
  MovementDto,
  ProductDto,
  ProjectDto,
  ProjectPlanDto,
  TransferDto,
  WarehouseDto,
} from './dto/operations.dto.ts';

@Injectable()
export class OperationsService {
  constructor(private readonly db: PrismaService) {}

  async summary(org: string) {
    const [organization, products, warehouses, activeProjects, movements] = await Promise.all([
      this.db.organization.findUniqueOrThrow({
        where: { id: org },
        select: { baseCurrency: true },
      }),
      this.db.product.findMany({ where: { organizationId: org, isActive: true } }),
      this.db.warehouse.count({ where: { organizationId: org, isActive: true } }),
      this.db.project.count({ where: { organizationId: org, status: 'ACTIVE' } }),
      this.db.stockMovement.findMany({
        where: { organizationId: org },
        select: { productId: true, type: true, quantity: true, unitCost: true },
      }),
    ]);
    const stock = this.stockMap(movements);
    let inventoryValue = new Prisma.Decimal(0),
      lowStock = 0,
      outOfStock = 0;
    for (const product of products.filter((x) => x.type === 'PRODUCT')) {
      const quantity = stock.get(product.id) ?? new Prisma.Decimal(0);
      inventoryValue = inventoryValue.add(quantity.mul(product.costPrice));
      if (quantity.lte(0)) outOfStock += 1;
      else if (quantity.lte(product.reorderLevel)) lowStock += 1;
    }
    return {
      baseCurrency: organization.baseCurrency,
      inventoryValue,
      products: products.length,
      warehouses,
      lowStock,
      outOfStock,
      activeProjects,
    };
  }

  async products(org: string, q: Record<string, string>) {
    const products = await this.db.product.findMany({
      where: {
        organizationId: org,
        ...(q.status === 'active'
          ? { isActive: true }
          : q.status === 'archived'
            ? { isActive: false }
            : {}),
        ...(q.search
          ? {
              OR: [
                { name: { contains: q.search, mode: 'insensitive' } },
                { sku: { contains: q.search, mode: 'insensitive' } },
                { category: { contains: q.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    const ids = products.map((x) => x.id);
    const movements = ids.length
      ? await this.db.stockMovement.findMany({
          where: {
            organizationId: org,
            productId: { in: ids },
            ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
          },
          select: { productId: true, type: true, quantity: true, unitCost: true },
        })
      : [];
    const stock = this.stockMap(movements);
    return products.map((product) => ({
      ...product,
      stockQuantity: stock.get(product.id) ?? new Prisma.Decimal(0),
      stockValue: (stock.get(product.id) ?? new Prisma.Decimal(0)).mul(product.costPrice),
    }));
  }

  categories(org: string) {
    return this.db.productCategory.findMany({
      where: { organizationId: org },
      orderBy: { name: 'asc' },
    });
  }
  createCategory(org: string, name: string) {
    return this.db.productCategory.upsert({
      where: { organizationId_name: { organizationId: org, name: name.trim() } },
      create: { organizationId: org, name: name.trim() },
      update: {},
    });
  }

  async createProduct(org: string, d: ProductDto) {
    const { openingQuantity = 0, openingWarehouseId, defaultWarehouseId, ...productData } = d;
    const stockWarehouseId = defaultWarehouseId ?? openingWarehouseId;
    if (openingQuantity > 0 && !stockWarehouseId)
      throw new BadRequestException('Select a warehouse for opening stock');
    return this.db.$transaction(async (tx) => {
      if (stockWarehouseId) {
        const warehouse = await tx.warehouse.findFirst({
          where: { id: stockWarehouseId, organizationId: org, isActive: true },
        });
        if (!warehouse) throw new BadRequestException('Opening-stock warehouse is unavailable');
      }
      const product = await tx.product.create({
        data: { ...productData, defaultWarehouseId: stockWarehouseId, organizationId: org },
      });
      if (openingQuantity > 0 && stockWarehouseId)
        await tx.stockMovement.create({
          data: {
            organizationId: org,
            productId: product.id,
            warehouseId: stockWarehouseId,
            type: 'RECEIPT',
            quantity: openingQuantity,
            unitCost: product.costPrice,
            movementDate: new Date(),
            reference: `OPEN-${product.sku}-${randomUUID()}`,
            notes: 'Opening stock on product creation',
          },
        });
      return product;
    });
  }
  async updateProduct(org: string, id: string, d: ProductDto) {
    await this.product(org, id);
    const {
      openingQuantity: _openingQuantity,
      openingWarehouseId: _openingWarehouseId,
      defaultWarehouseId,
      ...productData
    } = d;
    if (defaultWarehouseId) {
      const warehouse = await this.db.warehouse.findFirst({
        where: { id: defaultWarehouseId, organizationId: org, isActive: true },
      });
      if (!warehouse) throw new BadRequestException('Selected stock warehouse is unavailable');
    }
    return this.db.product.update({
      where: { id },
      data: { ...productData, defaultWarehouseId: defaultWarehouseId || null },
    });
  }
  async productStatus(org: string, id: string, isActive: boolean) {
    await this.product(org, id);
    if (!isActive) {
      const movements = await this.db.stockMovement.findMany({
        where: { organizationId: org, productId: id },
        select: { productId: true, type: true, quantity: true, unitCost: true },
      });
      const available = this.stockMap(movements).get(id) ?? new Prisma.Decimal(0);
      if (!available.isZero())
        throw new BadRequestException('An item with stock on hand cannot be archived');
    }
    return this.db.product.update({ where: { id }, data: { isActive } });
  }

  warehouses(org: string, q: Record<string, string>) {
    return this.db.warehouse.findMany({
      where: {
        organizationId: org,
        ...(q.status === 'active'
          ? { isActive: true }
          : q.status === 'archived'
            ? { isActive: false }
            : {}),
        ...(q.search
          ? {
              OR: [
                { name: { contains: q.search, mode: 'insensitive' } },
                { code: { contains: q.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  createWarehouse(org: string, d: WarehouseDto) {
    return this.db.warehouse.create({ data: { ...d, organizationId: org } });
  }
  async updateWarehouse(org: string, id: string, d: WarehouseDto) {
    await this.warehouse(org, id);
    return this.db.warehouse.update({ where: { id }, data: d });
  }
  async warehouseStatus(org: string, id: string, isActive: boolean) {
    await this.warehouse(org, id);
    if (!isActive) {
      const movements = await this.db.stockMovement.findMany({
        where: { organizationId: org, warehouseId: id },
        select: { productId: true, type: true, quantity: true, unitCost: true },
      });
      const hasStock = [...this.stockMap(movements).values()].some(
        (quantity) => !quantity.isZero(),
      );
      if (hasStock)
        throw new BadRequestException('A warehouse with stock on hand cannot be archived');
    }
    return this.db.warehouse.update({ where: { id }, data: { isActive } });
  }

  movements(org: string, q: Record<string, string>) {
    return this.db.stockMovement.findMany({
      where: {
        organizationId: org,
        ...(q.type ? { type: q.type as never } : {}),
        ...(q.search
          ? {
              OR: [
                { reference: { contains: q.search, mode: 'insensitive' } },
                { product: { name: { contains: q.search, mode: 'insensitive' } } },
                { warehouse: { name: { contains: q.search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: { product: true, warehouse: true },
      orderBy: [{ movementDate: 'desc' }, { createdAt: 'desc' }],
    });
  }
  async createMovement(org: string, d: MovementDto) {
    const [product] = await Promise.all([
      this.product(org, d.productId, true),
      this.warehouse(org, d.warehouseId, true),
    ]);
    if (product.type === 'SERVICE')
      throw new BadRequestException('Services cannot have stock movements');
    if (['ISSUE', 'TRANSFER_OUT'].includes(d.type))
      await this.requireStock(org, d.productId, d.warehouseId, d.quantity);
    return this.db.stockMovement.create({
      data: { ...d, movementDate: this.dateOnly(d.movementDate), organizationId: org },
    });
  }
  async transfer(org: string, d: TransferDto) {
    if (d.fromWarehouseId === d.toWarehouseId)
      throw new BadRequestException('Transfer warehouses must be different');
    await Promise.all([
      this.product(org, d.productId, true),
      this.warehouse(org, d.fromWarehouseId, true),
      this.warehouse(org, d.toWarehouseId, true),
    ]);
    await this.requireStock(org, d.productId, d.fromWarehouseId, d.quantity);
    const transferGroupId = randomUUID();
    return this.db.$transaction([
      this.db.stockMovement.create({
        data: {
          organizationId: org,
          productId: d.productId,
          warehouseId: d.fromWarehouseId,
          type: 'TRANSFER_OUT',
          quantity: d.quantity,
          unitCost: d.unitCost,
          movementDate: this.dateOnly(d.movementDate),
          reference: `${d.reference}-OUT`,
          transferGroupId,
          notes: d.notes,
        },
      }),
      this.db.stockMovement.create({
        data: {
          organizationId: org,
          productId: d.productId,
          warehouseId: d.toWarehouseId,
          type: 'TRANSFER_IN',
          quantity: d.quantity,
          unitCost: d.unitCost,
          movementDate: this.dateOnly(d.movementDate),
          reference: `${d.reference}-IN`,
          transferGroupId,
          notes: d.notes,
        },
      }),
    ]);
  }

  adjustments(org: string, q: Record<string, string>) {
    return this.db.stockAdjustment.findMany({
      where: {
        organizationId: org,
        ...(q.status ? { status: q.status as never } : {}),
        ...(q.search
          ? {
              OR: [
                { reference: { contains: q.search, mode: 'insensitive' } },
                { reason: { contains: q.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: { product: true, warehouse: true },
      orderBy: [{ adjustmentDate: 'desc' }, { createdAt: 'desc' }],
    });
  }
  async createAdjustment(org: string, d: AdjustmentDto) {
    const [product] = await Promise.all([
      this.product(org, d.productId, true),
      this.warehouse(org, d.warehouseId, true),
    ]);
    if (product.type === 'SERVICE')
      throw new BadRequestException('Services cannot have stock adjustments');
    if (d.quantityDelta === 0) throw new BadRequestException('Adjustment quantity cannot be zero');
    return this.db.stockAdjustment.create({
      data: { ...d, adjustmentDate: this.dateOnly(d.adjustmentDate), organizationId: org },
    });
  }
  async adjustmentStatus(org: string, id: string, status: AdjustmentStatus) {
    const adjustment = await this.db.stockAdjustment.findFirst({
      where: { id, organizationId: org },
    });
    if (!adjustment) throw new NotFoundException('Adjustment not found');
    if (adjustment.status !== 'DRAFT')
      throw new BadRequestException('Only draft adjustments can be changed');
    if (!['APPROVED', 'VOID'].includes(status))
      throw new BadRequestException('A draft adjustment can only be approved or voided');
    if (status === 'APPROVED' && adjustment.quantityDelta.lt(0))
      await this.requireStock(
        org,
        adjustment.productId,
        adjustment.warehouseId,
        adjustment.quantityDelta.abs().toNumber(),
      );
    return this.db.$transaction(async (tx) => {
      const updated = await tx.stockAdjustment.update({ where: { id }, data: { status } });
      if (status === 'APPROVED')
        await tx.stockMovement.create({
          data: {
            organizationId: org,
            productId: adjustment.productId,
            warehouseId: adjustment.warehouseId,
            type: 'ADJUSTMENT',
            quantity: adjustment.quantityDelta,
            unitCost: adjustment.unitCost,
            movementDate: adjustment.adjustmentDate,
            reference: `ADJ-${adjustment.reference}`,
            notes: adjustment.reason,
          },
        });
      return updated;
    });
  }

  projects(org: string, q: Record<string, string>) {
    return this.db.project.findMany({
      where: {
        organizationId: org,
        ...(q.status ? { status: q.status as never } : {}),
        ...(q.search
          ? {
              OR: [
                { name: { contains: q.search, mode: 'insensitive' } },
                { code: { contains: q.search, mode: 'insensitive' } },
                { client: { contains: q.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  createProject(org: string, d: ProjectDto) {
    this.validateProject(d);
    return this.db.project.create({
      data: {
        ...d,
        startDate: this.dateOnly(d.startDate),
        endDate: d.endDate ? this.dateOnly(d.endDate) : undefined,
        tasks: (d.tasks ?? []) as Prisma.InputJsonValue,
        organizationId: org,
      },
    });
  }
  async updateProject(org: string, id: string, d: ProjectDto) {
    await this.project(org, id);
    this.validateProject(d);
    return this.db.project.update({
      where: { id },
      data: {
        ...d,
        startDate: this.dateOnly(d.startDate),
        endDate: d.endDate ? this.dateOnly(d.endDate) : null,
        tasks: (d.tasks ?? []) as Prisma.InputJsonValue,
      },
    });
  }
  async projectStatus(org: string, id: string, status: ProjectStatus) {
    await this.project(org, id);
    return this.db.project.update({ where: { id }, data: { status } });
  }
  plan(d: ProjectPlanDto) {
    const target = d.targetDate ? ` by ${d.targetDate}` : '';
    return {
      name: d.name,
      objective: d.objective,
      summary: `Deliver ${d.name}${target} with clear ownership, controlled scope, and weekly budget tracking.`,
      risks: [
        'Scope changes without approval',
        'Supplier or resource delays',
        'Budget variance above 10%',
      ],
      tasks: [
        { title: 'Confirm scope and success criteria', phase: 'Initiation', priority: 'HIGH' },
        {
          title: 'Create delivery schedule and assign owners',
          phase: 'Planning',
          priority: 'HIGH',
        },
        { title: 'Validate budget and procurement needs', phase: 'Planning', priority: 'MEDIUM' },
        { title: 'Run weekly progress and risk review', phase: 'Delivery', priority: 'MEDIUM' },
        { title: 'Complete acceptance and close-out', phase: 'Close-out', priority: 'HIGH' },
      ],
    };
  }

  private async product(org: string, id: string, active = false) {
    const x = await this.db.product.findFirst({
      where: { id, organizationId: org, ...(active ? { isActive: true } : {}) },
    });
    if (!x) throw new NotFoundException('Product not found');
    return x;
  }
  private async warehouse(org: string, id: string, active = false) {
    const x = await this.db.warehouse.findFirst({
      where: { id, organizationId: org, ...(active ? { isActive: true } : {}) },
    });
    if (!x) throw new NotFoundException('Warehouse not found');
    return x;
  }
  private async project(org: string, id: string) {
    const x = await this.db.project.findFirst({ where: { id, organizationId: org } });
    if (!x) throw new NotFoundException('Project not found');
    return x;
  }
  private validateProject(d: ProjectDto) {
    if (d.endDate && new Date(d.endDate) < new Date(d.startDate))
      throw new BadRequestException('Project end date cannot be before start date');
  }
  private dateOnly(value: string) {
    return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  }
  private stockMap(
    rows: Array<{
      productId: string;
      type: string;
      quantity: Prisma.Decimal;
      unitCost: Prisma.Decimal;
    }>,
  ) {
    const map = new Map<string, Prisma.Decimal>();
    for (const row of rows) {
      const signed = ['ISSUE', 'TRANSFER_OUT'].includes(row.type)
        ? row.quantity.neg()
        : row.quantity;
      map.set(row.productId, (map.get(row.productId) ?? new Prisma.Decimal(0)).add(signed));
    }
    return map;
  }
  private async requireStock(
    org: string,
    productId: string,
    warehouseId: string,
    requested: number,
  ) {
    const rows = await this.db.stockMovement.findMany({
      where: { organizationId: org, productId, warehouseId },
      select: { productId: true, type: true, quantity: true, unitCost: true },
    });
    const available = this.stockMap(rows).get(productId) ?? new Prisma.Decimal(0);
    if (available.lt(requested))
      throw new BadRequestException(
        `Insufficient stock. Available quantity is ${available.toString()}`,
      );
  }
}
