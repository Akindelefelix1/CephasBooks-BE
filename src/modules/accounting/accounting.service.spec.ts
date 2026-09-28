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
        // Jest's asymmetric matcher is intentionally dynamic.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        where: expect.objectContaining({ status: { in: ['POSTED', 'REVERSED'] } }),
      }),
    );
  });

  it('builds trial balance only from posted journal lines', async () => {
    const accounts = [
      { id: 'cash', code: '1000', name: 'Cash and bank' },
      { id: 'sales', code: '4000', name: 'Sales revenue' },
    ];
    const journalFindMany = jest.fn().mockResolvedValue([
      {
        id: 'journal',
        number: 'POS-1',
        journalDate: new Date('2026-09-28'),
        description: 'POS sale',
        status: 'POSTED',
        lines: [
          { accountId: 'cash', debit: 100000, credit: 0 },
          { accountId: 'sales', debit: 0, credit: 100000 },
        ],
      },
    ]);
    const service = new AccountingService({
      ledgerAccount: {
        upsert: jest.fn(),
        findMany: jest.fn().mockResolvedValue(accounts),
      },
      journal: { findMany: journalFindMany },
    } as never);

    const result = await service.trialBalance('org-a', {});

    expect(result.totalDebit.toString()).toBe('100000');
    expect(result.totalCredit.toString()).toBe('100000');
    expect(result.rows.map((row) => [row.account.code, row.debit.toString(), row.credit.toString()])).toEqual([
      ['1000', '100000', '0'],
      ['4000', '0', '100000'],
    ]);
    expect(journalFindMany).toHaveBeenCalledTimes(1);
  });
});
