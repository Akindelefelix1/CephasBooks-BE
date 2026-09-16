import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { jest } from '@jest/globals';
import { OperationsService } from './operations.service.ts';

describe('OperationsService', () => {
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

  it('creates a useful structured project plan', () => {
    const plan = new OperationsService({} as never).plan({
      name: 'Expansion',
      objective: 'Open a warehouse',
    });
    expect(plan.tasks).toHaveLength(5);
    expect(plan.risks.length).toBeGreaterThan(0);
  });
});
