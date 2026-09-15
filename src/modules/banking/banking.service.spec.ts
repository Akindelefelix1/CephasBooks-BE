import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { jest } from '@jest/globals';
import { BankingService } from './banking.service.ts';

describe('BankingService', () => {
  it('calculates every dashboard total within the authenticated organization', async () => {
    const aggregate = jest.fn();
    const groupBy = jest.fn();
    const prisma = {
      organization: { findUniqueOrThrow: jest.fn().mockResolvedValue({ baseCurrency: 'NGN' }) },
      bankAccount: { groupBy },
      bankTransaction: { aggregate },
      $transaction: jest.fn().mockResolvedValue([
        [{ currency: 'NGN', _sum: { currentBalance: new Prisma.Decimal(1000) } }],
        { _sum: { amount: new Prisma.Decimal(600) } },
        { _sum: { amount: new Prisma.Decimal(200) } },
        { _sum: { amount: new Prisma.Decimal(50) }, _count: 2 },
      ]),
    };
    const result = await new BankingService(prisma as never).summary('org-a');
    expect(groupBy).toHaveBeenCalledWith({
      by: ['currency'],
      where: { organizationId: 'org-a', isActive: true },
      _sum: { currentBalance: true },
    });
    expect(result.unreconciledCount).toBe(2);
    expect(result.totalCash.toString()).toBe('1000');
  });

  it('does not reconcile a transaction belonging to another organization', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const service = new BankingService({ bankTransaction: { findFirst } } as never);
    await expect(service.reconcile('org-a', 'transaction-id', 'RECONCILED')).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'transaction-id', organizationId: 'org-a' } });
  });

  it('sets both opening and current balances when an account is created', async () => {
    const create = jest.fn().mockImplementation((input) => Promise.resolve(input));
    const service = new BankingService({ bankAccount: { create } } as never);
    await service.createAccount('org-a', { name: 'Main account', bankName: 'Bank', accountType: 'CURRENT', currency: 'ngn', openingBalance: 250 });
    const data = (create.mock.calls[0]?.[0] as { data: { organizationId: string; currentBalance: Prisma.Decimal; currency: string } }).data;
    expect(data.organizationId).toBe('org-a');
    expect(data.currency).toBe('NGN');
    expect(data.currentBalance.toString()).toBe('250');
  });

  it('rejects transfers that use the same source and destination account', async () => {
    const service = new BankingService({} as never);
    await expect(service.transfer('org-a', { fromAccountId: 'same', toAccountId: 'same', transactionDate: '2026-09-15', amount: 10 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validates every CSV row before starting an import transaction', async () => {
    const transaction = jest.fn();
    const service = new BankingService({ bankAccount: { findFirst: jest.fn().mockResolvedValue({ id: 'account', isActive: true }) }, $transaction: transaction } as never);
    await expect(service.importTransactions('org-a', { bankAccountId: 'account', csv: 'date,description,type,amount\ninvalid,,MONEY_IN,10' })).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('excludes reversed records from transaction lists', async () => {
    const findMany = jest.fn().mockResolvedValue([]), count = jest.fn().mockResolvedValue(0);
    const service = new BankingService({ bankTransaction: { findMany, count }, $transaction: jest.fn().mockResolvedValue([[], 0]) } as never);
    await service.transactions('org-a', {});
    const request = findMany.mock.calls[0]?.[0] as { where: { organizationId: string; reversedAt: null } };
    expect(request.where).toMatchObject({ organizationId: 'org-a', reversedAt: null });
  });
});
