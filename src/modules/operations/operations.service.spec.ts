import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { jest } from '@jest/globals';
import { OperationsService } from './operations.service.ts';

describe('OperationsService', () => {
  it('values product stock using sale price', async () => {
    const service = new OperationsService({
      product: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'product-a',
            type: 'PRODUCT',
            salePrice: new Prisma.Decimal(600),
            costPrice: new Prisma.Decimal(320),
          },
        ]),
      },
      stockMovement: {
        findMany: jest.fn().mockResolvedValue([
          {
            productId: 'product-a',
            type: 'RECEIPT',
            quantity: new Prisma.Decimal(32),
            unitCost: new Prisma.Decimal(320),
          },
        ]),
      },
    } as never);

    const [product] = await service.products('org-a', {});

    expect(product.stockQuantity.toString()).toBe('32');
    expect(product.stockValue.toString()).toBe('19200');
  });

  it('totals inventory value using sale price', async () => {
    const service = new OperationsService({
      organization: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ baseCurrency: 'NGN' }),
      },
      product: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'product-a',
            type: 'PRODUCT',
            salePrice: new Prisma.Decimal(1000),
            costPrice: new Prisma.Decimal(700),
            reorderLevel: new Prisma.Decimal(5),
          },
        ]),
      },
      warehouse: { count: jest.fn().mockResolvedValue(1) },
      project: { count: jest.fn().mockResolvedValue(0) },
      stockMovement: {
        findMany: jest.fn().mockResolvedValue([
          {
            productId: 'product-a',
            type: 'RECEIPT',
            quantity: new Prisma.Decimal(11),
            unitCost: new Prisma.Decimal(700),
          },
        ]),
      },
    } as never);

    const summary = await service.summary('org-a');

    expect(summary.inventoryValue.toString()).toBe('11000');
  });

  it('rejects opening stock for a service', async () => {
    const transaction = jest.fn();
    const service = new OperationsService({ $transaction: transaction } as never);
    await expect(
      service.createProduct('org-a', {
        sku: 'CONSULTING',
        name: 'Consulting',
        type: 'SERVICE',
        unit: 'hour',
        salePrice: 100,
        costPrice: 0,
        taxRate: 0,
        reorderLevel: 0,
        openingQuantity: 4,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects stock movements for services', async () => {
    const service = new OperationsService({
      product: { findFirst: jest.fn().mockResolvedValue({ id: 'product', type: 'SERVICE' }) },
      warehouse: { findFirst: jest.fn().mockResolvedValue({ id: 'warehouse' }) },
    } as never);
    await expect(
      service.createMovement('org-a', {
        productId: 'product',
        warehouseId: 'warehouse',
        type: 'RECEIPT',
        quantity: 1,
        unitCost: 10,
        movementDate: '2026-09-16',
        reference: 'MOV-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects transfers to the same warehouse before writing', async () => {
    const transaction = jest.fn();
    const service = new OperationsService({ $transaction: transaction } as never);
    await expect(
      service.transfer('org-a', {
        productId: 'product',
        fromWarehouseId: 'same',
        toWarehouseId: 'same',
        quantity: 2,
        unitCost: 5,
        movementDate: '2026-09-16',
        reference: 'TRF-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('prevents issuing more stock than the warehouse holds', async () => {
    const service = new OperationsService({
      product: { findFirst: jest.fn().mockResolvedValue({ id: 'product', type: 'PRODUCT' }) },
      warehouse: { findFirst: jest.fn().mockResolvedValue({ id: 'warehouse' }) },
      stockMovement: {
        findMany: jest.fn().mockResolvedValue([
          {
            productId: 'product',
            type: 'RECEIPT',
            quantity: new Prisma.Decimal(4),
            unitCost: new Prisma.Decimal(2),
          },
        ]),
      },
    } as never);
    await expect(
      service.createMovement('org-a', {
        productId: 'product',
        warehouseId: 'warehouse',
        type: 'ISSUE',
        quantity: 5,
        unitCost: 2,
        movementDate: '2026-09-16',
        reference: 'MOV-2',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('prevents archiving an item while stock remains on hand', async () => {
    const update = jest.fn();
    const service = new OperationsService({
      product: { findFirst: jest.fn().mockResolvedValue({ id: 'product' }), update },
      stockMovement: {
        findMany: jest.fn().mockResolvedValue([
          {
            productId: 'product',
            type: 'RECEIPT',
            quantity: new Prisma.Decimal(3),
            unitCost: new Prisma.Decimal(2),
          },
        ]),
      },
    } as never);
    await expect(service.productStatus('org-a', 'product', false)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('requires an archived product before permanent deletion', async () => {
    const remove = jest.fn();
    const service = new OperationsService({
      product: {
        findFirst: jest.fn().mockResolvedValue({ id: 'product', isActive: true }),
        delete: remove,
      },
    } as never);
    await expect(
      service.deleteProduct('org-a', 'product', {
        sub: 'user-a',
        email: 'owner@example.com',
        organizationId: 'org-a',
        role: 'OWNER',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(remove).not.toHaveBeenCalled();
  });

  it('protects archived products that have transaction history from deletion', async () => {
    const transaction = jest.fn();
    const service = new OperationsService({
      product: { findFirst: jest.fn().mockResolvedValue({ id: 'product', isActive: false }) },
      stockMovement: { count: jest.fn().mockResolvedValue(1) },
      stockAdjustment: { count: jest.fn().mockResolvedValue(0) },
      posSaleItem: { count: jest.fn().mockResolvedValue(0) },
      posReturn: { count: jest.fn().mockResolvedValue(0) },
      $transaction: transaction,
    } as never);
    await expect(
      service.deleteProduct('org-a', 'product', {
        sub: 'user-a',
        email: 'owner@example.com',
        organizationId: 'org-a',
        role: 'OWNER',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('records a restock movement and its actor in one transaction', async () => {
    const movement = {
      id: 'movement',
      quantity: new Prisma.Decimal(12),
      unitCost: new Prisma.Decimal(250),
      movementDate: new Date('2026-09-28'),
      warehouse: { id: 'warehouse', code: 'MAIN', name: 'Main warehouse' },
    };
    const createMovement = jest.fn().mockResolvedValue(movement);
    const createAudit = jest.fn().mockResolvedValue({});
    const tx = {
      stockMovement: { create: createMovement },
      auditLog: { create: createAudit },
      journal: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation((input) => Promise.resolve(input.data)),
      },
      ledgerAccount: {
        upsert: jest.fn(),
        findMany: jest.fn().mockResolvedValue([
          { id: 'inventory-id', code: '1300' },
          { id: 'payable-id', code: '2000' },
        ]),
      },
    };
    const service = new OperationsService({
      product: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'product',
          sku: 'SKU-1',
          name: 'Book',
          costPrice: new Prisma.Decimal(250),
          type: 'PRODUCT',
        }),
      },
      warehouse: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'warehouse', code: 'MAIN', name: 'Main warehouse' }),
      },
      $transaction: jest
        .fn()
        .mockImplementation((operation: (client: typeof tx) => unknown) => operation(tx)),
    } as never);

    await expect(
      service.restockProduct(
        'org-a',
        'product',
        {
          warehouseId: 'warehouse',
          quantity: 12,
          unitCost: 250,
          movementDate: '2026-09-28',
          reference: 'DELIVERY-42',
          notes: 'Supplier delivery',
        },
        {
          sub: 'user-a',
          email: 'stock@example.com',
          organizationId: 'org-a',
          role: 'ACCOUNTANT',
        },
      ),
    ).resolves.toEqual(movement);
    expect(createMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        // Jest's asymmetric matcher is intentionally dynamic.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining({
          productId: 'product',
          warehouseId: 'warehouse',
          type: 'RECEIPT',
          quantity: 12,
          reference: 'DELIVERY-42',
        }),
      }),
    );
    expect(createAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        // Jest's asymmetric matcher is intentionally dynamic.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining({ action: 'RESTOCK', actorId: 'user-a' }),
      }),
    );
  });

  it('sets an exact available quantity through a traceable stock adjustment', async () => {
    const adjustmentCreate = jest.fn().mockResolvedValue({
      id: 'adjustment-a',
      reason: 'Available stock corrected from product edit',
    });
    const movementCreate = jest.fn().mockResolvedValue({});
    const tx = {
      product: {
        update: jest.fn().mockResolvedValue({
          id: 'product-a',
          sku: 'FABRIC-1',
          name: 'Fabric',
          type: 'PRODUCT',
          costPrice: new Prisma.Decimal(0),
        }),
      },
      stockMovement: {
        findMany: jest.fn().mockResolvedValue([
          {
            productId: 'product-a',
            warehouseId: 'warehouse-a',
            type: 'RECEIPT',
            quantity: new Prisma.Decimal(4000),
            unitCost: new Prisma.Decimal(0),
          },
        ]),
        create: movementCreate,
      },
      stockAdjustment: { create: adjustmentCreate },
    };
    const service = new OperationsService({
      product: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'product-a',
          type: 'PRODUCT',
          allowFractionalSale: false,
        }),
      },
      warehouse: { findFirst: jest.fn().mockResolvedValue({ id: 'warehouse-a' }) },
      $transaction: jest
        .fn()
        .mockImplementation((operation: (client: typeof tx) => unknown) => operation(tx)),
    } as never);

    await service.updateProduct('org-a', 'product-a', {
      sku: 'FABRIC-1',
      name: 'Fabric',
      type: 'PRODUCT',
      unit: 'yard',
      salePrice: 5000,
      costPrice: 0,
      taxRate: 0,
      reorderLevel: 20,
      allowFractionalSale: false,
      defaultWarehouseId: 'warehouse-a',
      availableQuantity: 25,
    });

    expect(adjustmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        // Jest's asymmetric matcher is intentionally dynamic.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining({
          productId: 'product-a',
          warehouseId: 'warehouse-a',
          quantityDelta: new Prisma.Decimal(-3975),
          status: 'APPROVED',
        }),
      }),
    );
    expect(movementCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        // Jest's asymmetric matcher is intentionally dynamic.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining({ quantity: new Prisma.Decimal(-3975) }),
      }),
    );
  });

  it('only permits approval or void as draft adjustment transitions', async () => {
    const service = new OperationsService({
      stockAdjustment: {
        findFirst: jest.fn().mockResolvedValue({ id: 'adjustment', status: 'DRAFT' }),
      },
    } as never);
    await expect(service.adjustmentStatus('org-a', 'adjustment', 'DRAFT')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('does not update a project from another organization', async () => {
    const update = jest.fn();
    const service = new OperationsService({
      project: { findFirst: jest.fn().mockResolvedValue(null), update },
    } as never);
    await expect(
      service.updateProject('org-a', 'project', {
        code: 'PRJ-1',
        name: 'Rollout',
        owner: 'Owner',
        startDate: '2026-09-16',
        budget: 100,
        actualCost: 0,
        revenue: 0,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(update).not.toHaveBeenCalled();
  });

  it('normalizes project dates and tasks before writing them with Prisma', async () => {
    const create = jest.fn().mockImplementation((request) => Promise.resolve(request));
    const service = new OperationsService({ project: { create } } as never);
    await service.createProject('org-a', {
      code: 'PRJ-2',
      name: 'Fabric supply',
      owner: 'Operations',
      startDate: '2026-09-16',
      endDate: '2026-09-18',
      budget: 5_000_000,
      actualCost: 4_800_000,
      revenue: 450_000,
    });
    const data = (create.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data.startDate).toEqual(new Date('2026-09-16T00:00:00.000Z'));
    expect(data.endDate).toEqual(new Date('2026-09-18T00:00:00.000Z'));
    expect(data.tasks).toEqual([]);
  });

  it('creates a useful structured project plan', () => {
    const plan = new OperationsService({} as never).plan({
      name: 'Expansion',
      objective: 'Open a warehouse',
    });
    expect(plan.tasks).toHaveLength(5);
    expect(plan.risks.length).toBeGreaterThan(0);
  });
});
