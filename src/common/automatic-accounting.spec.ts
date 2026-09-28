import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { jest } from '@jest/globals';
import { postAutomaticJournal } from './automatic-accounting.ts';

describe('automatic accounting', () => {
  it('rejects unbalanced automatic journals before writing', async () => {
    const tx = {
      journal: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      ledgerAccount: { upsert: jest.fn(), findMany: jest.fn() },
    };
    await expect(
      postAutomaticJournal(tx as never, {
        organizationId: 'org-a',
        number: 'AUTO-1',
        journalDate: new Date('2026-09-28'),
        description: 'Unbalanced',
        lines: [
          { accountCode: '1000', debit: 100, credit: 0 },
          { accountCode: '4000', debit: 0, credit: 90 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.journal.create).not.toHaveBeenCalled();
    expect(tx.ledgerAccount.upsert).not.toHaveBeenCalled();
  });

  it('does not duplicate an existing source journal', async () => {
    const existing = { id: 'journal-id', number: 'AUTO-SOURCE-1' };
    const tx = {
      journal: { findFirst: jest.fn().mockResolvedValue(existing), create: jest.fn() },
      ledgerAccount: { upsert: jest.fn(), findMany: jest.fn() },
    };
    const result = await postAutomaticJournal(tx as never, {
      organizationId: 'org-a',
      number: existing.number,
      journalDate: new Date('2026-09-28'),
      description: 'Existing source',
      lines: [
        { accountCode: '1000', debit: 100, credit: 0 },
        { accountCode: '4000', debit: 0, credit: 100 },
      ],
    });
    expect(result).toBe(existing);
    expect(tx.journal.create).not.toHaveBeenCalled();
    expect(tx.ledgerAccount.upsert).not.toHaveBeenCalled();
  });

  it('posts balanced lines to organization system accounts', async () => {
    const accounts = [
      { id: 'cash-id', code: '1000' },
      { id: 'sales-id', code: '4000' },
    ];
    const tx = {
      journal: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation((input) => Promise.resolve(input.data)),
      },
      ledgerAccount: {
        upsert: jest.fn().mockResolvedValue(undefined),
        findMany: jest.fn().mockResolvedValue(accounts),
      },
    };
    const amount = new Prisma.Decimal(100000);
    const result = await postAutomaticJournal(tx as never, {
      organizationId: 'org-a',
      number: 'AUTO-POS-1',
      journalDate: new Date('2026-09-28'),
      description: 'POS sale',
      lines: [
        { accountCode: '1000', debit: amount, credit: 0 },
        { accountCode: '4000', debit: 0, credit: amount },
      ],
    });
    const lines = result.lines as Array<{ accountId: string; debit: number; credit: number }>;
    expect(lines).toEqual([
      { accountId: 'cash-id', debit: 100000, credit: 0, memo: undefined },
      { accountId: 'sales-id', debit: 0, credit: 100000, memo: undefined },
    ]);
    expect(lines.reduce((sum, line) => sum + line.debit, 0)).toBe(
      lines.reduce((sum, line) => sum + line.credit, 0),
    );
    expect(tx.ledgerAccount.upsert).toHaveBeenCalledTimes(2);
  });
});
