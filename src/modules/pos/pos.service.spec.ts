import { BadRequestException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { assertSaleQuantity, PosService } from './pos.service.ts';

describe('POS sale quantities', () => {
  it('allows whole quantities for every product', () => {
    expect(() =>
      assertSaleQuantity({ name: 'Rice', allowFractionalSale: false }, 5),
    ).not.toThrow();
  });

  it('rejects fractional quantities for whole-unit products', () => {
    expect(() =>
      assertSaleQuantity({ name: 'Milk', allowFractionalSale: false }, 5.5),
    ).toThrow(BadRequestException);
  });

  it('allows half-unit quantities when enabled', () => {
    expect(() =>
      assertSaleQuantity({ name: 'Fabric', allowFractionalSale: true }, 5.5),
    ).not.toThrow();
  });

  it('rejects quantities smaller than half-unit increments', () => {
    expect(() =>
      assertSaleQuantity({ name: 'Fabric', allowFractionalSale: true }, 5.25),
    ).toThrow(BadRequestException);
  });
});

describe('POS register staff assignment', () => {
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
                  { id: 'branch-c', name: 'Inactive', status: 'Inactive', managerIds: ['member-a'] },
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
