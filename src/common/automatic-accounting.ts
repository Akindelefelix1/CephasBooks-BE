import { BadRequestException } from '@nestjs/common';
import { LedgerAccountType, Prisma } from '@prisma/client';

const systemAccounts: Record<string, { name: string; type: LedgerAccountType }> = {
  '1000': { name: 'Cash and bank', type: 'ASSET' },
  '1100': { name: 'Accounts receivable', type: 'ASSET' },
  '1150': { name: 'Tax receivable', type: 'ASSET' },
  '1200': { name: 'Fixed assets', type: 'ASSET' },
  '1300': { name: 'Inventory', type: 'ASSET' },
  '2000': { name: 'Accounts payable', type: 'LIABILITY' },
  '2100': { name: 'Tax payable', type: 'LIABILITY' },
  '3000': { name: 'Retained earnings', type: 'EQUITY' },
  '3900': { name: 'Opening balance equity', type: 'EQUITY' },
  '4000': { name: 'Sales revenue', type: 'INCOME' },
  '4900': { name: 'Inventory adjustment gain', type: 'INCOME' },
  '5000': { name: 'Purchases', type: 'EXPENSE' },
  '5100': { name: 'Operating expenses', type: 'EXPENSE' },
  '5200': { name: 'Payroll expense', type: 'EXPENSE' },
  '5300': { name: 'Cost of goods sold', type: 'EXPENSE' },
  '5400': { name: 'Fixed asset disposal loss', type: 'EXPENSE' },
  '5900': { name: 'Inventory adjustment loss', type: 'EXPENSE' },
  '9999': { name: 'Uncategorized bank transactions', type: 'LIABILITY' },
};

export interface AutomaticJournalLine {
  accountCode: string;
  debit: Prisma.Decimal | number;
  credit: Prisma.Decimal | number;
  memo?: string;
}

export async function postAutomaticJournal(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    number: string;
    journalDate: Date;
    description: string;
    lines: AutomaticJournalLine[];
  },
) {
  const existing = await tx.journal.findFirst({
    where: { organizationId: input.organizationId, number: input.number },
  });
  if (existing) return existing;

  const normalized = input.lines
    .map((line) => ({
      ...line,
      debit: new Prisma.Decimal(line.debit),
      credit: new Prisma.Decimal(line.credit),
    }))
    .filter((line) => !line.debit.isZero() || !line.credit.isZero());
  const debitTotal = normalized.reduce((sum, line) => sum.add(line.debit), new Prisma.Decimal(0));
  const creditTotal = normalized.reduce((sum, line) => sum.add(line.credit), new Prisma.Decimal(0));
  if (
    !normalized.length ||
    debitTotal.lte(0) ||
    !debitTotal.equals(creditTotal) ||
    normalized.some((line) => line.debit.gt(0) === line.credit.gt(0))
  )
    throw new BadRequestException('Automatic journal debits and credits must balance');

  const codes = [...new Set(normalized.map((line) => line.accountCode))];
  for (const code of codes) {
    const account = systemAccounts[code];
    if (!account) throw new BadRequestException(`No automatic account mapping exists for ${code}`);
    await tx.ledgerAccount.upsert({
      where: { organizationId_code: { organizationId: input.organizationId, code } },
      create: { organizationId: input.organizationId, code, ...account, isSystem: true },
      update: {},
    });
  }
  const accounts = await tx.ledgerAccount.findMany({
    where: { organizationId: input.organizationId, code: { in: codes }, isActive: true },
    select: { id: true, code: true },
  });
  const accountIds = new Map(accounts.map((account) => [account.code, account.id]));
  if (accountIds.size !== codes.length)
    throw new BadRequestException('An automatic journal account is unavailable');

  const journalLines = normalized.map((line) => {
    const accountId = accountIds.get(line.accountCode);
    if (!accountId) throw new BadRequestException('An automatic journal account is unavailable');
    return {
      accountId,
      debit: line.debit.toNumber(),
      credit: line.credit.toNumber(),
      memo: line.memo,
    };
  });
  return tx.journal.create({
    data: {
      organizationId: input.organizationId,
      number: input.number,
      journalDate: input.journalDate,
      description: input.description,
      status: 'POSTED',
      postedAt: new Date(),
      total: debitTotal,
      lines: journalLines,
    },
  });
}

export async function reverseAutomaticJournal(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    number: string;
    reversalNumber: string;
    journalDate: Date;
    description: string;
  },
) {
  const journal = await tx.journal.findFirst({
    where: { organizationId: input.organizationId, number: input.number },
  });
  if (!journal || journal.status !== 'POSTED') return null;
  const existingReversal = await tx.journal.findFirst({
    where: { organizationId: input.organizationId, number: input.reversalNumber },
  });
  if (existingReversal) return existingReversal;
  const lines = journal.lines as Array<{
    accountId: string;
    debit: number;
    credit: number;
    memo?: string;
  }>;
  const reversal = await tx.journal.create({
    data: {
      organizationId: input.organizationId,
      number: input.reversalNumber,
      journalDate: input.journalDate,
      description: input.description,
      status: 'POSTED',
      postedAt: new Date(),
      lines: lines.map((line) => ({ ...line, debit: line.credit, credit: line.debit })),
      total: journal.total,
      reversedJournalId: journal.id,
    },
  });
  await tx.journal.update({ where: { id: journal.id }, data: { status: 'REVERSED' } });
  return reversal;
}