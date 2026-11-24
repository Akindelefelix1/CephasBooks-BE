import { BadRequestException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { Prisma } from '@prisma/client';
import { PurchasesService } from './purchases.service.ts';

describe('PurchasesService', () => {
  it('calculates request totals on the server and submits for approval', async () => {
    const create = jest.fn().mockImplementation((request) => Promise.resolve(request));
    const service = new PurchasesService({
      purchaseRequest: { create },
      organization: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ baseCurrency: 'GHS' }),
      },
    } as never);
    await service.createRequest('org-a', {
      number: 'PR-1',
      requestedBy: 'Ada',
      requiredDate: '2026-09-20',
      items: [{ description: 'Paper', quantity: 2, unitPrice: 100, taxRate: 7.5 }],
    });
    const data = (
      create.mock.calls[0]?.[0] as {
        data: { total: Prisma.Decimal; status: string; currency: string };
      }
    ).data;
    expect(data.total.toString()).toBe('215');
    expect(data.status).toBe('PENDING');
    expect(data.currency).toBe('GHS');
  });

  it('rejects supplier payments above the outstanding bill balance', async () => {
    const tx = {
      bill: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'bill',
          total: new Prisma.Decimal(100),
          paidAmount: new Prisma.Decimal(40),
        }),
      },
    };
    const service = new PurchasesService({
      $transaction: jest
        .fn()
        .mockImplementation((operation: (client: typeof tx) => unknown) => operation(tx)),
    } as never);
    await expect(
      service.createPayment('org-a', {
        billId: 'bill',
        reference: 'PAY-1',
        paymentDate: '2026-09-15',
        amount: 61,
        method: 'Cash',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('uses the standard bill sequence when converting a purchase order', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'bill',
      number: 'BILL-00010',
      total: new Prisma.Decimal(100),
    });
    const update = jest.fn().mockResolvedValue({});
    const tx = {
      bill: { create, findFirst: jest.fn().mockResolvedValue(null) },
      purchaseOrder: { update },
    };
    const order = {
      id: 'order',
      organizationId: 'org-a',
      branchId: null,
      supplierId: 'supplier',
      status: 'RECEIVED',
      currency: 'NGN',
      notes: null,
      items: [{ name: 'Paper', description: 'Paper', quantity: 1, unitPrice: 100, taxRate: 0 }],
    };
    const service = new PurchasesService({
      purchaseOrder: { findFirst: jest.fn().mockResolvedValue(order) },
      supplier: { findFirst: jest.fn().mockResolvedValue({ id: 'supplier' }) },
      bill: { findMany: jest.fn().mockResolvedValue([{ number: 'BILL-00009' }]) },
      $transaction: jest
        .fn()
        .mockImplementation((operation: (client: typeof tx) => unknown) => operation(tx)),
    } as never);

    await service.orderToBill('org-a', 'order', {
      issueDate: '2026-09-28',
      dueDate: '2026-10-28',
    });
    expect((create.mock.calls[0]?.[0] as { data: { number: string } }).data.number).toBe(
      'BILL-00010',
    );
  });

  it('records a partial GRN and posts only accepted units to inventory', async () => {
    const grnCreate = jest.fn().mockResolvedValue({ id: 'grn-1', reference: 'GRN-1' });
    const movementCreate = jest
      .fn()
      .mockResolvedValue({ id: 'movement-1', movementDate: new Date('2026-11-24') });
    const orderUpdate = jest.fn().mockResolvedValue({});
    const auditCreate = jest.fn().mockResolvedValue({});
    const order = {
      id: 'order-1',
      organizationId: 'org-1',
      supplierId: 'supplier-1',
      branchId: null,
      number: 'PO-1',
      status: 'ISSUED',
      items: [{ name: 'Product A', description: 'Product A', quantity: 100, unitPrice: 0 }],
    };
    const tx = {
      goodsReceivedNote: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: grnCreate,
      },
      product: { findFirst: jest.fn().mockResolvedValue({ id: 'product-1', name: 'Product A' }) },
      stockMovement: { create: movementCreate },
      purchaseOrder: { findFirst: jest.fn().mockResolvedValue(order), update: orderUpdate },
      warehouse: {
        findFirst: jest.fn().mockResolvedValue({ id: 'warehouse-1', name: 'Main', branchId: null }),
      },
      auditLog: { create: auditCreate },
    };
    const service = new PurchasesService({
      $transaction: jest
        .fn()
        .mockImplementation((operation: (client: typeof tx) => unknown) => operation(tx)),
    } as never);

    await service.createGoodsReceivedNote('org-1', 'user-1', {
      purchaseOrderId: 'order-1',
      warehouseId: 'warehouse-1',
      reference: 'GRN-1',
      receivedDate: '2026-11-24',
      items: [
        {
          orderLineIndex: 0,
          productId: 'product-1',
          receivedQuantity: 80,
          acceptedQuantity: 70,
          damagedQuantity: 10,
          rejectedQuantity: 0,
        },
      ],
    });

    expect(movementCreate).toHaveBeenCalledTimes(1);
    expect(
      (
        movementCreate.mock.calls[0]?.[0] as {
          data: { quantity: Prisma.Decimal; type: string; performedById: string };
        }
      ).data,
    ).toMatchObject({
      type: 'RECEIPT',
      performedById: 'user-1',
      quantity: new Prisma.Decimal(70),
    });
    expect(orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'order-1' },
        data: expect.objectContaining({
          status: 'PARTIALLY_RECEIVED',
          items: expect.arrayContaining([expect.objectContaining({ productId: 'product-1' })]),
        }),
      }),
    );
  });

  it('rejects a receipt when the accepted, damaged and rejected quantities do not equal received', async () => {
    const tx = {
      purchaseOrder: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'order-1',
          status: 'ISSUED',
          branchId: null,
          items: [{ name: 'Product A', quantity: 100 }],
        }),
      },
      warehouse: { findFirst: jest.fn().mockResolvedValue({ id: 'warehouse-1', branchId: null }) },
    };
    const service = new PurchasesService({
      $transaction: jest
        .fn()
        .mockImplementation((operation: (client: typeof tx) => unknown) => operation(tx)),
    } as never);
    await expect(
      service.createGoodsReceivedNote('org-1', 'user-1', {
        purchaseOrderId: 'order-1',
        warehouseId: 'warehouse-1',
        reference: 'GRN-2',
        receivedDate: '2026-11-24',
        items: [
          {
            orderLineIndex: 0,
            receivedQuantity: 80,
            acceptedQuantity: 79,
            damagedQuantity: 0,
            rejectedQuantity: 0,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a GRN that would exceed the purchase order after prior partial receipts', async () => {
    const tx = {
      purchaseOrder: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'order-1',
          status: 'PARTIALLY_RECEIVED',
          branchId: null,
          items: [{ name: 'Product A', quantity: 100 }],
        }),
      },
      warehouse: { findFirst: jest.fn().mockResolvedValue({ id: 'warehouse-1', branchId: null }) },
      goodsReceivedNote: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest
          .fn()
          .mockResolvedValue([{ items: [{ orderLineIndex: 0, receivedQuantity: 80 }] }]),
      },
    };
    const service = new PurchasesService({
      $transaction: jest
        .fn()
        .mockImplementation((operation: (client: typeof tx) => unknown) => operation(tx)),
    } as never);
    await expect(
      service.createGoodsReceivedNote('org-1', 'user-1', {
        purchaseOrderId: 'order-1',
        warehouseId: 'warehouse-1',
        reference: 'GRN-3',
        receivedDate: '2026-11-24',
        items: [
          {
            orderLineIndex: 0,
            productId: 'product-1',
            receivedQuantity: 21,
            acceptedQuantity: 21,
            damagedQuantity: 0,
            rejectedQuantity: 0,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('prevents a second bill when receipt status changes after an order was billed', async () => {
    const create = jest.fn();
    const tx = {
      bill: {
        findFirst: jest.fn().mockResolvedValue({ id: 'existing-bill' }),
        create,
      },
    };
    const service = new PurchasesService({
      supplier: { findFirst: jest.fn().mockResolvedValue({ id: 'supplier-1' }) },
      purchaseOrder: { findFirst: jest.fn().mockResolvedValue({ id: 'order-1' }) },
      organization: { findUniqueOrThrow: jest.fn().mockResolvedValue({ baseCurrency: 'NGN' }) },
      $transaction: jest
        .fn()
        .mockImplementation((operation: (client: typeof tx) => unknown) => operation(tx)),
    } as never);
    await expect(
      service.createBill('org-1', {
        supplierId: 'supplier-1',
        purchaseOrderId: 'order-1',
        number: 'BILL-2',
        issueDate: '2026-11-24',
        dueDate: '2026-12-24',
        items: [{ name: 'Product A', description: 'Product A', quantity: 1, unitPrice: 10 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });
});
