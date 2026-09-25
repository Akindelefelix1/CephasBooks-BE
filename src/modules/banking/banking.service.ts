import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BankTransactionType, Prisma, ReconciliationStatus } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.ts';
import { assertBranch } from '../../common/branch-scope.ts';
import {
  CreateBankAccountDto,
  CreateBankTransactionDto,
  CreateBankTransactionsDto,
  CreateTransferDto,
  ImportTransactionsDto,
  UpdateBankAccountDto,
  UpdateBankTransactionDto,
} from './dto/banking.dto.ts';

@Injectable()
export class BankingService {
  constructor(private readonly prisma: PrismaService) {}

  private async account(organizationId: string, id: string) {
    const account = await this.prisma.bankAccount.findFirst({ where: { id, organizationId } });
    if (!account) throw new NotFoundException('Bank account not found');
    return account;
  }

  private async recalculateAccount(
    tx: Prisma.TransactionClient,
    organizationId: string,
    accountId: string,
  ) {
    const account = await tx.bankAccount.findFirst({ where: { id: accountId, organizationId } });
    if (!account) throw new NotFoundException('Bank account not found');
    const rows = await tx.bankTransaction.findMany({
      where: { organizationId, bankAccountId: accountId, reversedAt: null },
      orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }],
    });
    let balance = account.openingBalance;
    for (const row of rows) {
      balance = balance.add(row.type === 'MONEY_IN' ? row.amount : row.amount.negated());
      if (!row.balanceAfter.equals(balance))
        await tx.bankTransaction.update({ where: { id: row.id }, data: { balanceAfter: balance } });
    }
    await tx.bankAccount.update({ where: { id: accountId }, data: { currentBalance: balance } });
    return balance;
  }

  private async serializable<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2034' ||
          attempt === 2
        )
          throw error;
      }
    }
    throw new BadRequestException('Unable to complete banking operation');
  }

  async summary(organizationId: string) {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { baseCurrency: true },
    });
    const [cash, moneyIn, moneyOut, unreconciled] = await this.prisma.$transaction([
      this.prisma.bankAccount.groupBy({
        by: ['currency'],
        where: { organizationId, isActive: true },
        _sum: { currentBalance: true },
      }),
      this.prisma.bankTransaction.aggregate({
        where: {
          organizationId,
          type: 'MONEY_IN',
          reversedAt: null,
          bankAccount: { currency: organization.baseCurrency },
          transactionDate: { gte: monthStart },
        },
        _sum: { amount: true },
      }),
      this.prisma.bankTransaction.aggregate({
        where: {
          organizationId,
          type: 'MONEY_OUT',
          reversedAt: null,
          bankAccount: { currency: organization.baseCurrency },
          transactionDate: { gte: monthStart },
        },
        _sum: { amount: true },
      }),
      this.prisma.bankTransaction.aggregate({
        where: {
          organizationId,
          reconciliationStatus: 'UNRECONCILED',
          reversedAt: null,
          bankAccount: { currency: organization.baseCurrency },
        },
        _sum: { amount: true },
        _count: true,
      }),
    ]);
    const totalsByCurrency = cash.map((item) => ({
      currency: item.currency,
      amount: item._sum.currentBalance ?? 0,
    }));
    return {
      baseCurrency: organization.baseCurrency,
      totalCash:
        totalsByCurrency.find((item) => item.currency === organization.baseCurrency)?.amount ?? 0,
      totalsByCurrency,
      moneyIn: moneyIn._sum.amount ?? 0,
      moneyOut: moneyOut._sum.amount ?? 0,
      unreconciledCount: unreconciled._count,
      unreconciledAmount: unreconciled._sum.amount ?? 0,
    };
  }

  accounts(organizationId: string, includeArchived = false) {
    return this.prisma.bankAccount.findMany({
      where: { organizationId, ...(includeArchived ? {} : { isActive: true }) },
      include: {
        _count: {
          select: {
            transactions: { where: { reconciliationStatus: 'UNRECONCILED', reversedAt: null } },
          },
        },
      },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async createAccount(organizationId: string, dto: CreateBankAccountDto) {
    const openingBalance = new Prisma.Decimal(dto.openingBalance);
    const currency = dto.currency?.toUpperCase() ?? (await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { baseCurrency: true },
    })).baseCurrency;
    return this.prisma.bankAccount.create({
      data: {
        ...dto,
        currency,
        openingBalance,
        currentBalance: openingBalance,
        organizationId,
      },
    });
  }

  async updateAccount(organizationId: string, id: string, dto: UpdateBankAccountDto) {
    await this.account(organizationId, id);
    return this.prisma.bankAccount.update({ where: { id }, data: dto });
  }

  async deleteAccount(organizationId: string, id: string) {
    const account = await this.account(organizationId, id);
    if (account.isActive) throw new BadRequestException('Archive the account before deleting it');
    const [transactions, payments, expenses] = await this.prisma.$transaction([
      this.prisma.bankTransaction.count({ where: { organizationId, bankAccountId: id } }),
      this.prisma.supplierPayment.count({ where: { organizationId, bankAccountId: id } }),
      this.prisma.expense.count({ where: { organizationId, bankAccountId: id } }),
    ]);
    if (transactions || payments || expenses)
      throw new BadRequestException(
        'This account has financial history and cannot be permanently deleted',
      );
    await this.prisma.bankAccount.delete({ where: { id } });
    return { deleted: true };
  }

  private transactionWhere(
    organizationId: string,
    query: Record<string, string>,
  ): Prisma.BankTransactionWhereInput {
    return {
      organizationId,
      reversedAt: null,
      ...(query.accountId ? { bankAccountId: query.accountId } : {}),
      ...(query.status ? { reconciliationStatus: query.status as ReconciliationStatus } : {}),
      ...(query.type ? { type: query.type as BankTransactionType } : {}),
      ...(query.search
        ? {
            OR: [
              { description: { contains: query.search, mode: 'insensitive' } },
              { reference: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.from || query.to
        ? {
            transactionDate: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
  }

  async transactions(organizationId: string, query: Record<string, string>) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
    const where = this.transactionWhere(organizationId, query);
    const [data, total] = await this.prisma.$transaction([
      this.prisma.bankTransaction.findMany({
        where,
        include: { bankAccount: { select: { id: true, name: true, currency: true } } },
        orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.bankTransaction.count({ where }),
    ]);
    return { data, meta: { page, limit, total, pages: Math.ceil(total / limit) } };
  }

  reversalHistory(organizationId: string) {
    return this.prisma.bankTransaction.findMany({
      where: { organizationId, reversedAt: { not: null } },
      include: {
        bankAccount: { select: { id: true, name: true, currency: true } },
        reversedBy: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
      orderBy: { reversedAt: 'desc' },
      take: 200,
    });
  }

  async createTransaction(organizationId: string, dto: CreateBankTransactionDto) {
    await assertBranch(this.prisma, organizationId, dto.branchId);
    const account = await this.account(organizationId, dto.bankAccountId);
    if (!account.isActive) throw new BadRequestException('Bank account is archived');
    const amount = new Prisma.Decimal(dto.amount);
    return this.serializable(async (tx) => {
      const transaction = await tx.bankTransaction.create({
        data: {
          organizationId,
          branchId: dto.branchId,
          bankAccountId: dto.bankAccountId,
          transactionDate: new Date(dto.transactionDate),
          name: dto.name,
          description: dto.description,
          reference: dto.reference,
          type: dto.type,
          amount,
          balanceAfter: account.currentBalance,
          notes: dto.notes,
        },
      });
      await this.recalculateAccount(tx, organizationId, account.id);
      return transaction;
    });
  }

  async createTransactions(organizationId: string, dto: CreateBankTransactionsDto) {
    await assertBranch(this.prisma, organizationId, undefined);
    const account = await this.account(organizationId, dto.bankAccountId);
    if (!account.isActive) throw new BadRequestException('Bank account is archived');
    return this.serializable(async (tx) => {
      const created = [];
      for (const row of dto.transactions) {
        created.push(await tx.bankTransaction.create({
          data: {
            organizationId,
            bankAccountId: dto.bankAccountId,
            transactionDate: new Date(dto.transactionDate),
            name: row.name,
            description: row.description,
            reference: row.reference,
            type: dto.type,
            amount: new Prisma.Decimal(row.amount),
            balanceAfter: account.currentBalance,
            notes: dto.notes,
          },
        }));
      }
      await this.recalculateAccount(tx, organizationId, dto.bankAccountId);
      return created;
    });
  }

  async updateTransaction(organizationId: string, id: string, dto: UpdateBankTransactionDto) {
    const existing = await this.prisma.bankTransaction.findFirst({
      where: { id, organizationId, reversedAt: null },
    });
    if (!existing) throw new NotFoundException('Bank transaction not found');
    if (existing.transferGroupId)
      throw new BadRequestException('Transfer entries must be reversed instead of edited');
    if (existing.sourceType)
      throw new BadRequestException('Linked transactions must be changed from their source record');
    return this.serializable(async (tx) => {
      await tx.bankTransaction.update({
        where: { id },
        data: {
          ...dto,
          ...(dto.transactionDate ? { transactionDate: new Date(dto.transactionDate) } : {}),
          ...(dto.amount ? { amount: new Prisma.Decimal(dto.amount) } : {}),
        },
      });
      await this.recalculateAccount(tx, organizationId, existing.bankAccountId);
      return tx.bankTransaction.findUniqueOrThrow({ where: { id } });
    });
  }

  async reverseTransaction(organizationId: string, actorId: string, id: string, reason: string) {
    const normalizedReason = reason.trim();
    if (!normalizedReason) throw new BadRequestException('A reversal reason is required');
    const existing = await this.prisma.bankTransaction.findFirst({
      where: { id, organizationId, reversedAt: null },
    });
    if (!existing) throw new NotFoundException('Bank transaction not found');
    if (existing.sourceType)
      throw new BadRequestException(
        'Reverse this transaction from its originating payment or expense',
      );
    return this.serializable(async (tx) => {
      const reversedAt = new Date();
      if (existing.transferGroupId)
        await tx.bankTransaction.updateMany({
          where: { organizationId, transferGroupId: existing.transferGroupId, reversedAt: null },
          data: { reversedAt, reversedById: actorId, reversalReason: normalizedReason },
        });
      else
        await tx.bankTransaction.update({
          where: { id },
          data: { reversedAt, reversedById: actorId, reversalReason: normalizedReason },
        });
      const accountIds = existing.transferGroupId
        ? (
            await tx.bankTransaction.findMany({
              where: { organizationId, transferGroupId: existing.transferGroupId },
              select: { bankAccountId: true },
              distinct: ['bankAccountId'],
            })
          ).map((x) => x.bankAccountId)
        : [existing.bankAccountId];
      for (const accountId of accountIds)
        await this.recalculateAccount(tx, organizationId, accountId);
      return { reversed: true, reversedAt };
    });
  }

  async transfer(organizationId: string, dto: CreateTransferDto) {
    if (dto.fromAccountId === dto.toAccountId)
      throw new BadRequestException('Transfer accounts must be different');
    const [from, to] = await Promise.all([
      this.account(organizationId, dto.fromAccountId),
      this.account(organizationId, dto.toAccountId),
    ]);
    if (!from.isActive || !to.isActive)
      throw new BadRequestException('Transfer accounts must be active');
    if (from.currency !== to.currency)
      throw new BadRequestException(
        'Transfers between different currencies require an exchange rate',
      );
    const amount = new Prisma.Decimal(dto.amount),
      transferGroupId = randomUUID(),
      transactionDate = new Date(dto.transactionDate);
    return this.serializable(async (tx) => {
      await tx.bankTransaction.createMany({
        data: [
          {
            organizationId,
            bankAccountId: from.id,
            transactionDate,
            description: `Transfer to ${to.name}`,
            reference: dto.reference,
            type: 'MONEY_OUT',
            amount,
            balanceAfter: from.currentBalance,
            notes: dto.notes,
            transferGroupId,
          },
          {
            organizationId,
            bankAccountId: to.id,
            transactionDate,
            description: `Transfer from ${from.name}`,
            reference: dto.reference,
            type: 'MONEY_IN',
            amount,
            balanceAfter: to.currentBalance,
            notes: dto.notes,
            transferGroupId,
          },
        ],
      });
      await this.recalculateAccount(tx, organizationId, from.id);
      await this.recalculateAccount(tx, organizationId, to.id);
      return { transferGroupId };
    });
  }

  async reconcile(organizationId: string, id: string, status: ReconciliationStatus) {
    const row = await this.prisma.bankTransaction.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundException('Bank transaction not found');
    return this.prisma.bankTransaction.update({
      where: { id },
      data: {
        reconciliationStatus: status,
        reconciledAt: status === 'RECONCILED' ? new Date() : null,
      },
    });
  }

  async importTransactions(organizationId: string, dto: ImportTransactionsDto) {
    await this.account(organizationId, dto.bankAccountId);
    const lines = dto.csv
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .filter(Boolean);
    if (lines.length < 2)
      throw new BadRequestException('CSV must contain a header and at least one transaction');
    const headers = lines[0]!.split(',').map((x) => x.trim().toLowerCase());
    if (['date', 'description', 'type', 'amount'].some((x) => !headers.includes(x)))
      throw new BadRequestException('CSV headers must include date, description, type and amount');
    const parsed: Array<CreateBankTransactionDto & { importFingerprint: string }> = [];
    for (const line of lines.slice(1)) {
      const values: string[] = [];
      let current = '',
        quoted = false;
      for (let index = 0; index < line.length; index++) {
        const char = line[index];
        if (char === '"' && line[index + 1] === '"' && quoted) {
          current += '"';
          index++;
        } else if (char === '"') quoted = !quoted;
        else if (char === ',' && !quoted) {
          values.push(current.trim());
          current = '';
        } else current += char;
      }
      values.push(current.trim());
      const value = (name: string) => values[headers.indexOf(name)] ?? '';
      const type = value('type').toUpperCase().replace(/\s+/g, '_') as BankTransactionType;
      const amount = Number(value('amount').replace(/[^0-9.-]/g, ''));
      if (
        !value('description') ||
        !Object.values(BankTransactionType).includes(type) ||
        amount <= 0 ||
        Number.isNaN(Date.parse(value('date')))
      )
        throw new BadRequestException(`Invalid CSV row ${parsed.length + 2}`);
      const fingerprint = createHash('sha256')
        .update(
          [
            dto.bankAccountId,
            value('date'),
            value('description'),
            value('reference'),
            type,
            amount,
          ].join('|'),
        )
        .digest('hex');
      parsed.push({
        bankAccountId: dto.bankAccountId,
        transactionDate: value('date'),
        name: value('name') || value('description'),
        description: value('description'),
        reference: value('reference') || undefined,
        type,
        amount,
        importFingerprint: fingerprint,
      });
    }
    return this.serializable(async (tx) => {
      const duplicates = await tx.bankTransaction.count({
        where: {
          organizationId,
          bankAccountId: dto.bankAccountId,
          importFingerprint: { in: parsed.map((row) => row.importFingerprint) },
        },
      });
      if (duplicates)
        throw new BadRequestException(
          'This statement contains transactions that were already imported',
        );
      await tx.bankTransaction.createMany({
        data: parsed.map((row) => ({
          ...row,
          organizationId,
          transactionDate: new Date(row.transactionDate),
          amount: new Prisma.Decimal(row.amount),
          balanceAfter: 0,
        })),
      });
      await this.recalculateAccount(tx, organizationId, dto.bankAccountId);
      return { imported: parsed.length };
    });
  }

  async exportTransactions(organizationId: string, query: Record<string, string>) {
    const data = await this.prisma.bankTransaction.findMany({
      where: this.transactionWhere(organizationId, query),
      include: { bankAccount: { select: { name: true } } },
      orderBy: { transactionDate: 'desc' },
    });
    const escape = (value: string | number | Date | Prisma.Decimal | null) => {
      const text =
        value === null ? '' : value instanceof Date ? value.toISOString() : value.toString();
      return `"${text.replace(/"/g, '""')}"`;
    };
    const rows = data.map((x) =>
      [
        x.transactionDate.toISOString().slice(0, 10),
        x.bankAccount.name,
        x.description,
        x.reference,
        x.type,
        x.amount,
        x.balanceAfter,
        x.reconciliationStatus,
      ]
        .map(escape)
        .join(','),
    );
    return {
      filename: `bank-transactions-${new Date().toISOString().slice(0, 10)}.csv`,
      csv: ['Date,Account,Description,Reference,Type,Amount,Balance,Status', ...rows].join('\n'),
    };
  }
}
