import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SyncStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.ts';
import type { RunSyncDto, SavedReportDto, WorkbookDto } from './dto/insights.dto.ts';

@Injectable()
export class InsightsService {
  constructor(private readonly db: PrismaService) {}

  async reports(org: string, q: Record<string, string>) {
    const dates = this.dates(q);
    const [organization, invoices, expenses, bills, payments, supplierPayments, bankAccounts, products, movements, projects] = await Promise.all([
      this.db.organization.findUniqueOrThrow({ where: { id: org }, select: { baseCurrency: true } }),
      this.db.invoice.findMany({ where: { organizationId: org, ...(dates ? { issueDate: dates } : {}) }, select: { total: true, paidAmount: true, creditedAmount: true, status: true, issueDate: true } }),
      this.db.expense.findMany({ where: { organizationId: org, status: { notIn: ['REJECTED', 'VOID'] }, ...(dates ? { expenseDate: dates } : {}) }, select: { amount: true, category: true, expenseDate: true } }),
      this.db.bill.findMany({ where: { organizationId: org, status: { not: 'VOID' }, ...(dates ? { issueDate: dates } : {}) }, select: { total: true, paidAmount: true, issueDate: true } }),
      this.db.paymentReceived.findMany({ where: { organizationId: org, ...(dates ? { paymentDate: dates } : {}) }, select: { amount: true, paymentDate: true } }),
      this.db.supplierPayment.findMany({ where: { organizationId: org, reversedAt: null, ...(dates ? { paymentDate: dates } : {}) }, select: { amount: true, paymentDate: true } }),
      this.db.bankAccount.findMany({ where: { organizationId: org, isActive: true }, select: { currentBalance: true } }),
      this.db.product.findMany({ where: { organizationId: org, isActive: true, type: 'PRODUCT' }, select: { id: true, name: true, costPrice: true } }),
      this.db.stockMovement.findMany({ where: { organizationId: org }, select: { productId: true, quantity: true, type: true } }),
      this.db.project.findMany({ where: { organizationId: org }, select: { status: true, budget: true, actualCost: true, revenue: true } }),
    ]);
    const sum = (items: Array<{ amount?: Prisma.Decimal; total?: Prisma.Decimal }>, key: 'amount' | 'total') => items.reduce((n, x) => n.add(x[key] ?? 0), new Prisma.Decimal(0));
    const revenue = invoices.reduce((n, x) => n.add(x.total).sub(x.creditedAmount), new Prisma.Decimal(0));
    const expenseTotal = sum(expenses, 'amount').add(sum(bills, 'total'));
    const receivables = invoices.reduce((n, x) => n.add(Prisma.Decimal.max(0, x.total.sub(x.paidAmount).sub(x.creditedAmount))), new Prisma.Decimal(0));
    const payables = bills.reduce((n, x) => n.add(Prisma.Decimal.max(0, x.total.sub(x.paidAmount))), new Prisma.Decimal(0));
    const cash = bankAccounts.reduce((n, x) => n.add(x.currentBalance), new Prisma.Decimal(0));
    const stock = new Map<string, Prisma.Decimal>();
    for (const m of movements) {
      const sign = ['ISSUE', 'TRANSFER_OUT'].includes(m.type) ? -1 : 1;
      stock.set(m.productId, (stock.get(m.productId) ?? new Prisma.Decimal(0)).add(m.quantity.mul(sign)));
    }
    const inventoryValue = products.reduce((n, x) => n.add((stock.get(x.id) ?? new Prisma.Decimal(0)).mul(x.costPrice)), new Prisma.Decimal(0));
    return {
      currency: organization.baseCurrency,
      range: { from: q.from || null, to: q.to || null },
      metrics: { revenue, expenses: expenseTotal, profit: revenue.sub(expenseTotal), receivables, payables, cash, inventoryValue, activeProjects: projects.filter((x) => x.status === 'ACTIVE').length },
      cashFlow: { moneyIn: sum(payments, 'amount'), moneyOut: sum(supplierPayments, 'amount').add(sum(expenses, 'amount')) },
      invoiceStatus: Object.entries(invoices.reduce<Record<string, number>>((a, x) => ({ ...a, [x.status]: (a[x.status] ?? 0) + 1 }), {})).map(([label, value]) => ({ label, value })),
      expenseCategories: Object.entries(expenses.reduce<Record<string, Prisma.Decimal>>((a, x) => ({ ...a, [x.category]: (a[x.category] ?? new Prisma.Decimal(0)).add(x.amount) }), {})).map(([label, value]) => ({ label, value })),
      projects: { budget: projects.reduce((n, x) => n.add(x.budget), new Prisma.Decimal(0)), actualCost: projects.reduce((n, x) => n.add(x.actualCost), new Prisma.Decimal(0)), revenue: projects.reduce((n, x) => n.add(x.revenue), new Prisma.Decimal(0)) },
    };
  }

  async analytics(org: string, q: Record<string, string>) {
    const report = await this.reports(org, q);
    const dates = this.dates(q);
    const [invoices, expenses] = await Promise.all([
      this.db.invoice.findMany({ where: { organizationId: org, ...(dates ? { issueDate: dates } : {}) }, select: { issueDate: true, total: true, creditedAmount: true } }),
      this.db.expense.findMany({ where: { organizationId: org, status: { notIn: ['REJECTED', 'VOID'] }, ...(dates ? { expenseDate: dates } : {}) }, select: { expenseDate: true, amount: true } }),
    ]);
    const months = new Map<string, { revenue: Prisma.Decimal; expenses: Prisma.Decimal }>();
    const bucket = (date: Date) => date.toISOString().slice(0, 7);
    for (const x of invoices) { const k = bucket(x.issueDate); const b = months.get(k) ?? { revenue: new Prisma.Decimal(0), expenses: new Prisma.Decimal(0) }; b.revenue = b.revenue.add(x.total).sub(x.creditedAmount); months.set(k, b); }
    for (const x of expenses) { const k = bucket(x.expenseDate); const b = months.get(k) ?? { revenue: new Prisma.Decimal(0), expenses: new Prisma.Decimal(0) }; b.expenses = b.expenses.add(x.amount); months.set(k, b); }
    return { ...report, trend: [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, value]) => ({ month, ...value })) };
  }

  savedReports(org: string, q: Record<string, string>) { return this.db.savedReport.findMany({ where: { organizationId: org, ...(q.archived === 'true' ? { isArchived: true } : q.archived === 'all' ? {} : { isArchived: false }) }, orderBy: { updatedAt: 'desc' } }); }
  createReport(org: string, d: SavedReportDto) { return this.db.savedReport.create({ data: { ...d, dateFrom: d.dateFrom ? this.date(d.dateFrom) : undefined, dateTo: d.dateTo ? this.date(d.dateTo) : undefined, organizationId: org } }); }
  async reportStatus(org: string, id: string, isArchived: boolean) { await this.report(org, id); return this.db.savedReport.update({ where: { id }, data: { isArchived } }); }
  async deleteReport(org: string, id: string) { await this.report(org, id); await this.db.savedReport.delete({ where: { id } }); return { deleted: true }; }
  aiHistory(org: string) { return this.db.aiInsight.findMany({ where: { organizationId: org }, orderBy: { createdAt: 'desc' }, take: 30 }); }
  async queryAi(org: string, question: string) {
    const r = await this.reports(org, {}); const m = r.metrics; const lower = question.toLowerCase();
    const fmt = (x: unknown) => `${r.currency} ${Number(x).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
    let answer = `Current overview: revenue is ${fmt(m.revenue)}, expenses are ${fmt(m.expenses)}, and profit is ${fmt(m.profit)}. Cash is ${fmt(m.cash)}.`;
    if (lower.includes('receiv')) answer = `Outstanding receivables are ${fmt(m.receivables)}. Review overdue and partially paid invoices in Sales & income before following up.`;
    else if (lower.includes('payable') || lower.includes('supplier')) answer = `Outstanding payables are ${fmt(m.payables)}. Compare due dates with available cash of ${fmt(m.cash)} before scheduling supplier payments.`;
    else if (lower.includes('inventory') || lower.includes('stock')) answer = `Inventory is currently valued at ${fmt(m.inventoryValue)} using recorded stock movements and item cost prices.`;
    else if (lower.includes('profit') || lower.includes('expense')) answer = `Revenue is ${fmt(m.revenue)}, recorded expenses and bills are ${fmt(m.expenses)}, leaving profit of ${fmt(m.profit)} for the selected all-time view.`;
    return this.db.aiInsight.create({ data: { organizationId: org, question: question.trim(), answer } });
  }
  async clearAi(org: string) { const result = await this.db.aiInsight.deleteMany({ where: { organizationId: org } }); return { deleted: result.count }; }
  workbooks(org: string) { return this.db.workbookConnection.findMany({ where: { organizationId: org }, orderBy: { updatedAt: 'desc' } }); }
  createWorkbook(org: string, d: WorkbookDto) { return this.db.workbookConnection.create({ data: { ...d, organizationId: org } }); }
  async workbookStatus(org: string, id: string, status: SyncStatus) { await this.workbook(org, id); return this.db.workbookConnection.update({ where: { id }, data: { status, errorMessage: null } }); }
  async runSync(org: string, id: string, d: RunSyncDto) { const workbook = await this.workbook(org, id); if (workbook.status === 'PAUSED') throw new BadRequestException('Resume this connection before syncing'); const rowsSynced = d.rowCount ?? await this.sourceCount(org, workbook.dataSource); return this.db.workbookConnection.update({ where: { id }, data: { rowsSynced, lastSyncedAt: new Date(), fileName: d.fileName ?? workbook.fileName, status: 'ACTIVE', errorMessage: null } }); }
  async deleteWorkbook(org: string, id: string) { await this.workbook(org, id); await this.db.workbookConnection.delete({ where: { id } }); return { deleted: true }; }

  private dates(q: Record<string, string>) { if (!q.from && !q.to) return undefined; const from = q.from ? this.date(q.from) : undefined; const to = q.to ? this.date(q.to) : undefined; if (from && to && from > to) throw new BadRequestException('From date must be before to date'); return { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) }; }
  private date(value: string) { const date = new Date(`${value}T00:00:00.000Z`); if (Number.isNaN(date.getTime())) throw new BadRequestException('Enter a valid date'); return date; }
  private async report(org: string, id: string) { const item = await this.db.savedReport.findFirst({ where: { id, organizationId: org } }); if (!item) throw new NotFoundException('Saved report not found'); return item; }
  private async workbook(org: string, id: string) { const item = await this.db.workbookConnection.findFirst({ where: { id, organizationId: org } }); if (!item) throw new NotFoundException('Workbook connection not found'); return item; }
  private async sourceCount(org: string, source: string) { const map: Record<string, () => Promise<number>> = { invoices: () => this.db.invoice.count({ where: { organizationId: org } }), expenses: () => this.db.expense.count({ where: { organizationId: org } }), products: () => this.db.product.count({ where: { organizationId: org } }), projects: () => this.db.project.count({ where: { organizationId: org } }), customers: () => this.db.customer.count({ where: { organizationId: org } }), suppliers: () => this.db.supplier.count({ where: { organizationId: org } }) }; return map[source]?.() ?? 0; }
}
