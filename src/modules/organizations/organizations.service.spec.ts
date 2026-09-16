import { BadRequestException, ConflictException } from '@nestjs/common';
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
});
