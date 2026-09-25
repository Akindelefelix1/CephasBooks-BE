import { BadRequestException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { assertBranch } from './branch-scope.ts';

describe('assertBranch', () => {
  it('accepts an active branch in the authenticated organisation', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      onboardingData: {
        admin: {
          branches: {
            items: [{ id: '0f77eb5c-ae97-4ab8-a096-b21099539db6', status: 'Active' }],
          },
        },
      },
    });
    await expect(
      assertBranch(
        { organization: { findUnique } } as never,
        'organization-a',
        '0f77eb5c-ae97-4ab8-a096-b21099539db6',
      ),
    ).resolves.toBeUndefined();
  });

  it('rejects an unknown or inactive branch', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      onboardingData: { admin: { branches: { items: [] } } },
    });
    await expect(
      assertBranch(
        { organization: { findUnique } } as never,
        'organization-a',
        'afcf9935-6804-4479-86e0-01e0880ef82d',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
