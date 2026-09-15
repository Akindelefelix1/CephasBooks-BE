import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FinanceRecordKind, LedgerAccountType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.ts';
import { AccountDto, FinanceRecordDto, JournalDto, JournalLineDto } from './dto/accounting.dto.ts';
const defaults: [string, string, LedgerAccountType][] = [
  ['1000', 'Cash and bank', 'ASSET'],
  ['1100', 'Accounts receivable', 'ASSET'],
  ['1150', 'Tax receivable', 'ASSET'],
  ['1200', 'Fixed assets', 'ASSET'],
  ['2000', 'Accounts payable', 'LIABILITY'],
  ['2100', 'Tax payable', 'LIABILITY'],
  ['3000', 'Retained earnings', 'EQUITY'],
  ['4000', 'Sales revenue', 'INCOME'],
  ['5000', 'Purchases', 'EXPENSE'],
  ['5100', 'Operating expenses', 'EXPENSE'],
  ['5200', 'Payroll expense', 'EXPENSE'],
];
@Injectable()
export class AccountingService {
  constructor(private readonly db: PrismaService) {}
  private async seed(org: string) {
    for (const [code, name, type] of defaults)
      await this.db.ledgerAccount.upsert({
        where: { organizationId_code: { organizationId: org, code } },
        create: { organizationId: org, code, name, type, isSystem: true },
        update: {},
      });
  }
  async accounts(org: string, all = false) {
    await this.seed(org);
    return this.db.ledgerAccount.findMany({
      where: { organizationId: org, ...(all ? {} : { isActive: true }) },
      orderBy: { code: 'asc' },
    });
  }
  async createAccount(org: string, d: AccountDto) {
    return this.db.ledgerAccount.create({ data: { ...d, organizationId: org } });
  }
  async accountStatus(org: string, id: string, isActive: boolean) {
    const a = await this.db.ledgerAccount.findFirst({ where: { id, organizationId: org } });
    if (!a) throw new NotFoundException('Ledger account not found');
    if (a.isSystem && !isActive)
      throw new BadRequestException('System accounts cannot be archived');
    return this.db.ledgerAccount.update({ where: { id }, data: { isActive } });
  }
  journals(org: string, q: Record<string, string>) {
    return this.db.journal.findMany({
      where: {
        organizationId: org,
        ...(q.status ? { status: q.status as never } : {}),
        ...(q.search
          ? {
              OR: [
                { number: { contains: q.search, mode: 'insensitive' } },
                { description: { contains: q.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ journalDate: 'desc' }, { createdAt: 'desc' }],
    });
  }
  private validate(lines: JournalLineDto[]) {
    const debit = lines.reduce((s, x) => s.add(x.debit), new Prisma.Decimal(0)),
      credit = lines.reduce((s, x) => s.add(x.credit), new Prisma.Decimal(0));
    if (debit.lte(0) || !debit.equals(credit))
      throw new BadRequestException(
        'Journal debits and credits must be equal and greater than zero',
      );
    if (lines.some((x) => (x.debit > 0 && x.credit > 0) || (!x.debit && !x.credit)))
      throw new BadRequestException('Each journal line must contain either a debit or a credit');
    return debit;
  }
  async createJournal(org: string, d: JournalDto) {
    const ids = [...new Set(d.lines.map((x) => x.accountId))],
      count = await this.db.ledgerAccount.count({
        where: { organizationId: org, id: { in: ids }, isActive: true },
      });
    if (count !== ids.length)
      throw new BadRequestException(
        'Every journal account must be active and belong to this organization',
      );
    const total = this.validate(d.lines);
    return this.db.journal.create({
      data: {
        ...d,
        organizationId: org,
        journalDate: new Date(d.journalDate),
        lines: d.lines as unknown as Prisma.InputJsonValue,
        total,
      },
    });
  }
  async postJournal(org: string, id: string) {
    const j = await this.db.journal.findFirst({ where: { id, organizationId: org } });
    if (!j) throw new NotFoundException('Journal not found');
    if (j.status !== 'DRAFT') throw new BadRequestException('Only draft journals can be posted');
    const lines = j.lines as unknown as JournalLineDto[];
    this.validate(lines);
    const ids = [...new Set(lines.map((x) => x.accountId))];
    const activeAccounts = await this.db.ledgerAccount.count({
      where: { organizationId: org, id: { in: ids }, isActive: true },
    });
    if (activeAccounts !== ids.length)
      throw new BadRequestException('A journal account was archived or is no longer available');
    return this.db.journal.update({
      where: { id },
      data: { status: 'POSTED', postedAt: new Date() },
    });
  }
  async reverseJournal(org: string, id: string) {
    const j = await this.db.journal.findFirst({ where: { id, organizationId: org } });
    if (!j) throw new NotFoundException('Journal not found');
    if (j.status !== 'POSTED')
      throw new BadRequestException('Only posted journals can be reversed');
    const lines = (j.lines as unknown as JournalLineDto[]).map((x) => ({
      ...x,
      debit: x.credit,
      credit: x.debit,
    }));
    return this.db.$transaction(async (tx) => {
      const reversal = await tx.journal.create({
        data: {
          organizationId: org,
          number: `REV-${j.number}-${Date.now()}`,
          journalDate: new Date(),
          description: `Reversal: ${j.description}`,
          status: 'POSTED',
          postedAt: new Date(),
          lines,
          total: j.total,
          reversedJournalId: j.id,
        },
      });
      await tx.journal.update({ where: { id }, data: { status: 'REVERSED' } });
      return reversal;
    });
  }
  async ledger(org: string, q: Record<string, string>) {
    const journals = await this.db.journal.findMany({
      where: {
        organizationId: org,
        status: { in: ['POSTED', 'REVERSED'] },
        ...(q.from || q.to
          ? {
              journalDate: {
                ...(q.from ? { gte: new Date(q.from) } : {}),
                ...(q.to ? { lte: new Date(q.to) } : {}),
              },
            }
          : {}),
      },
      orderBy: { journalDate: 'asc' },
    });
    const accounts = await this.db.ledgerAccount.findMany({
      where: { organizationId: org },
      select: { id: true, code: true, name: true },
    });
    const accountById = new Map(accounts.map((account) => [account.id, account]));
    return journals.flatMap((j) =>
      (j.lines as unknown as JournalLineDto[])
        .filter((x) => !q.accountId || x.accountId === q.accountId)
        .map((x) => ({
          id: `${j.id}-${x.accountId}`,
          journalId: j.id,
          number: j.number,
          date: j.journalDate,
          description: j.description,
          accountId: x.accountId,
          account: accountById.get(x.accountId),
          debit: x.debit,
          credit: x.credit,
          memo: x.memo,
          status: j.status,
        })),
    );
  }
  async trialBalance(org: string, q: Record<string, string>) {
    const accounts = await this.accounts(org),
      lines = await this.ledger(org, q),
      balances = new Map(
        accounts.map((a) => [
          a.id,
          { debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(0) },
        ]),
      );
    for (const x of lines) {
      const b = balances.get(x.accountId);
      if (b) {
        b.debit = b.debit.add(x.debit);
        b.credit = b.credit.add(x.credit);
      }
    }
    const system = new Map(accounts.map((a) => [a.code, a.id]));
    const [banks, invoices, bills, expenses, assets, payroll] = await this.db.$transaction([
      this.db.bankAccount.aggregate({
        where: { organizationId: org, isActive: true },
        _sum: { currentBalance: true },
      }),
      this.db.invoice.aggregate({
        where: { organizationId: org, status: { not: 'VOID' } },
        _sum: { total: true, paidAmount: true, creditedAmount: true, taxTotal: true },
      }),
      this.db.bill.aggregate({
        where: { organizationId: org, status: { not: 'VOID' } },
        _sum: { total: true, paidAmount: true, taxTotal: true },
      }),
      this.db.expense.aggregate({
        where: { organizationId: org, status: 'APPROVED' },
        _sum: { amount: true, taxAmount: true },
      }),
      this.db.financeRecord.aggregate({
        where: { organizationId: org, kind: 'ASSET', status: { not: 'DISPOSED' } },
        _sum: { amount: true },
      }),
      this.db.financeRecord.aggregate({
        where: { organizationId: org, kind: 'PAYROLL', status: { in: ['APPROVED', 'PAID'] } },
        _sum: { amount: true },
      }),
    ]);
    const add = (
      code: string,
      debit: Prisma.Decimal | number = 0,
      credit: Prisma.Decimal | number = 0,
    ) => {
      const id = system.get(code),
        b = id && balances.get(id);
      if (b) {
        b.debit = b.debit.add(debit);
        b.credit = b.credit.add(credit);
      }
    };
    const invTotal = invoices._sum.total ?? new Prisma.Decimal(0),
      ar = invTotal.sub(invoices._sum.paidAmount ?? 0).sub(invoices._sum.creditedAmount ?? 0),
      billTotal = bills._sum.total ?? new Prisma.Decimal(0),
      ap = billTotal.sub(bills._sum.paidAmount ?? 0),
      expense = expenses._sum.amount ?? new Prisma.Decimal(0),
      asset = assets._sum.amount ?? new Prisma.Decimal(0),
      payrollTotal = payroll._sum.amount ?? new Prisma.Decimal(0);
    add('1000', banks._sum.currentBalance ?? 0);
    add('1100', ar);
    add('1200', asset);
    add('2000', 0, ap);
    const netTax = (invoices._sum.taxTotal ?? new Prisma.Decimal(0))
      .sub(bills._sum.taxTotal ?? 0)
      .sub(expenses._sum.taxAmount ?? 0);
    if (netTax.gte(0)) add('2100', 0, netTax);
    else add('1150', netTax.abs());
    add('4000', 0, invTotal);
    add('5000', billTotal);
    add('5100', expense);
    add('5200', payrollTotal);
    let debit = new Prisma.Decimal(0),
      credit = new Prisma.Decimal(0);
    for (const b of balances.values()) {
      debit = debit.add(b.debit);
      credit = credit.add(b.credit);
    }
    if (debit.gte(credit)) add('3000', 0, debit.sub(credit));
    else add('3000', credit.sub(debit));
    debit = new Prisma.Decimal(0);
    credit = new Prisma.Decimal(0);
    for (const b of balances.values()) {
      debit = debit.add(b.debit);
      credit = credit.add(b.credit);
    }
    return {
      rows: accounts.map((a) => ({
        account: a,
        debit: balances.get(a.id)!.debit,
        credit: balances.get(a.id)!.credit,
        balance: balances.get(a.id)!.debit.sub(balances.get(a.id)!.credit),
      })),
      totalDebit: debit,
      totalCredit: credit,
    };
  }
  records(org: string, kind: FinanceRecordKind, q: Record<string, string>) {
    return this.db.financeRecord.findMany({
      where: {
        organizationId: org,
        kind,
        ...(q.status ? { status: q.status } : {}),
        ...(q.search
          ? {
              OR: [
                { reference: { contains: q.search, mode: 'insensitive' } },
                { name: { contains: q.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { startDate: 'desc' },
    });
  }
  createRecord(org: string, d: FinanceRecordDto) {
    if (d.endDate && new Date(d.endDate) < new Date(d.startDate))
      throw new BadRequestException('End date cannot be before start date');
    return this.db.financeRecord.create({
      data: {
        ...d,
        organizationId: org,
        startDate: new Date(d.startDate),
        endDate: d.endDate ? new Date(d.endDate) : undefined,
        amount: new Prisma.Decimal(d.amount),
        data: d.data as Prisma.InputJsonValue,
      },
    });
  }
  async recordStatus(org: string, id: string, status: string) {
    const r = await this.db.financeRecord.findFirst({ where: { id, organizationId: org } });
    if (!r) throw new NotFoundException('Finance record not found');
    const allowed: Record<string, string[]> = {
      DRAFT: ['ACTIVE', 'APPROVED', 'CANCELLED'],
      PENDING: ['APPROVED', 'REJECTED'],
      ACTIVE: ['CLOSED', 'DISPOSED'],
      APPROVED: ['PAID', 'CLOSED'],
      PAID: ['CLOSED'],
    };
    if (!allowed[r.status]?.includes(status))
      throw new BadRequestException('Invalid status transition');
    return this.db.financeRecord.update({ where: { id }, data: { status } });
  }
  async summary(org: string) {
    const rows = await this.db.financeRecord.groupBy({
      by: ['kind'],
      where: { organizationId: org, status: { notIn: ['CANCELLED', 'REJECTED', 'DISPOSED'] } },
      _sum: { amount: true },
      _count: true,
    });
    return rows;
  }
}
