import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator.ts';
import { PrismaService } from '../../database/prisma.service.ts';
import { CustomersService } from '../customers/customers.service.ts';
import { InvoicesService } from '../invoices/invoices.service.ts';
import { SalesService } from '../sales/sales.service.ts';
import { PurchasesService } from '../purchases/purchases.service.ts';
import { BankingService } from '../banking/banking.service.ts';
import { AccountingService } from '../accounting/accounting.service.ts';
import { OperationsService } from '../operations/operations.service.ts';
import { CommerceService } from '../commerce/commerce.service.ts';
import { PosService } from '../pos/pos.service.ts';
import { WorkflowService } from '../workflow/workflow.service.ts';
import { InsightsService } from '../insights/insights.service.ts';
import { OrganizationsService } from '../organizations/organizations.service.ts';

// Existing built-in roles may read the platform's GET endpoints; explicit
// controller role restrictions are enforced separately below. Custom roles
// continue to use their exact permission list.
const SYSTEM_ROLE_PERMISSIONS: Record<Role, string[]> = {
  OWNER: ['*'], ADMIN: ['*'], ACCOUNTANT: ['*'], APPROVER: ['*'], MEMBER: ['*'], AUDITOR: ['*'],
};

async function fetchPages<T>(pageCount: number, fetchPage: (page: number) => Promise<T>): Promise<T[]> {
  const pages: T[] = [];
  for (let page = 2; page <= pageCount; page += 5) {
    const batch = Array.from({ length: Math.min(5, pageCount - page + 1) }, (_, index) => page + index);
    pages.push(...await Promise.all(batch.map(fetchPage)));
  }
  return pages;
}

@Injectable()
export class OfflineService {
  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async snapshot(user: AuthUser) {
    const org = user.organizationId;
    const permissions = user.customRoleId
      ? user.permissions ?? []
      : SYSTEM_ROLE_PERMISSIONS[user.role as Role] ?? [];
    const can = (permission: string) => permissions.includes('*') || permissions.includes(permission);
    const canReadDirectory = user.customRoleId
      ? can('users.view')
      : ['OWNER', 'ADMIN', 'AUDITOR'].includes(user.role);
    const resources: Record<string, unknown> = {};
    let activeLoads = 0;
    const waitingLoads: Array<() => void> = [];
    const load = async (permission: string, path: string, query: () => Promise<unknown>) => {
      if (!can(permission)) return;
      if (activeLoads >= 5) await new Promise<void>((resolve) => waitingLoads.push(resolve));
      else activeLoads++;
      try {
        resources[path] = await query();
      } finally {
        const next = waitingLoads.shift();
        if (next) next();
        else activeLoads--;
      }
    };
    const loadAny = async (permissions: string[], path: string, query: () => Promise<unknown>) => {
      const permission = permissions.find(can);
      if (permission) await load(permission, path, query);
    };

    // Reuse the same domain queries as the regular API so cached values keep
    // the exact shapes expected by existing frontend pages.
    const customers = new CustomersService(this.db);
    const invoices = new InvoicesService(this.db);
    const sales = new SalesService(this.db);
    const purchases = new PurchasesService(this.db);
    const banking = new BankingService(this.db);
    const accounting = new AccountingService(this.db);
    const operations = new OperationsService(this.db);
    const commerce = new CommerceService(this.db);
    const pos = new PosService(this.db, undefined, this.config);
    const workflow = new WorkflowService(this.db);
    const insights = new InsightsService(this.db);
    const organizations = new OrganizationsService(this.db);

    const organization = await this.db.organization.findUnique({
      where: { id: org },
      select: {
        id: true, name: true, baseCurrency: true, countryCode: true,
        onboardingData: true, onboardingStep: true, onboardingCompletedAt: true,
        createdAt: true, updatedAt: true,
      },
    });
    const profile = await this.db.user.findUnique({
      where: { id: user.sub },
      select: {
        firstName: true, lastName: true, email: true, phone: true, address: true,
        mustChangePassword: true, passwordChangedAt: true, createdAt: true, isActive: true,
      },
    });
    resources['/auth/me'] = {
      ...profile,
      role: user.role,
      customRoleId: user.customRoleId,
      permissions: user.permissions ?? [],
      organization: organization && {
        name: organization.name,
        baseCurrency: organization.baseCurrency,
        countryCode: organization.countryCode,
      },
    };
    resources['/organizations/current/onboarding'] = organization && {
      organizationName: organization.name,
      onboardingData: organization.onboardingData,
      onboardingStep: organization.onboardingStep,
      onboardingCompletedAt: organization.onboardingCompletedAt,
    };
    await Promise.all([
      ...(canReadDirectory ? [
        load('users.view', '/organizations/current/users', () => this.db.membership.findMany({ where: { organizationId: org }, include: { user: { select: { id: true, email: true, firstName: true, lastName: true, phone: true, address: true, isActive: true, verifiedAt: true, mustChangePassword: true } }, customRole: true }, orderBy: { createdAt: 'asc' } })),
        load('users.view', '/organizations/current/roles', () => this.db.customRole.findMany({ where: { organizationId: org }, orderBy: { name: 'asc' } })),
        load('users.view', '/organizations/current/audit-logs', () => this.db.auditLog.findMany({ where: { organizationId: org }, include: { actor: { select: { email: true, firstName: true, lastName: true } } }, orderBy: { createdAt: 'desc' }, take: 500 })),
      ] : []),
    ]);

    await Promise.all([
      load('sales.view', '/sales/summary', () => sales.summary(org)),
      load('sales.view', '/customers?limit=100&search=', async () => {
        const first = await customers.list(org, 1, 100);
        if (first.meta.pages <= 1) return first;
        const pages = await fetchPages(first.meta.pages, (page) => customers.list(org, page, 100));
        return { ...first, data: [...first.data, ...pages.flatMap((page) => page.data)] };
      }),
      load('sales.view', '/invoices', () => invoices.list(org)),
      load('sales.view', '/invoices/next-number', () => invoices.nextNumber(org)),
      load('sales.view', '/sales/quotations?', () => sales.quotations(org, {})),
      load('sales.view', '/sales/quotations/next-number', () => sales.nextQuotationNumber(org)),
      load('sales.view', '/sales/payments?', () => sales.payments(org, {})),
      load('sales.view', '/sales/credit-notes?', () => sales.creditNotes(org, {})),
      load('sales.view', '/sales/receivables?', () => sales.receivables(org, {})),
      load('purchases.view', '/purchases/summary', () => purchases.summary(org)),
      load('purchases.view', '/purchases/suppliers?search=&status=', () => purchases.suppliers(org, {})),
      load('purchases.view', '/purchases/requests?search=&status=', () => purchases.requests(org, {})),
      load('purchases.view', '/purchases/orders?search=&status=', () => purchases.orders(org, {})),
      load('purchases.view', '/purchases/bills?search=&status=', () => purchases.bills(org, {})),
      load('purchases.view', '/purchases/payments?search=&status=', () => purchases.payments(org, {})),
      load('purchases.view', '/purchases/payables?search=&status=', () => purchases.payables(org, {})),
      load('purchases.view', '/purchases/expenses?search=&status=', () => purchases.expenses(org, {})),
      load('banking.view', '/banking/summary', () => banking.summary(org)),
      load('banking.view', '/banking/accounts?includeArchived=false', () => banking.accounts(org)),
      load('banking.view', '/banking/accounts?includeArchived=true', () => banking.accounts(org, true)),
      load('banking.view', '/banking/transactions?', async () => {
        const first = await banking.transactions(org, { page: '1', limit: '100' });
        if (first.meta.pages <= 1) return first;
        const pages = await fetchPages(first.meta.pages, (page) =>
          banking.transactions(org, { page: String(page), limit: '100' }),
        );
        return { ...first, data: [...first.data, ...pages.flatMap((page) => page.data)], meta: { ...first.meta, pages: 1, limit: first.meta.total } };
      }),
      load('banking.view', '/banking/transactions/reversals', () => banking.reversalHistory(org)),
      load('accounting.view', '/accounting/summary', () => accounting.summary(org)),
      load('accounting.view', '/accounting/accounts?includeArchived=false', () => accounting.accounts(org, false)),
      load('accounting.view', '/accounting/accounts?includeArchived=true', () => accounting.accounts(org, true)),
      load('accounting.view', '/accounting/journals?search=', () => accounting.journals(org, {})),
      load('accounting.view', '/accounting/ledger?accountId=', () => accounting.ledger(org, {})),
      load('accounting.view', '/accounting/trial-balance', () => accounting.trialBalance(org, {})),
      load('accounting.view', '/accounting/records/ASSET?search=', () => accounting.records(org, 'ASSET', {})),
      load('accounting.view', '/accounting/records/BUDGET?search=', () => accounting.records(org, 'BUDGET', {})),
      load('accounting.view', '/accounting/records/TAX?search=', () => accounting.records(org, 'TAX', {})),
      load('accounting.view', '/accounting/records/PAYROLL?search=', () => accounting.records(org, 'PAYROLL', {})),
      load('inventory.view', '/operations/summary', () => operations.summary(org)),
      // The normal API intentionally exposes read-only catalogue and warehouse
      // data to POS users who only hold sales.view.
      loadAny(['inventory.view', 'sales.view'], '/operations/products?', () => operations.products(org, {})),
      load('inventory.view', '/operations/products-page?', () => operations.productsPage(org, {})),
      load('inventory.view', '/operations/product-categories', () => operations.categories(org)),
      loadAny(['inventory.view', 'sales.view'], '/operations/warehouses?', () => operations.warehouses(org, {})),
      load('inventory.view', '/operations/movements?', () => operations.movements(org, {})),
      load('inventory.view', '/operations/adjustments?', () => operations.adjustments(org, {})),
      load('inventory.view', '/operations/projects?', () => operations.projects(org, {})),
      load('inventory.view', '/commerce/summary', () => commerce.summary(org)),
      load('inventory.view', '/commerce/channels', () => commerce.channels(org)),
      load('sales.view', '/commerce/orders', () => commerce.orders(org)),
      load('inventory.view', '/commerce/catalog', () => commerce.catalog(org)),
      load('sales.view', '/pos/sales?limit=100&page=1', async () => {
        const first = await pos.list(org, { page: 1, limit: 100 }, user.sub, user.role, permissions);
        if (first.meta.totalPages <= 1) return first;
        const pages = await fetchPages(first.meta.totalPages, (page) =>
          pos.list(org, { page, limit: 100 }, user.sub, user.role, permissions),
        );
        const data = [...first.data, ...pages.flatMap((page) => page.data)];
        return { data, meta: { page: 1, limit: data.length, total: first.meta.total, totalPages: 1 } };
      }),
      load('sales.view', '/pos/registers', () => pos.registers(org, user.sub, user.role)),
      load('sales.view', '/pos/branches', () => pos.branches(org, user.sub, user.role)),
      load('sales.view', '/pos/shifts/current', () => pos.currentShift(org, user.sub)),
      load('dashboard.view', '/workflow/summary', () => workflow.summary(org, user.sub)),
      load('dashboard.view', '/workflow/documents?', () => workflow.documents(org, {})),
      load('approvals.review', '/workflow/approvals?', () => workflow.approvals(org, {})),
      load('dashboard.view', '/workflow/notifications?', () => workflow.notifications(org, user.sub, {})),
      load('settings.manage', '/workflow/rules?', () => workflow.rules(org, {})),
      load('reports.view', '/insights/reports?', () => insights.reports(org, {})),
      load('reports.view', '/insights/analytics?', () => insights.analytics(org, {})),
      load('reports.view', '/insights/saved-reports?archived=', () => insights.savedReports(org, {})),
      load('reports.view', '/insights/saved-reports?archived=true', () => insights.savedReports(org, { archived: 'true' })),
      load('reports.view', '/insights/saved-reports?archived=all', () => insights.savedReports(org, { archived: 'all' })),
      load('reports.view', '/insights/ai/history', () => insights.aiHistory(org)),
      load('reports.view', '/insights/workbooks', () => insights.workbooks(org)),
      load('settings.manage', '/organizations/current/admin', () => organizations.admin(org)),
      ...( ['OWNER', 'ADMIN'].includes(user.role)
        ? [load('sales.view', '/pos/audit', () => pos.posAudit(org))]
        : []),
    ]);

    // Customer purchase history is a separately requested page in the sales UI.
    // Include it in the same consented snapshot so that page remains readable offline.
    if (can('sales.view')) {
      const customerRows = resources['/customers?limit=100&search='] as { data?: Array<{ id: string }> } | undefined;
      await Promise.all((customerRows?.data ?? []).map((customer) =>
        load('sales.view', `/customers/${customer.id}/purchase-history`, () => customers.purchaseHistory(org, customer.id)),
      ));
    }

    // Cache a warehouse-specific catalogue for each active POS location so the
    // register can keep applying the same stock view while disconnected.
    if (can('sales.view')) {
      const activeWarehouses = await operations.warehouses(org, { status: 'active' });
      await Promise.all(activeWarehouses.map((warehouse) => {
        const path = `/operations/products?status=active&warehouseId=${encodeURIComponent(warehouse.id)}`;
        return load('sales.view', path, () => operations.products(org, {
          status: 'active', warehouseId: warehouse.id,
        }));
      }));
    }

    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      organizationId: org,
      userId: user.sub,
      resources,
      resourceCount: Object.keys(resources).length,
    };
  }
}
