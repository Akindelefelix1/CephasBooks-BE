import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { jest } from '@jest/globals';
import { OrganizationsService } from './organizations.service.ts';

describe('OrganizationsService onboarding', () => {
  it('merges a step and synchronizes core organization fields', async () => {
    const findUniqueOrThrow = jest.fn().mockResolvedValue({
      onboardingData: { business: { businessName: 'Old name' } },
      onboardingStep: 1,
    });
    const update = jest.fn().mockResolvedValue({ onboardingStep: 2 });
    const service = new OrganizationsService({
      organization: { findUniqueOrThrow, update },
    } as never);

    await service.saveOnboardingStep('org-a', 'financial', {
      baseCurrency: 'usd',
      timezone: 'UTC',
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'org-a' },
      data: {
        baseCurrency: 'USD',
        onboardingStep: 2,
        onboardingData: {
          business: { businessName: 'Old name' },
          financial: { baseCurrency: 'usd', timezone: 'UTC' },
        },
      },
      select: { onboardingData: true, onboardingStep: true, onboardingCompletedAt: true },
    });
  });

  it('does not complete onboarding while a required step is missing', async () => {
    const service = new OrganizationsService({
      organization: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          onboardingData: { business: {}, financial: {} },
        }),
      },
    } as never);

    await expect(service.completeOnboarding('org-a')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects duplicate branch names before persisting settings', async () => {
    const transaction = jest.fn();
    const service = new OrganizationsService({ $transaction: transaction } as never);

    await expect(
      service.updateSection(
        { sub: 'user-a', email: 'owner@example.com', organizationId: 'org-a', role: 'OWNER' },
        'branches',
        {
          items: [
            { name: 'Lagos', address: 'One Street' },
            { name: 'lagos', address: 'Two Street' },
          ],
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects regions whose state does not exist', async () => {
    const transaction = jest.fn();
    const service = new OrganizationsService({ $transaction: transaction } as never);
    await expect(
      service.updateSection(
        { sub: 'user-a', email: 'owner@example.com', organizationId: 'org-a', role: 'OWNER' },
        'branches',
        {
          states: [{ id: '0f77eb5c-ae97-4ab8-a096-b21099539db6', name: 'Lagos', managerIds: [] }],
          regions: [
            {
              id: 'bd55d6a5-b262-4a92-ab7d-f3237bcd8059',
              stateId: 'afcf9935-6804-4479-86e0-01e0880ef82d',
              name: 'West',
              managerIds: [],
            },
          ],
          items: [],
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('prevents owner access from being changed', async () => {
    const service = new OrganizationsService({
      membership: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'membership-a',
          userId: 'owner-a',
          role: 'OWNER',
          user: { email: 'owner@example.com' },
        }),
      },
    } as never);

    await expect(
      service.updateUser(
        { sub: 'admin-a', email: 'admin@example.com', organizationId: 'org-a', role: 'ADMIN' },
        'membership-a',
        { role: 'MEMBER' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('prevents the organisation owner from being removed', async () => {
    const service = new OrganizationsService({
      membership: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'membership-a',
          userId: 'owner-a',
          role: 'OWNER',
          user: { email: 'owner@example.com' },
        }),
      },
    } as never);

    await expect(
      service.deleteUser(
        { sub: 'admin-a', email: 'admin@example.com', organizationId: 'org-a', role: 'ADMIN' },
        'membership-a',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('removes a staff membership and deletes an orphaned invited account', async () => {
    const membershipDelete = jest.fn().mockResolvedValue({});
    const userDelete = jest.fn().mockResolvedValue({});
    const transaction = jest.fn().mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({
        auditLog: { create: jest.fn().mockResolvedValue({}) },
        appNotification: { create: jest.fn().mockResolvedValue({}) },
        membership: {
          delete: membershipDelete,
          count: jest.fn().mockResolvedValue(0),
        },
        user: { delete: userDelete },
        session: { updateMany: jest.fn().mockResolvedValue({}) },
      }),
    );
    const service = new OrganizationsService({
      membership: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'membership-a',
          userId: 'staff-a',
          role: 'MEMBER',
          user: { email: 'staff@example.com' },
        }),
      },
      $transaction: transaction,
    } as never);

    await expect(
      service.deleteUser(
        { sub: 'owner-a', email: 'owner@example.com', organizationId: 'org-a', role: 'OWNER' },
        'membership-a',
      ),
    ).resolves.toEqual({ deleted: true });
    expect(membershipDelete).toHaveBeenCalledWith({ where: { id: 'membership-a' } });
    expect(userDelete).toHaveBeenCalledWith({ where: { id: 'staff-a' } });
  });

  it('rejects a default currency that is not active in the selected list', async () => {
    const transaction = jest.fn();
    const service = new OrganizationsService({ $transaction: transaction } as never);

    await expect(
      service.updateSection(
        { sub: 'owner-a', email: 'owner@example.com', organizationId: 'org-a', role: 'OWNER' },
        'currencies',
        {
          defaultCurrency: 'USD',
          items: [
            { code: 'NGN', name: 'Nigerian naira', symbol: '₦', rate: '1', active: true },
            { code: 'USD', name: 'US dollar', symbol: '$', rate: '1', active: false },
          ],
        },
      ),
    ).rejects.toThrow('default currency must be selected and active');
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('OrganizationsService account deletion', () => {
  const owner = {
    sub: 'owner-a',
    email: 'owner@example.com',
    organizationId: 'org-a',
    role: 'OWNER',
  };

  it('sends a ten-minute deletion code to the registered owner email', async () => {
    const update = jest.fn().mockResolvedValue({});
    const send = jest.fn().mockResolvedValue(undefined);
    const service = new OrganizationsService(
      {
        organization: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            name: 'Acme Books',
            deletionCodeSentAt: null,
          }),
          update,
        },
        user: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({ email: owner.email }),
        },
      } as never,
      { send } as never,
    );

    await expect(service.requestDeletionCode(owner)).resolves.toEqual({
      message: 'A deletion code has been sent to the registered email',
      expiresIn: 600,
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: owner.email, subject: 'Confirm deletion of Acme Books' }),
    );
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid deletion code without starting deletion', async () => {
    const transaction = jest.fn();
    const update = jest.fn().mockResolvedValue({});
    const service = new OrganizationsService({
      organization: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          deletionCodeHash: createHash('sha256').update('123456').digest('hex'),
          deletionCodeExpiresAt: new Date(Date.now() + 60_000),
          deletionCodeAttempts: 0,
        }),
        update,
      },
      $transaction: transaction,
    } as never);

    await expect(service.deleteOrganization(owner, '654321')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(transaction).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: owner.organizationId },
      data: { deletionCodeAttempts: 1 },
    });
  });

  it('deletes organization records transactionally and removes orphaned users', async () => {
    const calls: string[] = [];
    const delegates = [
      'auditLog',
      'posReturn',
      'posSale',
      'posShift',
      'posRegister',
      'posIdempotencyKey',
      'posAuditLog',
      'stockMovement',
      'stockAdjustment',
      'product',
      'warehouse',
      'paymentReceived',
      'creditNote',
      'quotation',
      'invoice',
      'customer',
      'supplierPayment',
      'bill',
      'purchaseOrder',
      'expense',
      'purchaseRequest',
      'supplier',
      'bankTransaction',
      'bankAccount',
      'ledgerAccount',
      'journal',
      'financeRecord',
      'project',
    ];
    const tx: Record<string, unknown> = {
      membership: {
        findMany: jest.fn().mockResolvedValue([{ userId: 'owner-a' }, { userId: 'staff-a' }]),
      },
      organization: {
        delete: jest.fn().mockImplementation(() => {
          calls.push('organization');
          return Promise.resolve({});
        }),
      },
      user: {
        deleteMany: jest.fn().mockImplementation(() => {
          calls.push('user');
          return Promise.resolve({ count: 2 });
        }),
      },
    };
    for (const name of delegates) {
      tx[name] = {
        deleteMany: jest.fn().mockImplementation(() => {
          calls.push(name);
          return Promise.resolve({ count: 0 });
        }),
      };
    }
    const service = new OrganizationsService({
      organization: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          deletionCodeHash: createHash('sha256').update('123456').digest('hex'),
          deletionCodeExpiresAt: new Date(Date.now() + 60_000),
          deletionCodeAttempts: 0,
        }),
      },
      $transaction: jest
        .fn()
        .mockImplementation((callback: (value: unknown) => unknown) =>
          Promise.resolve(callback(tx)),
        ),
    } as never);

    await expect(service.deleteOrganization(owner, '123456')).resolves.toEqual({ deleted: true });
    expect(calls.at(-2)).toBe('organization');
    expect(calls.at(-1)).toBe('user');
  });
});
