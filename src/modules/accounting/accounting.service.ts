import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FinanceRecordKind, LedgerAccountType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.ts';
import { postAutomaticJournal } from '../../common/automatic-accounting.ts';
import { AccountDto, AssetDepreciationSettingsDto, FinanceRecordDto, JournalDto, JournalLineDto } from './dto/accounting.dto.ts';

type AssetDepreciationSettings = AssetDepreciationSettingsDto;
const periodsPerYear = { MONTHLY: 12, QUARTERLY: 4, ANNUALLY: 1 } as const;
const asObject = (value: Prisma.JsonValue): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const fromIsoDate = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
const isoDate = (value: Date) => value.toISOString().slice(0, 10);
const addDays = (value: Date, count: number) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate() + count));
const addMonths = (value: Date, count: number) => {
  const monthIndex = value.getUTCMonth() + count;
  const year = value.getUTCFullYear() + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const day = Math.min(value.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return new Date(Date.UTC(year, month, day));
};
const roundMoney = (value: Prisma.Decimal | number) => new Prisma.Decimal(value).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
const defaults: [string, string, LedgerAccountType][] = [
  ['1000', 'Cash and bank', 'ASSET'],
  ['1100', 'Accounts receivable', 'ASSET'],
  ['1150', 'Tax receivable', 'ASSET'],
  ['1200', 'Fixed assets', 'ASSET'],
  ['1250', 'Accumulated depreciation', 'ASSET'],
  ['1300', 'Inventory', 'ASSET'],
  ['2000', 'Accounts payable', 'LIABILITY'],
  ['2100', 'Tax payable', 'LIABILITY'],
  ['3000', 'Retained earnings', 'EQUITY'],
  ['3900', 'Opening balance equity', 'EQUITY'],
  ['4000', 'Sales revenue', 'INCOME'],
  ['4900', 'Inventory adjustment gain', 'INCOME'],
  ['5000', 'Purchases', 'EXPENSE'],
  ['5100', 'Operating expenses', 'EXPENSE'],
  ['5200', 'Payroll expense', 'EXPENSE'],
  ['5300', 'Cost of goods sold', 'EXPENSE'],
  ['5400', 'Fixed asset disposal loss', 'EXPENSE'],
  ['5500', 'Depreciation expense', 'EXPENSE'],
  ['5900', 'Inventory adjustment loss', 'EXPENSE'],
  ['9999', 'Uncategorized bank transactions', 'LIABILITY'],
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
      const depreciationEntry = await tx.assetDepreciationEntry.findFirst({
        where: { organizationId: org, journalId: id, status: 'POSTED' },
      });
      if (depreciationEntry)
        await tx.$queryRaw`SELECT "id" FROM "FinanceRecord" WHERE "id" = ${depreciationEntry.assetId}::uuid AND "organizationId" = ${org}::uuid FOR UPDATE`;
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
      if (depreciationEntry) {
        await tx.assetDepreciationEntry.update({ where: { id: depreciationEntry.id }, data: { status: 'REVERSED' } });
        const [asset, remainingEntries] = await Promise.all([
          tx.financeRecord.findFirst({ where: { id: depreciationEntry.assetId, organizationId: org, kind: 'ASSET' } }),
          tx.assetDepreciationEntry.findMany({ where: { organizationId: org, assetId: depreciationEntry.assetId, status: 'POSTED' } }),
        ]);
        if (asset) {
          const accumulated = remainingEntries.reduce((sum, entry) => sum.add(entry.amount), new Prisma.Decimal(0));
          const carrying = Prisma.Decimal.max(0, new Prisma.Decimal(asset.amount).sub(accumulated));
          await tx.financeRecord.update({
            where: { id: asset.id },
            data: { data: { ...asObject(asset.data), accumulatedDepreciation: accumulated.toFixed(4), carryingAmount: carrying.toFixed(4) } as Prisma.InputJsonObject },
          });
        }
      }
      return {
        ...reversal,
        ...(depreciationEntry ? { depreciationAssetId: depreciationEntry.assetId } : {}),
      };
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
    let debit = new Prisma.Decimal(0),
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
  private async findAsset(org: string, id: string) {
    const asset = await this.db.financeRecord.findFirst({ where: { id, organizationId: org, kind: 'ASSET' } });
    if (!asset) throw new NotFoundException('Fixed asset not found');
    return asset;
  }
  private depreciationSettings(asset: { data: Prisma.JsonValue }): AssetDepreciationSettings | null {
    const depreciation = asObject(asset.data).depreciation;
    if (!depreciation || typeof depreciation !== 'object' || Array.isArray(depreciation)) return null;
    const value = depreciation as Record<string, unknown>;
    const valid = Number.isFinite(Number(value.residualValue)) && Number(value.residualValue) >= 0 && Number(value.usefulLifeYears) >= 1 && Number(value.usefulLifeYears) <= 100 &&
      Number.isInteger(Number(value.usefulLifeYears)) &&
      ['STRAIGHT_LINE', 'REDUCING_BALANCE'].includes(String(value.method)) &&
      ['MONTHLY', 'QUARTERLY', 'ANNUALLY'].includes(String(value.frequency)) &&
      (value.reducingBalanceRate === undefined || (Number.isFinite(Number(value.reducingBalanceRate)) && Number(value.reducingBalanceRate) > 0 && Number(value.reducingBalanceRate) <= 100));
    return valid ? value as unknown as AssetDepreciationSettings : null;
  }
  private validateDepreciationSettings(value: Record<string, unknown>, cost: number) {
    const residualValue = Number(value.residualValue);
    const usefulLifeYears = Number(value.usefulLifeYears);
    const method = String(value.method);
    const frequency = String(value.frequency);
    const reducingBalanceRate = value.reducingBalanceRate === undefined || value.reducingBalanceRate === ''
      ? undefined : Number(value.reducingBalanceRate);
    if (!Number.isFinite(residualValue) || residualValue < 0 || residualValue >= cost)
      throw new BadRequestException('Residual value must be at least zero and less than the acquisition cost');
    if (!Number.isInteger(usefulLifeYears) || usefulLifeYears < 1 || usefulLifeYears > 100)
      throw new BadRequestException('Useful life must be a whole number of years from 1 to 100');
    if (!['STRAIGHT_LINE', 'REDUCING_BALANCE'].includes(method))
      throw new BadRequestException('Select a valid depreciation method');
    if (!['MONTHLY', 'QUARTERLY', 'ANNUALLY'].includes(frequency))
      throw new BadRequestException('Select a valid depreciation frequency');
    if (method === 'REDUCING_BALANCE' && reducingBalanceRate !== undefined &&
      (!Number.isFinite(reducingBalanceRate) || reducingBalanceRate <= 0 || reducingBalanceRate > 100))
      throw new BadRequestException('Reducing balance rate must be greater than zero and no more than 100%');
    return { residualValue, usefulLifeYears, method, frequency, ...(reducingBalanceRate === undefined ? {} : { reducingBalanceRate }) } as AssetDepreciationSettings;
  }
  private schedule(asset: { id: string; startDate: Date; amount: Prisma.Decimal }, settings: AssetDepreciationSettings, entries: Array<{ periodEnd: Date; amount: Prisma.Decimal; accumulatedDepreciation: Prisma.Decimal; carryingAmount: Prisma.Decimal; status: string; journalId: string | null }>, throughDate: string) {
    const cost = new Prisma.Decimal(asset.amount);
    const residual = new Prisma.Decimal(settings.residualValue);
    if (!cost.gt(0) || residual.gte(cost)) throw new BadRequestException('Residual value must be less than the fixed asset cost');
    const ppy = periodsPerYear[settings.frequency];
    const intervalMonths = 12 / ppy;
    const totalPeriods = settings.usefulLifeYears * ppy;
    const annualRate = settings.method === 'REDUCING_BALANCE'
      ? settings.reducingBalanceRate !== undefined
        ? new Prisma.Decimal(settings.reducingBalanceRate).div(100)
        : residual.gt(0) ? new Prisma.Decimal(1).sub(residual.div(cost).pow(1 / settings.usefulLifeYears)) : new Prisma.Decimal(1 / settings.usefulLifeYears)
      : new Prisma.Decimal(0);
    const periodRate = new Prisma.Decimal(1).sub(new Prisma.Decimal(1).sub(annualRate).pow(1 / ppy));
    const acquired = fromIsoDate(isoDate(asset.startDate));
    const cutoff = fromIsoDate(throughDate);
    const recorded = new Map(entries.map((entry) => [isoDate(entry.periodEnd), entry]));
    let projectedAccumulated = new Prisma.Decimal(0);
    const schedule = Array.from({ length: totalPeriods }, (_, index) => {
      const periodStart = addMonths(acquired, index * intervalMonths);
      const nextStart = addMonths(acquired, (index + 1) * intervalMonths);
      const periodEnd = addDays(nextStart, -1);
      const openingCarrying = cost.sub(projectedAccumulated);
      const remainingDepreciable = Prisma.Decimal.max(0, openingCarrying.sub(residual));
      const calculated = index === totalPeriods - 1
        ? remainingDepreciable
        : settings.method === 'STRAIGHT_LINE'
          ? Prisma.Decimal.min(remainingDepreciable, cost.sub(residual).div(totalPeriods))
          : Prisma.Decimal.min(remainingDepreciable, openingCarrying.mul(periodRate));
      const amount = roundMoney(calculated);
      projectedAccumulated = Prisma.Decimal.min(cost.sub(residual), projectedAccumulated.add(amount));
      const history = recorded.get(isoDate(periodEnd));
      return {
        period: index + 1,
        periodStart: isoDate(periodStart),
        periodEnd: isoDate(periodEnd),
        openingCarryingAmount: openingCarrying.toFixed(4),
        depreciationAmount: history?.amount.toFixed(4) ?? amount.toFixed(4),
        accumulatedDepreciation: history?.accumulatedDepreciation.toFixed(4) ?? projectedAccumulated.toFixed(4),
        carryingAmount: history?.carryingAmount.toFixed(4) ?? cost.sub(projectedAccumulated).toFixed(4),
        status: history?.status ?? (amount.isZero() ? 'NO_DEPRECIATION' : periodEnd <= cutoff ? 'DUE' : 'SCHEDULED'),
        journalId: history?.journalId ?? null,
      };
    });
    return schedule;
  }
  private async businessToday(org: string) {
    const organization = await this.db.organization.findUnique({ where: { id: org }, select: { onboardingData: true } });
    const root = asObject(organization?.onboardingData ?? {});
    const financial = asObject(root.financial as Prisma.JsonValue);
    const admin = asObject(root.admin as Prisma.JsonValue);
    const timezone = String(financial.timezone ?? asObject(admin.preferences as Prisma.JsonValue).timezone ?? 'Africa/Lagos');
    try {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
      const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
      return `${part('year')}-${part('month')}-${part('day')}`;
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  }
  async assetDepreciation(org: string, id: string) {
    const [asset, entries, today] = await Promise.all([
      this.findAsset(org, id),
      this.db.assetDepreciationEntry.findMany({ where: { organizationId: org, assetId: id }, include: { journal: { select: { id: true, number: true, status: true } } }, orderBy: { periodEnd: 'asc' } }),
      this.businessToday(org),
    ]);
    const settings = this.depreciationSettings(asset);
    const cost = new Prisma.Decimal(asset.amount);
    const accumulated = entries.filter((entry) => entry.status === 'POSTED').reduce((sum, entry) => sum.add(entry.amount), new Prisma.Decimal(0));
    const schedule = settings ? this.schedule(asset, settings, entries, today) : [];
    const history = entries.map((entry) => ({ ...entry, periodStart: isoDate(entry.periodStart), periodEnd: isoDate(entry.periodEnd) }));
    const nextDue = schedule.find((period) => period.status === 'DUE' || period.status === 'REVERSED');
    return {
      asset,
      configured: Boolean(settings),
      settings,
      cost: cost.toFixed(4),
      accumulatedDepreciation: accumulated.toFixed(4),
      carryingAmount: Prisma.Decimal.max(0, cost.sub(accumulated)).toFixed(4),
      throughDate: today,
      nextDue: nextDue ?? null,
      schedule,
      history,
    };
  }
  async updateAssetDepreciationSettings(org: string, id: string, settings: AssetDepreciationSettingsDto) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "FinanceRecord" WHERE "id" = ${id}::uuid AND "organizationId" = ${org}::uuid FOR UPDATE`;
      const asset = await tx.financeRecord.findFirst({ where: { id, organizationId: org, kind: 'ASSET' } });
      if (!asset) throw new NotFoundException('Fixed asset not found');
      const normalized = this.validateDepreciationSettings(settings as unknown as Record<string, unknown>, Number(asset.amount));
      const historyCount = await tx.assetDepreciationEntry.count({ where: { organizationId: org, assetId: id } });
      if (historyCount) throw new BadRequestException('Depreciation settings cannot change after journal entries have been generated');
      const data = { ...asObject(asset.data), depreciation: { ...normalized } };
      return tx.financeRecord.update({ where: { id }, data: { data: data as Prisma.InputJsonObject } });
    });
  }
  async runAssetDepreciation(org: string, id: string, throughDate?: string) {
    const today = await this.businessToday(org);
    const cutoff = throughDate ?? today;
    if (cutoff > today) throw new BadRequestException('Depreciation cannot be generated for a future date');
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "FinanceRecord" WHERE "id" = ${id}::uuid AND "organizationId" = ${org}::uuid FOR UPDATE`;
      const asset = await tx.financeRecord.findFirst({ where: { id, organizationId: org, kind: 'ASSET' } });
      if (!asset) throw new NotFoundException('Fixed asset not found');
      if (asset.status !== 'ACTIVE') throw new BadRequestException('Activate the fixed asset before generating depreciation');
      const settings = this.depreciationSettings(asset);
      if (!settings) throw new BadRequestException('Complete the asset depreciation settings before generating depreciation');
      const history = await tx.assetDepreciationEntry.findMany({ where: { organizationId: org, assetId: id }, orderBy: { periodEnd: 'asc' } });
      const schedule = this.schedule(asset, settings, history, cutoff);
      const next = schedule.find((period) => period.status === 'DUE');
      const reversedPeriod = schedule.find((period) => period.status === 'REVERSED');
      if (reversedPeriod && (!next || reversedPeriod.period < next.period))
        throw new BadRequestException('A depreciation journal was reversed for an earlier period. Resolve the reversal before generating later periods.');
      if (!next) throw new BadRequestException('There is no unrecorded depreciation period due by the selected date');
      const cost = new Prisma.Decimal(asset.amount);
      const accumulated = history.filter((entry) => entry.status === 'POSTED').reduce((sum, entry) => sum.add(entry.amount), new Prisma.Decimal(0));
      const residual = new Prisma.Decimal(settings.residualValue);
      const opening = cost.sub(accumulated);
      const ppy = periodsPerYear[settings.frequency];
      const annualRate = settings.method === 'REDUCING_BALANCE'
        ? settings.reducingBalanceRate !== undefined
          ? new Prisma.Decimal(settings.reducingBalanceRate).div(100)
          : residual.gt(0) ? new Prisma.Decimal(1).sub(residual.div(cost).pow(1 / settings.usefulLifeYears)) : new Prisma.Decimal(1 / settings.usefulLifeYears)
        : new Prisma.Decimal(0);
      const periodicRate = new Prisma.Decimal(1).sub(new Prisma.Decimal(1).sub(annualRate).pow(1 / ppy));
      const periods = settings.usefulLifeYears * ppy;
      const remaining = Prisma.Decimal.max(0, opening.sub(residual));
      const calculated = next.period === periods
        ? remaining
        : settings.method === 'STRAIGHT_LINE'
          ? Prisma.Decimal.min(remaining, cost.sub(residual).div(periods))
          : Prisma.Decimal.min(remaining, opening.mul(periodicRate));
      const amount = roundMoney(calculated);
      if (!amount.gt(0)) throw new BadRequestException('This asset has no remaining depreciable amount');
      const newAccumulated = accumulated.add(amount);
      const carrying = Prisma.Decimal.max(residual, cost.sub(newAccumulated));
      const periodNumber = `${next.periodEnd.replaceAll('-', '')}`;
      const journal = await postAutomaticJournal(tx, {
        organizationId: org,
        number: `DEPR-${asset.reference}-${periodNumber}`,
        journalDate: fromIsoDate(next.periodEnd),
        description: `Depreciation ${asset.reference} — ${next.periodStart} to ${next.periodEnd}`,
        lines: [
          { accountCode: '5500', debit: amount, credit: 0, memo: asset.name },
          { accountCode: '1250', debit: 0, credit: amount, memo: `Accumulated depreciation: ${asset.name}` },
        ],
      });
      await tx.assetDepreciationEntry.create({
        data: {
          organizationId: org,
          assetId: id,
          periodStart: fromIsoDate(next.periodStart),
          periodEnd: fromIsoDate(next.periodEnd),
          amount,
          accumulatedDepreciation: newAccumulated,
          carryingAmount: carrying,
          journalId: journal.id,
        },
      });
      await tx.financeRecord.update({
        where: { id },
        data: { data: { ...asObject(asset.data), accumulatedDepreciation: newAccumulated.toFixed(4), carryingAmount: carrying.toFixed(4), lastDepreciationDate: next.periodEnd } as Prisma.InputJsonObject },
      });
    });
    return this.assetDepreciation(org, id);
  }
  createRecord(org: string, d: FinanceRecordDto) {
    d.reference = d.reference.trim();
    d.name = d.name.trim();
    if (!d.reference || !d.name) throw new BadRequestException('A reference and name are required');
    if (d.endDate && new Date(d.endDate) < new Date(d.startDate))
      throw new BadRequestException('End date cannot be before start date');
    if (d.kind === 'ASSET') {
      if (!Number.isFinite(d.amount) || d.amount <= 0) throw new BadRequestException('Fixed asset acquisition cost must be greater than zero');
      const recordData = d.data ?? {};
      const normalized = this.validateDepreciationSettings(
        recordData.depreciation && typeof recordData.depreciation === 'object' && !Array.isArray(recordData.depreciation)
          ? recordData.depreciation as Record<string, unknown> : {},
        d.amount,
      );
      d.data = { ...recordData, depreciation: normalized };
    }
    return this.db.$transaction(async (tx) => {
      const record = await tx.financeRecord.create({
        data: {
          ...d,
          organizationId: org,
          startDate: new Date(d.startDate),
          endDate: d.endDate ? new Date(d.endDate) : undefined,
          amount: new Prisma.Decimal(d.amount),
          data: d.data as Prisma.InputJsonValue,
        },
      });
      await this.postFinanceRecord(tx, org, record);
      return record;
    });
  }
  async recordStatus(org: string, id: string, status: string) {
    const allowed: Record<string, string[]> = {
      DRAFT: ['ACTIVE', 'APPROVED', 'CANCELLED'],
      PENDING: ['APPROVED', 'REJECTED'],
      ACTIVE: ['CLOSED', 'DISPOSED'],
      APPROVED: ['PAID', 'CLOSED'],
      PAID: ['CLOSED'],
    };
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "FinanceRecord" WHERE "id" = ${id}::uuid AND "organizationId" = ${org}::uuid FOR UPDATE`;
      const r = await tx.financeRecord.findFirst({ where: { id, organizationId: org } });
      if (!r) throw new NotFoundException('Finance record not found');
      if (!allowed[r.status]?.includes(status)) throw new BadRequestException('Invalid status transition');
      const updated = await tx.financeRecord.update({ where: { id }, data: { status } });
      await this.postFinanceRecord(tx, org, updated);
      return updated;
    });
  }
  private async postFinanceRecord(
    tx: Prisma.TransactionClient,
    org: string,
    record: { id: string; kind: FinanceRecordKind; reference: string; name: string; startDate: Date; amount: Prisma.Decimal; status: string; data?: Prisma.JsonValue },
  ) {
    if (record.kind === 'ASSET' && ['ACTIVE', 'APPROVED', 'PAID'].includes(record.status))
      await postAutomaticJournal(tx, {
        organizationId: org,
        number: `AUTO-ASSET-${record.id}`,
        journalDate: record.startDate,
        description: `Fixed asset acquisition ${record.reference}`,
        lines: [
          { accountCode: '1200', debit: record.amount, credit: 0, memo: record.name },
          { accountCode: '1000', debit: 0, credit: record.amount, memo: 'Asset payment' },
        ],
      });
    if (record.kind === 'ASSET' && record.status === 'DISPOSED') {
      const accumulated = new Prisma.Decimal(asObject(record.data ?? {}).accumulatedDepreciation as Prisma.Decimal.Value ?? 0);
      const carrying = Prisma.Decimal.max(0, record.amount.sub(accumulated));
      await postAutomaticJournal(tx, {
        organizationId: org,
        number: `AUTO-ASSET-DISPOSAL-${record.id}`,
        journalDate: new Date(),
        description: `Fixed asset disposal ${record.reference}`,
        lines: [
          { accountCode: '1250', debit: accumulated, credit: 0, memo: `Remove accumulated depreciation: ${record.name}` },
          { accountCode: '5400', debit: carrying, credit: 0, memo: `Net book value at disposal: ${record.name}` },
          { accountCode: '1200', debit: 0, credit: record.amount, memo: 'Remove asset acquisition cost' },
        ],
      });
    }
    if (record.kind === 'PAYROLL' && ['APPROVED', 'PAID'].includes(record.status))
      await postAutomaticJournal(tx, {
        organizationId: org,
        number: `AUTO-PAYROLL-${record.id}`,
        journalDate: record.startDate,
        description: `Payroll accrual ${record.reference}`,
        lines: [
          { accountCode: '5200', debit: record.amount, credit: 0, memo: record.name },
          { accountCode: '2000', debit: 0, credit: record.amount, memo: 'Payroll payable' },
        ],
      });
    if (record.kind === 'PAYROLL' && record.status === 'PAID')
      await postAutomaticJournal(tx, {
        organizationId: org,
        number: `AUTO-PAYROLL-PAYMENT-${record.id}`,
        journalDate: new Date(),
        description: `Payroll payment ${record.reference}`,
        lines: [
          { accountCode: '2000', debit: record.amount, credit: 0, memo: 'Payroll payable' },
          { accountCode: '1000', debit: 0, credit: record.amount, memo: 'Payroll payment' },
        ],
      });
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
