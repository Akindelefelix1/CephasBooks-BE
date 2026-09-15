import { BadRequestException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { AccountingService } from './accounting.service.ts';

describe('AccountingService', () => {
  it('rejects an unbalanced journal', async () => {
    const service = new AccountingService({
      ledgerAccount: { count: jest.fn().mockResolvedValue(2) },
    } as never);
    await expect(
      service.createJournal('org-a', {
        number: 'J-1',
        journalDate: '2026-09-15',
        description: 'Unbalanced',
        lines: [
          { accountId: 'a', debit: 100, credit: 0 },
          { accountId: 'b', debit: 0, credit: 90 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('posts only draft journals', async () => {
    const service = new AccountingService({
      journal: { findFirst: jest.fn().mockResolvedValue({ id: 'j', status: 'POSTED' }) },
    } as never);
    await expect(service.postJournal('org-a', 'j')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not post a draft that references an archived account', async () => {
    const service = new AccountingService({
      journal: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'j',
          status: 'DRAFT',
          lines: [
            { accountId: 'active', debit: 100, credit: 0 },
            { accountId: 'archived', debit: 0, credit: 100 },
          ],
        }),
      },
      ledgerAccount: { count: jest.fn().mockResolvedValue(1) },
    } as never);
    await expect(service.postJournal('org-a', 'j')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps reversed journals in the general ledger', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new AccountingService({
      journal: { findMany },
      ledgerAccount: { findMany: jest.fn().mockResolvedValue([]) },
    } as never);
    await service.ledger('org-a', {});
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['POSTED', 'REVERSED'] } }),
      }),
    );
  });
});
