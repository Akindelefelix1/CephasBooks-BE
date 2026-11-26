import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AdjustmentStatus, Prisma, ProjectStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.ts';
import { postAutomaticJournal } from '../../common/automatic-accounting.ts';
import type { AuthUser } from '../../common/decorators/current-user.decorator.ts';
import type {
  AdjustmentDto,
  MovementDto,
  ProductDto,
  ProjectDto,
  ProjectPlanDto,
  RestockDto,
  TaxRateDto,
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
      inventoryValue = inventoryValue.add(quantity.mul(product.salePrice));
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

  async branchInventory(org: string) {
    const [products, branches] = await Promise.all([
      this.db.product.findMany({
        where: { organizationId: org, isActive: true, type: 'PRODUCT' },
        orderBy: [{ name: 'asc' }],
      }),
      this.db.branch.findMany({
        where: { organizationId: org, isActive: true, warehouse: { isActive: true } },
        include: { warehouse: true },
        orderBy: [{ name: 'asc' }],
      }),
    ]);
    const productIds = products.map((product) => product.id);
    const warehouseIds = branches.flatMap((branch) =>
      branch.warehouse ? [branch.warehouse.id] : [],
    );
    const movements = productIds.length && warehouseIds.length
      ? await this.db.stockMovement.groupBy({
          by: ['productId', 'warehouseId', 'type'],
          where: {
            organizationId: org,
            productId: { in: productIds },
            warehouseId: { in: warehouseIds },
          },
          _sum: { quantity: true },
        })
      : [];
    const balances = new Map<string, Prisma.Decimal>();
    for (const row of movements) {
      const key = `${row.productId}:${row.warehouseId}`;
      const quantity = row._sum.quantity ?? new Prisma.Decimal(0);
      const signed = ['ISSUE', 'TRANSFER_OUT'].includes(row.type)
        ? quantity.neg()
        : quantity;
      balances.set(key, (balances.get(key) ?? new Prisma.Decimal(0)).add(signed));
    }
    const branchRows = branches.flatMap((branch) => {
      const warehouse = branch.warehouse;
      if (!warehouse) return [];
      let inventoryValue = new Prisma.Decimal(0);
      let lowStock = 0;
      let outOfStock = 0;
      const stock = products.map((product) => {
        const quantity = balances.get(`${product.id}:${warehouse.id}`) ?? new Prisma.Decimal(0);
        inventoryValue = inventoryValue.add(quantity.mul(product.costPrice));
        if (quantity.lte(0)) outOfStock += 1;
        else if (quantity.lte(product.reorderLevel)) lowStock += 1;
        return {
          productId: product.id,
          sku: product.sku,
          productName: product.name,
          unit: product.unit,
          reorderLevel: product.reorderLevel,
          quantity,
          status: quantity.lte(0) ? 'OUT_OF_STOCK' : quantity.lte(product.reorderLevel) ? 'LOW_STOCK' : 'IN_STOCK',
        };
      });
      return [{
        id: branch.id,
        warehouseId: warehouse.id,
        code: branch.code,
        name: branch.name,
        address: branch.address,
        manager: branch.manager,
        isActive: branch.isActive,
        isDefault: warehouse.isDefault,
        inventoryValue,
        lowStock,
        outOfStock,
        products: stock,
      }];
    });
    const consolidated = products.map((product) => {
      const locations = branchRows.map((branch) => {
        const stock = branch.products.find((row) => row.productId === product.id)!;
        return { branchId: branch.id, branchName: branch.name, code: branch.code, quantity: stock.quantity, status: stock.status };
      });
      return {
        productId: product.id,
        sku: product.sku,
        productName: product.name,
        unit: product.unit,
        reorderLevel: product.reorderLevel,
        totalQuantity: locations.reduce((sum, location) => sum.add(location.quantity), new Prisma.Decimal(0)),
        locations,
      };
    });
    return {
      branches: branchRows.map(({ products: _products, ...branch }) => branch),
      products: consolidated,
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
        ...(q.category ? { category: { equals: q.category, mode: 'insensitive' } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { taxRateSetting: { select: { id: true, name: true, rate: true, version: true, isActive: true } } },
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
    const valuedProducts = products.map((product) => ({
      ...product,
      taxRate: product.taxRateSetting?.rate ?? product.taxRate,
      taxRateVersion: product.taxRateSetting?.version ?? null,
      taxRateName: product.taxRateSetting?.name ?? (Number(product.taxRate) > 0 ? 'Custom tax' : 'No tax'),
      stockQuantity: stock.get(product.id) ?? new Prisma.Decimal(0),
      stockValue: (stock.get(product.id) ?? new Prisma.Decimal(0)).mul(product.salePrice),
    }));
    if (q.status === 'low_stock')
      return valuedProducts.filter(
        (product) =>
          product.type === 'PRODUCT' &&
          product.stockQuantity.gt(0) &&
          product.stockQuantity.lte(product.reorderLevel),
      );
    if (q.status === 'out_of_stock')
      return valuedProducts.filter(
        (product) => product.type === 'PRODUCT' && product.stockQuantity.lte(0),
      );
    return valuedProducts;
  }

  async productsPage(org: string, q: Record<string, string>) {
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 15));
    const products = await this.products(org, q);
    const total = products.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);
    return {
      data: products.slice((safePage - 1) * limit, safePage * limit),
      meta: { page: safePage, limit, total, totalPages },
    };
  }

  async productDetails(org: string, id: string) {
    const product = await this.product(org, id);
    const [
      movements,
      stockRows,
      adjustments,
      saleItems,
      salesAggregate,
      returnsAggregate,
      activity,
    ] = await Promise.all([
      this.db.stockMovement.findMany({
        where: { organizationId: org, productId: id },
        include: { warehouse: { select: { id: true, code: true, name: true } } },
        orderBy: [{ movementDate: 'desc' }, { createdAt: 'desc' }],
        take: 100,
      }),
      this.db.stockMovement.findMany({
        where: { organizationId: org, productId: id },
        select: { productId: true, type: true, quantity: true, unitCost: true },
      }),
      this.db.stockAdjustment.findMany({
        where: { organizationId: org, productId: id },
        include: { warehouse: { select: { id: true, code: true, name: true } } },
        orderBy: [{ adjustmentDate: 'desc' }, { createdAt: 'desc' }],
        take: 100,
      }),
      this.db.posSaleItem.findMany({
        where: { productId: id, sale: { organizationId: org } },
        include: {
          sale: {
            select: {
              id: true,
              receiptNumber: true,
              status: true,
              currency: true,
              cashierId: true,
              createdAt: true,
            },
          },
        },
        orderBy: { sale: { createdAt: 'desc' } },
        take: 100,
      }),
      this.db.posSaleItem.aggregate({
        where: {
          productId: id,
          sale: { organizationId: org, status: { in: ['COMPLETED', 'REFUNDED'] } },
        },
        _sum: { quantity: true, lineTotal: true },
      }),
      this.db.posReturn.aggregate({
        where: { organizationId: org, productId: id },
        _sum: { quantity: true, amount: true },
      }),
      this.db.auditLog.findMany({
        where: { organizationId: org, entityType: 'Product', entityId: id },
        include: { actor: { select: { email: true, firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);
    const cashierIds = [
      ...new Set(saleItems.map((item) => item.sale.cashierId).filter(Boolean)),
    ] as string[];
    const cashiers = cashierIds.length
      ? await this.db.user.findMany({
          where: { id: { in: cashierIds } },
          select: { id: true, email: true, firstName: true, lastName: true },
        })
      : [];
    const cashierById = new Map(cashiers.map((cashier) => [cashier.id, cashier]));
    const stockQuantity = this.stockMap(stockRows).get(id) ?? new Prisma.Decimal(0);
    const grossUnits = salesAggregate._sum.quantity ?? new Prisma.Decimal(0);
    const grossSales = salesAggregate._sum.lineTotal ?? new Prisma.Decimal(0);
    const returnedUnits = returnsAggregate._sum.quantity ?? new Prisma.Decimal(0);
    const returnsValue = returnsAggregate._sum.amount ?? new Prisma.Decimal(0);
    const created = activity.find((entry) => entry.action === 'CREATE');
    return {
      ...product,
      stockQuantity,
      stockValue: stockQuantity.mul(product.salePrice),
      createdBy: created?.actor ?? null,
      activity,
      movements,
      adjustments,
      salesSummary: {
        unitsSold: grossUnits.sub(returnedUnits),
        grossSales,
        returnedUnits,
        returnsValue,
        netSales: grossSales.sub(returnsValue),
      },
      sales: saleItems.map((item) => ({
        ...item,
        cashier: item.sale.cashierId ? (cashierById.get(item.sale.cashierId) ?? null) : null,
      })),
    };
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

  taxRates(org: string, includeInactive = false) {
    return this.db.taxRate.findMany({
      where: { organizationId: org, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: { name: 'asc' },
    });
  }

  async createTaxRate(org: string, dto: TaxRateDto, actor: AuthUser) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Tax rate name is required');
    try {
      return await this.db.$transaction(async (tx) => {
        const row = await tx.taxRate.create({ data: { organizationId: org, name, rate: dto.rate, description: dto.description?.trim() || null } });
        await tx.auditLog.create({ data: { organizationId: org, actorId: actor.sub, action: 'CREATE', entityType: 'TaxRate', entityId: row.id, metadata: { name, rate: dto.rate } } });
        return row;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new BadRequestException('A tax rate with this name already exists');
      throw error;
    }
  }

  async updateTaxRate(org: string, id: string, dto: TaxRateDto, actor: AuthUser) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Tax rate name is required');
    try {
      return await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "TaxRate" WHERE "id" = ${id}::uuid AND "organizationId" = ${org}::uuid FOR UPDATE`;
        const current = await tx.taxRate.findFirst({ where: { id, organizationId: org } });
        if (!current) throw new NotFoundException('Tax rate not found');
        await tx.taxRateRevision.create({ data: { taxRateId: id, version: current.version, name: current.name, rate: current.rate } });
        const updated = await tx.taxRate.update({ where: { id }, data: { name, rate: dto.rate, description: dto.description?.trim() || null, version: { increment: 1 } } });
        await tx.auditLog.create({ data: { organizationId: org, actorId: actor.sub, action: 'UPDATE', entityType: 'TaxRate', entityId: id, metadata: { previous: { name: current.name, rate: current.rate.toString(), description: current.description, version: current.version }, next: { name, rate: dto.rate, description: dto.description?.trim() || null, version: updated.version } } } });
        return updated;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new BadRequestException('A tax rate with this name already exists');
      throw error;
    }
  }

  async taxRateStatus(org: string, id: string, isActive: boolean, actor: AuthUser) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "TaxRate" WHERE "id" = ${id}::uuid AND "organizationId" = ${org}::uuid FOR UPDATE`;
      const rate = await tx.taxRate.findFirst({ where: { id, organizationId: org } });
      if (!rate) throw new NotFoundException('Tax rate not found');
      if (!isActive && await tx.product.count({ where: { organizationId: org, taxRateId: id } }))
        throw new BadRequestException('Reassign this tax rate from its products and services before archiving it');
      const updated = await tx.taxRate.update({ where: { id }, data: { isActive } });
      await tx.auditLog.create({ data: { organizationId: org, actorId: actor.sub, action: isActive ? 'ACTIVATE' : 'ARCHIVE', entityType: 'TaxRate', entityId: id, metadata: { name: rate.name, rate: rate.rate.toString() } } });
      return updated;
    });
  }

  async createProduct(org: string, d: ProductDto, actor?: AuthUser) {
    const {
      openingQuantity = 0,
      availableQuantity: _availableQuantity,
      openingWarehouseId,
      defaultWarehouseId,
      ...productData
    } = d;
    void _availableQuantity;
    if (d.type === 'SERVICE' && openingQuantity > 0)
      throw new BadRequestException('Services cannot have opening stock');
    if (openingQuantity > 0) {
      const quantity = new Prisma.Decimal(openingQuantity);
      const valid = d.allowFractionalSale ? quantity.mul(2).isInteger() : quantity.isInteger();
      if (!valid)
        throw new BadRequestException(
          d.allowFractionalSale
            ? 'Opening quantity must use half-unit increments'
            : 'Opening quantity must be a whole number',
        );
    }
    const organizationDefault =
      d.type === 'PRODUCT' && !defaultWarehouseId && !openingWarehouseId
        ? await this.db.warehouse.findFirst({
            where: { organizationId: org, isDefault: true, isActive: true },
            select: { id: true },
          })
        : null;
    const stockWarehouseId = defaultWarehouseId ?? openingWarehouseId ?? organizationDefault?.id;
    if (openingQuantity > 0 && !stockWarehouseId)
      throw new BadRequestException('Select a warehouse for opening stock');
    return this.db.$transaction(async (tx) => {
      if (stockWarehouseId) {
        const warehouse = await tx.warehouse.findFirst({
          where: { id: stockWarehouseId, organizationId: org, isActive: true },
        });
        if (!warehouse) throw new BadRequestException('Opening-stock warehouse is unavailable');
      }
      let taxRate = new Prisma.Decimal(productData.taxRate ?? 0);
      let taxRateId: string | null = null;
      if (productData.taxRateId) {
        await tx.$queryRaw`SELECT "id" FROM "TaxRate" WHERE "id" = ${productData.taxRateId}::uuid AND "organizationId" = ${org}::uuid FOR UPDATE`;
        const selectedTaxRate = await tx.taxRate.findFirst({ where: { id: productData.taxRateId, organizationId: org, isActive: true } });
        if (!selectedTaxRate) throw new BadRequestException('Select an active tax rate belonging to this organization');
        taxRate = selectedTaxRate.rate;
        taxRateId = selectedTaxRate.id;
      }
      const product = await tx.product.create({
        data: { ...productData, taxRate, taxRateId, defaultWarehouseId: stockWarehouseId, organizationId: org },
      });
      if (actor)
        await tx.auditLog.create({
          data: {
            organizationId: org,
            actorId: actor.sub,
            action: 'CREATE',
            entityType: 'Product',
            entityId: product.id,
            metadata: { email: actor.email, sku: product.sku, name: product.name },
          },
        });
      if (openingQuantity > 0 && stockWarehouseId) {
        const movement = await tx.stockMovement.create({
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
        const openingValue = new Prisma.Decimal(openingQuantity).mul(product.costPrice);
        if (openingValue.gt(0))
          await postAutomaticJournal(tx, {
            organizationId: org,
            number: `AUTO-STOCK-OPENING-${product.id}`,
            journalDate: movement.movementDate,
            description: `Opening stock ${product.sku}`,
            lines: [
              { accountCode: '1300', debit: openingValue, credit: 0, memo: product.name },
              { accountCode: '3900', debit: 0, credit: openingValue, memo: 'Opening stock equity' },
            ],
          });
      }
      return product;
    });
  }
  async updateProduct(org: string, id: string, d: ProductDto, actor?: AuthUser) {
    const current = await this.product(org, id);
    const {
      openingQuantity: _openingQuantity,
      availableQuantity,
      openingWarehouseId: _openingWarehouseId,
      defaultWarehouseId,
      ...productData
    } = d;
    void _openingQuantity;
    void _openingWarehouseId;
    if (d.type !== current.type)
      throw new BadRequestException('Item type cannot be changed after creation');
    if (defaultWarehouseId) {
      const warehouse = await this.db.warehouse.findFirst({
        where: { id: defaultWarehouseId, organizationId: org, isActive: true },
      });
      if (!warehouse) throw new BadRequestException('Selected stock warehouse is unavailable');
    }
    if (availableQuantity !== undefined && current.type === 'PRODUCT' && !defaultWarehouseId)
      throw new BadRequestException('Select a default warehouse before setting available stock');
    if (availableQuantity !== undefined) {
      const quantity = new Prisma.Decimal(availableQuantity);
      const allowsHalves = d.allowFractionalSale ?? current.allowFractionalSale;
      const valid = allowsHalves ? quantity.mul(2).isInteger() : quantity.isInteger();
      if (!valid)
        throw new BadRequestException(
          allowsHalves
            ? 'Available quantity must use half-unit increments'
            : 'Available quantity must be a whole number',
        );
    }
    return this.db.$transaction(async (tx) => {
      let taxRate = new Prisma.Decimal(productData.taxRate ?? 0);
      let taxRateId: string | null = null;
      if (productData.taxRateId) {
        await tx.$queryRaw`SELECT "id" FROM "TaxRate" WHERE "id" = ${productData.taxRateId}::uuid AND "organizationId" = ${org}::uuid FOR UPDATE`;
        const selectedTaxRate = await tx.taxRate.findFirst({ where: { id: productData.taxRateId, organizationId: org, isActive: true } });
        if (!selectedTaxRate) throw new BadRequestException('Select an active tax rate belonging to this organization');
        taxRate = selectedTaxRate.rate;
        taxRateId = selectedTaxRate.id;
      }
      const updated = await tx.product.update({
        where: { id },
        data: { ...productData, taxRate, taxRateId, defaultWarehouseId: defaultWarehouseId || null },
      });
      if (availableQuantity !== undefined && updated.type === 'PRODUCT' && defaultWarehouseId) {
        const rows = await tx.stockMovement.findMany({
          where: { organizationId: org, productId: id },
          select: {
            productId: true,
            warehouseId: true,
            type: true,
            quantity: true,
            unitCost: true,
          },
        });
        const existing = this.stockMap(rows).get(id) ?? new Prisma.Decimal(0);
        const target = new Prisma.Decimal(availableQuantity);
        const delta = target.sub(existing);
        if (!delta.isZero()) {
          const warehouseStock =
            this.stockMap(rows.filter((row) => row.warehouseId === defaultWarehouseId)).get(id) ??
            new Prisma.Decimal(0);
          if (delta.lt(0) && warehouseStock.lt(delta.abs()))
            throw new BadRequestException(
              `The default warehouse only has ${warehouseStock.toString()} available. Transfer stock into it or adjust each warehouse separately.`,
            );
          const reference = `COUNT-${updated.sku}-${randomUUID()}`;
          const now = new Date();
          const adjustment = await tx.stockAdjustment.create({
            data: {
              organizationId: org,
              productId: id,
              warehouseId: defaultWarehouseId,
              reference,
              adjustmentDate: now,
              quantityDelta: delta,
              unitCost: updated.costPrice,
              reason: 'Available stock corrected from product edit',
              status: 'APPROVED',
            },
          });
          await tx.stockMovement.create({
            data: {
              organizationId: org,
              productId: id,
              warehouseId: defaultWarehouseId,
              type: 'ADJUSTMENT',
              quantity: delta,
              unitCost: updated.costPrice,
              movementDate: now,
              reference: `ADJ-${reference}`,
              notes: adjustment.reason,
            },
          });
          const value = delta.abs().mul(updated.costPrice);
          if (value.gt(0))
            await postAutomaticJournal(tx, {
              organizationId: org,
              number: `AUTO-STOCK-COUNT-${adjustment.id}`,
              journalDate: now,
              description: `Stock count correction for ${updated.sku}`,
              lines: delta.gt(0)
                ? [
                    { accountCode: '1300', debit: value, credit: 0, memo: updated.name },
                    { accountCode: '4900', debit: 0, credit: value, memo: adjustment.reason },
                  ]
                : [
                    { accountCode: '5900', debit: value, credit: 0, memo: adjustment.reason },
                    { accountCode: '1300', debit: 0, credit: value, memo: updated.name },
                  ],
            });
        }
      }
      if (actor)
        await tx.auditLog.create({
          data: {
            organizationId: org,
            actorId: actor.sub,
            action: 'UPDATE',
            entityType: 'Product',
            entityId: id,
            metadata: { email: actor.email },
          },
        });
      return updated;
    });
  }
  async productStatus(org: string, id: string, isActive: boolean, actor?: AuthUser) {
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
    return this.db.$transaction(async (tx) => {
      const updated = await tx.product.update({ where: { id }, data: { isActive } });
      if (actor)
        await tx.auditLog.create({
          data: {
            organizationId: org,
            actorId: actor.sub,
            action: isActive ? 'RESTORE' : 'ARCHIVE',
            entityType: 'Product',
            entityId: id,
            metadata: { email: actor.email },
          },
        });
      return updated;
    });
  }

  async deleteProduct(org: string, id: string, actor: AuthUser) {
    const product = await this.product(org, id);
    if (product.isActive) throw new BadRequestException('Archive this item before deleting it');
    const [movements, adjustments, sales, returns] = await Promise.all([
      this.db.stockMovement.count({ where: { organizationId: org, productId: id } }),
      this.db.stockAdjustment.count({ where: { organizationId: org, productId: id } }),
      this.db.posSaleItem.count({ where: { productId: id, sale: { organizationId: org } } }),
      this.db.posReturn.count({ where: { organizationId: org, productId: id } }),
    ]);
    if (movements || adjustments || sales || returns)
      throw new BadRequestException(
        'This item has transaction history and cannot be permanently deleted',
      );
    await this.db.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          organizationId: org,
          actorId: actor.sub,
          action: 'DELETE',
          entityType: 'Product',
          entityId: id,
          metadata: { email: actor.email, sku: product.sku, name: product.name },
        },
      });
      await tx.product.delete({ where: { id } });
    });
    return { deleted: true };
  }

  async restockProduct(org: string, id: string, d: RestockDto, actor: AuthUser) {
    const [product, warehouse] = await Promise.all([
      this.product(org, id, true),
      this.warehouse(org, d.warehouseId, true),
    ]);
    if (product.type === 'SERVICE') throw new BadRequestException('Services cannot be restocked');
    const reference = d.reference?.trim() || `RESTOCK-${product.sku}-${randomUUID()}`;
    return this.db.$transaction(async (tx) => {
      const movement = await tx.stockMovement.create({
        data: {
          organizationId: org,
          productId: id,
          warehouseId: warehouse.id,
          type: 'RECEIPT',
          quantity: d.quantity,
          unitCost: d.unitCost,
          performedById: actor.sub,
          movementDate: this.dateOnly(d.movementDate),
          reference,
          notes: d.notes?.trim() || 'Product restock',
        },
        include: { warehouse: { select: { id: true, code: true, name: true } } },
      });
      const restockValue = new Prisma.Decimal(d.quantity).mul(d.unitCost);
      if (restockValue.gt(0))
        await postAutomaticJournal(tx, {
          organizationId: org,
          number: `AUTO-STOCK-RESTOCK-${movement.id}`,
          journalDate: movement.movementDate,
          description: `Inventory restock ${reference}`,
          lines: [
            { accountCode: '1300', debit: restockValue, credit: 0, memo: product.name },
            { accountCode: '2000', debit: 0, credit: restockValue, memo: 'Inventory payable' },
          ],
        });
      await tx.auditLog.create({
        data: {
          organizationId: org,
          actorId: actor.sub,
          action: 'RESTOCK',
          entityType: 'Product',
          entityId: id,
          metadata: {
            email: actor.email,
            reference,
            warehouseId: warehouse.id,
            warehouse: warehouse.name,
            quantity: d.quantity,
            unitCost: d.unitCost,
          },
        },
      });
      return movement;
    });
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
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }
  branches(org: string) {
    return this.db.branch.findMany({
      where: { organizationId: org },
      include: { warehouse: true },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
  }
  async createBranch(org: string, d: WarehouseDto) {
    const result = await this.createWarehouse(org, d);
    return this.db.branch.findUniqueOrThrow({
      where: { id: result.branch.id },
      include: { warehouse: true },
    });
  }
  async updateBranch(org: string, id: string, d: WarehouseDto) {
    const branch = await this.db.branch.findFirst({ where: { id, organizationId: org }, include: { warehouse: true } });
    if (!branch || !branch.warehouse) throw new NotFoundException('Branch not found');
    return this.db.$transaction(async (tx) => {
      const updated = await tx.branch.update({ where: { id }, data: d });
      await tx.warehouse.update({ where: { id: branch.warehouse!.id }, data: d });
      return { ...updated, warehouse: { ...branch.warehouse, ...d } };
    });
  }
  async branchStatus(org: string, id: string, isActive: boolean) {
    const branch = await this.db.branch.findFirst({ where: { id, organizationId: org }, include: { warehouse: true } });
    if (!branch || !branch.warehouse) throw new NotFoundException('Branch not found');
    await this.warehouseStatus(org, branch.warehouse.id, isActive);
    return this.db.branch.update({ where: { id }, data: { isActive }, include: { warehouse: true } });
  }
  async createWarehouse(org: string, d: WarehouseDto) {
    return this.db.$transaction(async (tx) => {
      const existingDefault = await tx.warehouse.count({
        where: { organizationId: org, isDefault: true },
      });
      const branch = await tx.branch.create({ data: { ...d, organizationId: org } });
      const warehouse = await tx.warehouse.create({
        data: { ...d, organizationId: org, branchId: branch.id, isDefault: existingDefault === 0 },
      });
      return { ...warehouse, branch };
    });
  }
  async updateWarehouse(org: string, id: string, d: WarehouseDto) {
    const warehouse = await this.warehouse(org, id);
    return this.db.$transaction(async (tx) => {
      const updated = await tx.warehouse.update({ where: { id }, data: d });
      if (warehouse.branchId)
        await tx.branch.update({ where: { id: warehouse.branchId }, data: d });
      return updated;
    });
  }
  async warehouseStatus(org: string, id: string, isActive: boolean) {
    const warehouse = await this.warehouse(org, id);
    if (!isActive) {
      if (warehouse.isDefault)
        throw new BadRequestException('Choose another default warehouse before archiving this one');
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
    return this.db.$transaction(async (tx) => {
      const updated = await tx.warehouse.update({ where: { id }, data: { isActive } });
      if (warehouse.branchId)
        await tx.branch.update({ where: { id: warehouse.branchId }, data: { isActive } });
      return updated;
    });
  }

  async makeDefaultWarehouse(org: string, id: string) {
    await this.warehouse(org, id, true);
    return this.db.$transaction(async (tx) => {
      await tx.warehouse.updateMany({
        where: { organizationId: org, isDefault: true },
        data: { isDefault: false },
      });
      return tx.warehouse.update({ where: { id }, data: { isDefault: true } });
    });
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
      include: {
        product: true,
        warehouse: true,
        performedBy: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
      orderBy: [{ movementDate: 'desc' }, { createdAt: 'desc' }],
    });
  }
  async createMovement(org: string, d: MovementDto, performedById?: string) {
    const [product] = await Promise.all([
      this.product(org, d.productId, true),
      this.warehouse(org, d.warehouseId, true),
    ]);
    if (product.type === 'SERVICE')
      throw new BadRequestException('Services cannot have stock movements');
    if (['ISSUE', 'TRANSFER_OUT'].includes(d.type))
      await this.requireStock(org, d.productId, d.warehouseId, d.quantity);
    return this.db.$transaction(async (tx) => {
      const movement = await tx.stockMovement.create({
        data: {
          ...d,
          movementDate: this.dateOnly(d.movementDate),
          organizationId: org,
          ...(performedById ? { performedById } : {}),
        },
      });
      const value = new Prisma.Decimal(d.quantity).mul(d.unitCost);
      if (value.gt(0) && d.type === 'RECEIPT')
        await postAutomaticJournal(tx, {
          organizationId: org,
          number: `AUTO-STOCK-MOVEMENT-${movement.id}`,
          journalDate: movement.movementDate,
          description: `Inventory receipt ${movement.reference}`,
          lines: [
            { accountCode: '1300', debit: value, credit: 0, memo: product.name },
            { accountCode: '2000', debit: 0, credit: value, memo: 'Inventory payable' },
          ],
        });
      if (value.gt(0) && d.type === 'ISSUE')
        await postAutomaticJournal(tx, {
          organizationId: org,
          number: `AUTO-STOCK-MOVEMENT-${movement.id}`,
          journalDate: movement.movementDate,
          description: `Inventory issue ${movement.reference}`,
          lines: [
            { accountCode: '5300', debit: value, credit: 0, memo: product.name },
            { accountCode: '1300', debit: 0, credit: value, memo: 'Inventory issued' },
          ],
        });
      if (value.gt(0) && d.type === 'ADJUSTMENT')
        await postAutomaticJournal(tx, {
          organizationId: org,
          number: `AUTO-STOCK-MOVEMENT-${movement.id}`,
          journalDate: movement.movementDate,
          description: `Inventory adjustment ${movement.reference}`,
          lines: [
            { accountCode: '1300', debit: value, credit: 0, memo: product.name },
            { accountCode: '4900', debit: 0, credit: value, memo: 'Inventory adjustment gain' },
          ],
        });
      return movement;
    });
  }
  async transfer(org: string, d: TransferDto, performedById?: string) {
    if (d.fromWarehouseId === d.toWarehouseId)
      throw new BadRequestException('Transfer warehouses must be different');
    await Promise.all([
      this.product(org, d.productId, true),
      this.warehouse(org, d.fromWarehouseId, true),
      this.warehouse(org, d.toWarehouseId, true),
    ]);
    const transferGroupId = randomUUID();
    return this.db.$transaction(async (tx) => {
      const rows = await tx.stockMovement.findMany({
        where: { organizationId: org, productId: d.productId, warehouseId: d.fromWarehouseId },
        select: { productId: true, type: true, quantity: true, unitCost: true },
      });
      const available = this.stockMap(rows).get(d.productId) ?? new Prisma.Decimal(0);
      if (available.lt(d.quantity))
        throw new BadRequestException(`Insufficient stock. Available quantity is ${available.toString()}`);
      const outgoing = await tx.stockMovement.create({
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
          ...(performedById ? { performedById } : {}),
          notes: d.notes,
        },
      });
      const incoming = await tx.stockMovement.create({
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
          ...(performedById ? { performedById } : {}),
          notes: d.notes,
        },
      });
      return [outgoing, incoming];
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
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
      if (status === 'APPROVED') {
        const value = adjustment.quantityDelta.abs().mul(adjustment.unitCost);
        if (value.gt(0))
          await postAutomaticJournal(tx, {
            organizationId: org,
            number: `AUTO-STOCK-ADJUSTMENT-${adjustment.id}`,
            journalDate: adjustment.adjustmentDate,
            description: `Inventory adjustment ${adjustment.reference}`,
            lines: adjustment.quantityDelta.gt(0)
              ? [
                  { accountCode: '1300', debit: value, credit: 0, memo: 'Inventory increase' },
                  { accountCode: '4900', debit: 0, credit: value, memo: adjustment.reason },
                ]
              : [
                  { accountCode: '5900', debit: value, credit: 0, memo: adjustment.reason },
                  { accountCode: '1300', debit: 0, credit: value, memo: 'Inventory decrease' },
                ],
          });
      }
      return updated;
    });
  }

  async projects(org: string, q: Record<string, string>) {
    const projects = await this.db.project.findMany({
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
    const ids = projects.map((project) => project.id);
    const [expenses, payments] = ids.length ? await Promise.all([
      this.db.expense.groupBy({ by: ['projectId'], where: { organizationId: org, projectId: { in: ids }, status: 'APPROVED' }, _sum: { amount: true, taxAmount: true } }),
      this.db.paymentReceived.groupBy({ by: ['projectId'], where: { organizationId: org, projectId: { in: ids } }, _sum: { amount: true } }),
    ]) : [[], []];
    const costs = new Map(expenses.map((x) => [
      x.projectId,
      (x._sum.amount ?? new Prisma.Decimal(0)).sub(x._sum.taxAmount ?? new Prisma.Decimal(0)),
    ]));
    const receipts = new Map(payments.map((x) => [x.projectId, x._sum.amount ?? new Prisma.Decimal(0)]));
    return projects.map((project) => {
      const actualCost = project.openingActualCost.add(costs.get(project.id) ?? 0);
      const actualRevenue = receipts.get(project.id) ?? new Prisma.Decimal(0);
      return {
        ...project,
        actualCost,
        actualRevenue,
        costVariance: actualCost.sub(project.budget),
        costVariancePercent: project.budget.isZero() ? 0 : actualCost.sub(project.budget).abs().div(project.budget).mul(100),
        costVarianceType: actualCost.lte(project.budget) ? 'FAVORABLE' : 'UNFAVORABLE',
        revenueVariance: actualRevenue.sub(project.revenue),
        revenueVariancePercent: project.revenue.isZero() ? 0 : actualRevenue.sub(project.revenue).abs().div(project.revenue).mul(100),
        revenueVarianceType: actualRevenue.gte(project.revenue) ? 'FAVORABLE' : 'UNFAVORABLE',
      };
    });
  }
  async projectVariance(org: string, id: string) {
    const project = await this.db.project.findFirst({ where: { id, organizationId: org } });
    if (!project) throw new NotFoundException('Project not found');
    const [expenses, payments] = await Promise.all([
      this.db.expense.findMany({ where: { organizationId: org, projectId: id }, include: { supplier: true }, orderBy: { expenseDate: 'desc' } }),
      this.db.paymentReceived.findMany({ where: { organizationId: org, projectId: id }, include: { customer: true, invoice: true }, orderBy: { paymentDate: 'desc' } }),
    ]);
    const actualCost = expenses.filter((x) => x.status === 'APPROVED').reduce(
      (sum, x) => sum.add(x.amount.sub(x.taxAmount)),
      project.openingActualCost,
    );
    const actualRevenue = payments.reduce((sum, x) => sum.add(x.amount), new Prisma.Decimal(0));
    const costVariance = actualCost.sub(project.budget);
    const revenueVariance = actualRevenue.sub(project.revenue);
    return {
      project: { ...project, actualCost, actualRevenue },
      summary: {
        budgetedCost: project.budget, actualCost, costVariance: costVariance.abs(),
        costVarianceSigned: costVariance,
        costVariancePercent: project.budget.isZero() ? 0 : costVariance.abs().div(project.budget).mul(100),
        costVarianceType: costVariance.lte(0) ? 'FAVORABLE' : 'UNFAVORABLE',
        expectedRevenue: project.revenue, actualRevenue, revenueVariance: revenueVariance.abs(),
        revenueVarianceSigned: revenueVariance,
        revenueVariancePercent: project.revenue.isZero() ? 0 : revenueVariance.abs().div(project.revenue).mul(100),
        revenueVarianceType: revenueVariance.gte(0) ? 'FAVORABLE' : 'UNFAVORABLE',
      },
      expenses: expenses.map((expense) => ({
        ...expense,
        amount: expense.amount.sub(expense.taxAmount),
      })),
      payments,
    };
  }
  createProject(org: string, d: ProjectDto) {
    this.validateProject(d);
    return this.db.project.create({
      data: {
        ...d,
        openingActualCost: 0,
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
      include: { taxRateSetting: { select: { id: true, name: true, rate: true, version: true, isActive: true } } },
    });
    if (!x) throw new NotFoundException('Product not found');
    return { ...x, taxRate: x.taxRateSetting?.rate ?? x.taxRate, taxRateVersion: x.taxRateSetting?.version ?? null, taxRateName: x.taxRateSetting?.name ?? (Number(x.taxRate) > 0 ? 'Custom tax' : 'No tax') };
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
