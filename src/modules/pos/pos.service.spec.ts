import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { jest } from '@jest/globals';
import { assertSaleQuantity, calculatePosLine, PosService } from './pos.service.ts';

describe('POS sale quantities', () => {
  it('allows whole quantities for every product', () => {
    expect(() => assertSaleQuantity({ name: 'Rice', allowFractionalSale: false }, 5)).not.toThrow();
  });

  it('rejects fractional quantities for whole-unit products', () => {
    expect(() => assertSaleQuantity({ name: 'Milk', allowFractionalSale: false }, 5.5)).toThrow(
      BadRequestException,
    );
  });

  it('allows half-unit quantities when enabled', () => {
    expect(() =>
      assertSaleQuantity({ name: 'Fabric', allowFractionalSale: true }, 5.5),
    ).not.toThrow();
  });

  it('rejects quantities smaller than half-unit increments', () => {
    expect(() => assertSaleQuantity({ name: 'Fabric', allowFractionalSale: true }, 5.25)).toThrow(
      BadRequestException,
    );
  });
});

describe('POS line discounts', () => {
  it('subtracts the discount amount from each unit', () => {
    const line = calculatePosLine(
      { name: 'Perfume', salePrice: new Prisma.Decimal(5500), taxRate: new Prisma.Decimal(0) },
      2,
      200,
    );

    expect(line.discount.toString()).toBe('400');
    expect(line.total.toString()).toBe('10600');
  });

  it('rejects a per-unit discount above the selling price', () => {
    expect(() =>
      calculatePosLine(
        { name: 'Perfume', salePrice: new Prisma.Decimal(5500), taxRate: new Prisma.Decimal(0) },
        1,
        5501,
      ),
    ).toThrow('discount per unit cannot exceed the unit price');
  });
});

describe('POS register staff assignment', () => {
  it('limits completed sales history to the signed-in manager branches or own sales', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new PosService({
      organization: {
        findUnique: jest.fn().mockResolvedValue({
          onboardingData: {
            admin: {
              branches: {
                items: [
                  { id: 'branch-a', name: 'Assigned', status: 'Active', managerIds: ['member-a'] },
                  { id: 'branch-b', name: 'Other', status: 'Active', managerIds: ['member-b'] },
                ],
              },
            },
          },
        }),
      },
      membership: { findFirst: jest.fn().mockResolvedValue({ id: 'member-a' }) },
      posSale: { findMany, count: jest.fn().mockResolvedValue(0) },
      $transaction: jest
        .fn()
        .mockImplementation((requests: Array<Promise<unknown>>) => Promise.all(requests)),
    } as never);

    await service.list('org-a', { search: 'POS-1', includeVoided: true }, 'staff-a', 'ADMIN');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-a',
          status: { in: ['COMPLETED', 'VOIDED'] },
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([
                { cashierId: 'staff-a' },
                { branchId: { in: ['branch-a'] } },
              ]),
            }),
          ]),
        }),
      }),
    );
  });

  it('allows a custom sales manager to include voided sales in history', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new PosService({
      organization: {
        findUnique: jest.fn().mockResolvedValue({
          onboardingData: {
            admin: {
              branches: {
                items: [
                  { id: 'branch-a', name: 'Assigned', status: 'Active', managerIds: ['member-a'] },
                ],
              },
            },
          },
        }),
      },
      membership: { findFirst: jest.fn().mockResolvedValue({ id: 'member-a' }) },
      posSale: { findMany, count: jest.fn().mockResolvedValue(0) },
      $transaction: jest
        .fn()
        .mockImplementation((requests: Array<Promise<unknown>>) => Promise.all(requests)),
    } as never);

    await service.list('org-a', { includeVoided: true }, 'staff-a', 'MEMBER', ['sales.manage']);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['COMPLETED', 'VOIDED'] } }),
      }),
    );
  });

  it('returns the active branches assigned to the signed-in member', async () => {
    const service = new PosService({
      organization: {
        findUnique: jest.fn().mockResolvedValue({
          onboardingData: {
            admin: {
              branches: {
                items: [
                  { id: 'branch-a', name: 'Assigned', status: 'Active', managerIds: ['member-a'] },
                  { id: 'branch-b', name: 'Other', status: 'Active', managerIds: ['member-b'] },
                  {
                    id: 'branch-c',
                    name: 'Inactive',
                    status: 'Inactive',
                    managerIds: ['member-a'],
                  },
                ],
              },
            },
          },
        }),
      },
      membership: { findFirst: jest.fn().mockResolvedValue({ id: 'member-a' }) },
    } as never);

    const branches = await service.branches('org-a', 'staff-a', 'ADMIN');

    expect(branches.map((branch) => branch.id)).toEqual(['branch-a']);
  });

  it('creates a register for an existing active organization member', async () => {
    const create = jest.fn().mockImplementation((request) => Promise.resolve(request.data));
    const service = new PosService({
      warehouse: { findFirst: jest.fn().mockResolvedValue({ id: 'warehouse-a' }) },
      membership: { findFirst: jest.fn().mockResolvedValue({ id: 'membership-a' }) },
      organization: {
        findUnique: jest.fn().mockResolvedValue({
          onboardingData: {
            admin: { branches: { items: [{ id: 'branch-a', name: 'Main', status: 'Active' }] } },
          },
        }),
      },
      posRegister: { create },
    } as never);

    await service.createRegister('org-a', {
      warehouseId: 'warehouse-a',
      assignedStaffId: 'staff-a',
      branchId: 'branch-a',
      code: 'REG-1',
      name: 'Front desk',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        // Jest's asymmetric matcher is intentionally dynamic.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining({ assignedStaffId: 'staff-a', organizationId: 'org-a' }),
      }),
    );
  });

  it('prevents deactivating a register with an open shift', async () => {
    const update = jest.fn();
    const service = new PosService({
      posRegister: {
        findFirst: jest.fn().mockResolvedValue({ id: 'register-a' }),
        update,
      },
      posShift: { findFirst: jest.fn().mockResolvedValue({ id: 'shift-a' }) },
    } as never);

    await expect(
      service.updateRegister('org-a', 'register-a', { isActive: false }),
    ).rejects.toThrow('Close the open cashier shift before changing this register');
    expect(update).not.toHaveBeenCalled();
  });

  it('records the cashier and cash variance when closing a shift', async () => {
    const update = jest.fn().mockResolvedValue({
      id: 'shift-a',
      register: { id: 'register-a', code: 'REG-1', name: 'Front desk' },
      variance: new Prisma.Decimal(15),
    });
    const create = jest.fn().mockResolvedValue({});
    const service = new PosService({
      posShift: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'shift-a',
          registerId: 'register-a',
          openingCash: new Prisma.Decimal(100),
        }),
      },
      posPayment: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: new Prisma.Decimal(50) } }),
      },
      posSale: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { changeAmount: new Prisma.Decimal(10) } }),
      },
      posReturn: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: new Prisma.Decimal(5) } }),
      },
      $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({ posShift: { update }, posAuditLog: { create } }),
      ),
    } as never);

    await service.closeShift('org-a', 'cashier-a', 'shift-a', { closingCash: 150 });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'CLOSED',
          closingCash: 150,
          expectedCash: new Prisma.Decimal(135),
          variance: new Prisma.Decimal(15),
        }),
      }),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'SHIFT_CLOSED',
          actorId: 'cashier-a',
          entityId: 'shift-a',
        }),
      }),
    );
  });

  it('prevents another staff member from opening an assigned register', async () => {
    const service = new PosService({
      posRegister: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'register-a',
          assignedStaffId: 'staff-a',
          isActive: true,
        }),
      },
    } as never);

    await expect(
      service.openShift('org-a', 'staff-b', { registerId: 'register-a', openingCash: 0 }),
    ).rejects.toThrow('This register is not assigned to your branch');
  });
});
