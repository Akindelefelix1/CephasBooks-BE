import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BillStatus,
  ExpenseStatus,
  Prisma,
  PurchaseOrderStatus,
  PurchaseRequestStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.ts';
import { WorkflowService } from '../workflow/workflow.service.ts';
import {
  BillDto,
  ExpenseDto,
  OrderDto,
  PurchaseLineDto,
  RequestDto,
  SupplierDto,
  SupplierPaymentDto,
} from './dto/purchases.dto.ts';
@Injectable()
export class PurchasesService {
  constructor(
    private readonly db: PrismaService,
    private readonly workflows?: WorkflowService,
  ) {}
  private totals(items: PurchaseLineDto[]) {
    const subtotal = items.reduce(
      (s, x) => s.add(new Prisma.Decimal(x.quantity).mul(x.unitPrice)),
      new Prisma.Decimal(0),
    );
    const total = items.reduce((s, x) => {
      const b = new Prisma.Decimal(x.quantity).mul(x.unitPrice);
      return s.add(b.add(b.mul(x.taxRate ?? 0).div(100)));
    }, new Prisma.Decimal(0));
    return { subtotal, taxTotal: total.sub(subtotal), total };
  }
  private markOverdue(org: string) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return this.db.bill.updateMany({
      where: {
        organizationId: org,
        dueDate: { lt: today },
        status: { in: ['APPROVED', 'PARTIALLY_PAID'] },
      },
      data: { status: 'OVERDUE' },
    });
  }
  private filter(org: string, q: Record<string, string>) {
    return {
      organizationId: org,
      ...(q.status ? { status: q.status as never } : {}),
      ...(q.search
        ? {
            OR: [
              { number: { contains: q.search, mode: 'insensitive' as const } },
              { supplier: { displayName: { contains: q.search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };
  }
  async summary(org: string) {
    await this.markOverdue(org);
    const [suppliers, requests, orders, bills, expenses] = await this.db.$transaction([
      this.db.supplier.count({ where: { organizationId: org, isActive: true } }),
      this.db.purchaseRequest.count({ where: { organizationId: org, status: 'PENDING' } }),
      this.db.purchaseOrder.aggregate({
        where: { organizationId: org, status: { notIn: ['CANCELLED', 'BILLED'] } },
        _sum: { total: true },
      }),
      this.db.bill.aggregate({
        where: { organizationId: org, status: { notIn: ['PAID', 'VOID'] } },
        _sum: { total: true, paidAmount: true },
      }),
      this.db.expense.aggregate({
        where: { organizationId: org, status: 'APPROVED' },
        _sum: { amount: true },
      }),
    ]);
    return {
      suppliers,
      pendingRequests: requests,
      openOrders: orders._sum.total ?? 0,
      payable: (bills._sum.total ?? new Prisma.Decimal(0)).sub(bills._sum.paidAmount ?? 0),
      expenses: expenses._sum.amount ?? 0,
    };
  }
  suppliers(org: string, q: Record<string, string>) {
    return this.db.supplier.findMany({
      where: {
        organizationId: org,
        ...(q.search ? { displayName: { contains: q.search, mode: 'insensitive' } } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  createSupplier(org: string, d: SupplierDto) {
    return this.db.supplier.create({ data: { ...d, organizationId: org } });
  }
  async updateSupplier(org: string, id: string, d: SupplierDto) {
    await this.supplier(org, id);
    return this.db.supplier.update({ where: { id }, data: d });
  }
  async archiveSupplier(org: string, id: string) {
    await this.supplier(org, id);
    return this.db.supplier.update({ where: { id }, data: { isActive: false } });
  }
  async deleteSupplier(org: string, id: string) {
    const supplier = await this.supplier(org, id);
    if (supplier.isActive) throw new BadRequestException('Archive the supplier before deleting it');
    const [orders, bills, payments, expenses] = await this.db.$transaction([
      this.db.purchaseOrder.count({ where: { organizationId: org, supplierId: id } }),
      this.db.bill.count({ where: { organizationId: org, supplierId: id } }),
      this.db.supplierPayment.count({ where: { organizationId: org, supplierId: id } }),
      this.db.expense.count({ where: { organizationId: org, supplierId: id } }),
    ]);
    if (orders || bills || payments || expenses)
      throw new BadRequestException(
        'This supplier has financial history and cannot be permanently deleted',
      );
    await this.db.supplier.delete({ where: { id } });
    return { deleted: true };
  }
  async restoreSupplier(org: string, id: string) {
    await this.supplier(org, id);
    return this.db.supplier.update({ where: { id }, data: { isActive: true } });
  }
  private async supplier(org: string, id: string) {
    const x = await this.db.supplier.findFirst({ where: { id, organizationId: org } });
    if (!x) throw new NotFoundException('Supplier not found');
    return x;
  }
  requests(org: string, q: Record<string, string>) {
    return this.db.purchaseRequest.findMany({
      where: {
        organizationId: org,
        ...(q.status ? { status: q.status as never } : {}),
        ...(q.search
          ? {
              OR: [
                { number: { contains: q.search, mode: 'insensitive' } },
                { requestedBy: { contains: q.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  createRequest(org: string, d: RequestDto) {
    const { total } = this.totals(d.items);
    return this.db.purchaseRequest.create({
      data: {
        ...d,
        organizationId: org,
        status: 'PENDING',
        requiredDate: new Date(d.requiredDate),
        items: d.items as unknown as Prisma.InputJsonValue,
        total,
      },
    });
  }
  async requestStatus(org: string, id: string, status: PurchaseRequestStatus) {
    const x = await this.db.purchaseRequest.findFirst({ where: { id, organizationId: org } });
    if (!x) throw new NotFoundException('Purchase request not found');
    if (['REJECTED', 'CANCELLED', 'CONVERTED'].includes(x.status))
      throw new BadRequestException('Purchase request is already closed');
    const allowed: Record<string, string[]> = {
      DRAFT: ['PENDING', 'CANCELLED'],
      PENDING: ['APPROVED', 'REJECTED', 'CANCELLED'],
      APPROVED: ['CANCELLED'],
    };
    if (!allowed[x.status]?.includes(status))
      throw new BadRequestException('Invalid purchase request status transition');
    return this.db.purchaseRequest.update({ where: { id }, data: { status } });
  }
  orders(org: string, q: Record<string, string>) {
    return this.db.purchaseOrder.findMany({
      where: this.filter(org, q),
      include: { supplier: true, request: true },
      orderBy: { createdAt: 'desc' },
    });
  }
  async createOrder(org: string, d: OrderDto) {
    await this.supplier(org, d.supplierId);
    if (new Date(d.deliveryDate) < new Date(d.orderDate))
      throw new BadRequestException('Delivery date cannot be before order date');
    if (d.requestId) {
      const r = await this.db.purchaseRequest.findFirst({
        where: { id: d.requestId, organizationId: org, status: 'APPROVED' },
      });
      if (!r) throw new BadRequestException('Only an approved request can become an order');
    }
    const t = this.totals(d.items);
    const bill = await this.db.$transaction(async (tx) => {
      const o = await tx.purchaseOrder.create({
        data: {
          ...d,
          organizationId: org,
          orderDate: new Date(d.orderDate),
          deliveryDate: new Date(d.deliveryDate),
          items: d.items as unknown as Prisma.InputJsonValue,
          ...t,
        },
        include: { supplier: true },
      });
      if (d.requestId)
        await tx.purchaseRequest.update({
          where: { id: d.requestId },
          data: { status: 'CONVERTED' },
        });
      return o;
    });
    await this.workflows?.executeEvent(org, 'BILL_CREATED', {
      entityType: 'BILL',
      entityId: bill.id,
      reference: bill.number,
      title: `Approve bill ${bill.number}`,
      amount: Number(bill.total),
    });
    return bill;
  }
  async orderStatus(org: string, id: string, status: PurchaseOrderStatus) {
    const x = await this.db.purchaseOrder.findFirst({ where: { id, organizationId: org } });
    if (!x) throw new NotFoundException('Purchase order not found');
    const allowed: Record<string, string[]> = {
      DRAFT: ['ISSUED', 'CANCELLED'],
      ISSUED: ['PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
      PARTIALLY_RECEIVED: ['RECEIVED', 'CANCELLED'],
      RECEIVED: ['CANCELLED'],
    };
    if (!allowed[x.status]?.includes(status))
      throw new BadRequestException('Invalid purchase order status transition');
    return this.db.purchaseOrder.update({ where: { id }, data: { status } });
  }
  async bills(org: string, q: Record<string, string>) {
    await this.markOverdue(org);
    return this.db.bill.findMany({
      where: this.filter(org, q),
      include: { supplier: true, purchaseOrder: true },
      orderBy: { createdAt: 'desc' },
    });
  }
  async createBill(org: string, d: BillDto) {
    await this.supplier(org, d.supplierId);
    if (new Date(d.dueDate) < new Date(d.issueDate))
      throw new BadRequestException('Due date cannot be before issue date');
    if (d.purchaseOrderId) {
      const o = await this.db.purchaseOrder.findFirst({
        where: {
          id: d.purchaseOrderId,
          organizationId: org,
          supplierId: d.supplierId,
          status: { in: ['ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED'] },
        },
      });
      if (!o) throw new BadRequestException('Purchase order is unavailable');
    }
    const t = this.totals(d.items);
    return this.db.$transaction(async (tx) => {
      const b = await tx.bill.create({
        data: {
          ...d,
          organizationId: org,
          issueDate: new Date(d.issueDate),
          dueDate: new Date(d.dueDate),
          items: d.items as unknown as Prisma.InputJsonValue,
          ...t,
        },
        include: { supplier: true },
      });
      if (d.purchaseOrderId)
        await tx.purchaseOrder.update({
          where: { id: d.purchaseOrderId },
          data: { status: 'BILLED' },
        });
      return b;
    });
  }
  async orderToBill(
    org: string,
    id: string,
    d: { number: string; issueDate: string; dueDate: string },
  ) {
    const o = await this.db.purchaseOrder.findFirst({
      where: {
        id,
        organizationId: org,
        status: { in: ['ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED'] },
      },
    });
    if (!o) throw new BadRequestException('Purchase order is unavailable');
    return this.createBill(org, {
      supplierId: o.supplierId,
      purchaseOrderId: o.id,
      number: d.number,
      issueDate: d.issueDate,
      dueDate: d.dueDate,
      currency: o.currency,
      items: o.items as unknown as PurchaseLineDto[],
      notes: o.notes ?? undefined,
    });
  }
  async billStatus(org: string, id: string, status: BillStatus) {
    const x = await this.db.bill.findFirst({ where: { id, organizationId: org } });
    if (!x) throw new NotFoundException('Bill not found');
    if (x.paidAmount.gt(0) && ['DRAFT', 'PENDING_APPROVAL', 'VOID'].includes(status))
      throw new BadRequestException('A paid bill cannot move to that status');
    const allowed: Record<string, string[]> = {
      DRAFT: ['PENDING_APPROVAL', 'APPROVED', 'VOID'],
      PENDING_APPROVAL: ['APPROVED', 'DRAFT', 'VOID'],
      APPROVED: ['VOID'],
      OVERDUE: ['VOID'],
    };
    if (!allowed[x.status]?.includes(status))
      throw new BadRequestException('Invalid bill status transition');
    return this.db.bill.update({ where: { id }, data: { status } });
  }
  payments(org: string, q: Record<string, string>) {
    return this.db.supplierPayment.findMany({
      where: {
        organizationId: org,
        ...(q.search
          ? {
              OR: [
                { reference: { contains: q.search, mode: 'insensitive' } },
                { supplier: { displayName: { contains: q.search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: { supplier: true, bill: true },
      orderBy: { paymentDate: 'desc' },
    });
  }
  async payables(org: string, q: Record<string, string>) {
    await this.markOverdue(org);
    return this.db.bill.findMany({
      where: { ...this.filter(org, q), status: { notIn: ['PAID', 'VOID'] } },
      include: { supplier: true },
      orderBy: { dueDate: 'asc' },
    });
  }
  async createPayment(org: string, d: SupplierPaymentDto) {
    return this.db.$transaction(async (tx) => {
      const b = await tx.bill.findFirst({
        where: {
          id: d.billId,
          organizationId: org,
          status: { in: ['APPROVED', 'PARTIALLY_PAID', 'OVERDUE'] },
        },
      });
      if (!b) throw new BadRequestException('Only an approved bill can be paid');
      const amount = new Prisma.Decimal(d.amount),
        out = b.total.sub(b.paidAmount);
      if (amount.gt(out)) throw new BadRequestException('Payment exceeds bill balance');
      if (d.bankAccountId)
        await this.postBank(
          tx,
          org,
          d.bankAccountId,
          d.paymentDate,
          `Supplier payment ${d.reference}`,
          d.reference,
          amount,
          'SUPPLIER_PAYMENT',
          'pending',
          b.currency,
        );
      const p = await tx.supplierPayment.create({
        data: {
          ...d,
          organizationId: org,
          supplierId: b.supplierId,
          currency: b.currency,
          paymentDate: new Date(d.paymentDate),
          amount,
        },
      });
      if (d.bankAccountId)
        await tx.bankTransaction.updateMany({
          where: {
            organizationId: org,
            sourceType: 'SUPPLIER_PAYMENT',
            sourceId: null,
            reference: d.reference,
          },
          data: { sourceId: p.id },
        });
      const paid = b.paidAmount.add(amount);
      await tx.bill.update({
        where: { id: b.id },
        data: { paidAmount: paid, status: paid.gte(b.total) ? 'PAID' : 'PARTIALLY_PAID' },
      });
      return p;
    });
  }
  async reversePayment(org: string, id: string) {
    return this.db.$transaction(async (tx) => {
      const p = await tx.supplierPayment.findFirst({
        where: { id, organizationId: org, reversedAt: null },
      });
      if (!p) throw new NotFoundException('Supplier payment not found');
      const b = await tx.bill.findUniqueOrThrow({ where: { id: p.billId } }),
        paid = b.paidAmount.sub(p.amount);
      await tx.supplierPayment.update({ where: { id }, data: { reversedAt: new Date() } });
      await tx.bill.update({
        where: { id: b.id },
        data: { paidAmount: paid, status: paid.gt(0) ? 'PARTIALLY_PAID' : 'APPROVED' },
      });
      const bt = await tx.bankTransaction.findFirst({
        where: {
          organizationId: org,
          sourceType: 'SUPPLIER_PAYMENT',
          sourceId: id,
          reversedAt: null,
        },
      });
      if (bt) {
        await tx.bankTransaction.update({ where: { id: bt.id }, data: { reversedAt: new Date() } });
        await this.recalc(tx, org, bt.bankAccountId);
      }
      return { reversed: true };
    });
  }
  expenses(org: string, q: Record<string, string>) {
    return this.db.expense.findMany({
      where: {
        organizationId: org,
        ...(q.status ? { status: q.status as never } : {}),
        ...(q.search
          ? {
              OR: [
                { reference: { contains: q.search, mode: 'insensitive' } },
                { merchant: { contains: q.search, mode: 'insensitive' } },
                { category: { contains: q.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: { supplier: true },
      orderBy: { expenseDate: 'desc' },
    });
  }
  async createExpense(org: string, d: ExpenseDto) {
    if (d.supplierId) await this.supplier(org, d.supplierId);
    const expense = await this.db.expense.create({
      data: {
        ...d,
        organizationId: org,
        expenseDate: new Date(d.expenseDate),
        amount: new Prisma.Decimal(d.amount),
        taxAmount: new Prisma.Decimal(d.taxAmount),
      },
    });
    await this.workflows?.executeEvent(org, 'EXPENSE_CREATED', {
      entityType: 'EXPENSE',
      entityId: expense.id,
      reference: expense.reference,
      title: `Approve expense ${expense.reference}`,
      amount: Number(expense.amount),
    });
    return expense;
  }
  async expenseStatus(org: string, id: string, status: ExpenseStatus) {
    return this.db.$transaction(async (tx) => {
      const e = await tx.expense.findFirst({ where: { id, organizationId: org } });
      if (!e) throw new NotFoundException('Expense not found');
      const allowed: Record<string, string[]> = {
        PENDING: ['APPROVED', 'REJECTED'],
        APPROVED: ['VOID'],
      };
      if (!allowed[e.status]?.includes(status))
        throw new BadRequestException('Invalid expense status transition');
      if (status === 'APPROVED' && e.bankAccountId)
        await this.postBank(
          tx,
          org,
          e.bankAccountId,
          e.expenseDate.toISOString(),
          `Expense: ${e.merchant}`,
          e.reference,
          e.amount,
          'EXPENSE',
          id,
          e.currency,
        );
      if (status === 'VOID') {
        const bt = await tx.bankTransaction.findFirst({
          where: { organizationId: org, sourceType: 'EXPENSE', sourceId: id, reversedAt: null },
        });
        if (bt) {
          await tx.bankTransaction.update({
            where: { id: bt.id },
            data: { reversedAt: new Date() },
          });
          await this.recalc(tx, org, bt.bankAccountId);
        }
      }
      return tx.expense.update({ where: { id }, data: { status } });
    });
  }
  private async postBank(
    tx: Prisma.TransactionClient,
    org: string,
    accountId: string,
    date: string,
    description: string,
    reference: string,
    amount: Prisma.Decimal,
    sourceType: string,
    sourceId: string,
    currency: string,
  ) {
    const a = await tx.bankAccount.findFirst({
      where: { id: accountId, organizationId: org, isActive: true },
    });
    if (!a) throw new BadRequestException('Bank account not found');
    if (a.currency !== currency)
      throw new BadRequestException('Bank account currency must match the document currency');
    await tx.bankTransaction.create({
      data: {
        organizationId: org,
        bankAccountId: accountId,
        transactionDate: new Date(date),
        description,
        reference,
        type: 'MONEY_OUT',
        amount,
        balanceAfter: a.currentBalance,
        sourceType,
        sourceId: sourceId === 'pending' ? undefined : sourceId,
      },
    });
    await this.recalc(tx, org, accountId);
  }
  private async recalc(tx: Prisma.TransactionClient, org: string, accountId: string) {
    const a = await tx.bankAccount.findFirstOrThrow({
        where: { id: accountId, organizationId: org },
      }),
      rows = await tx.bankTransaction.findMany({
        where: { organizationId: org, bankAccountId: accountId, reversedAt: null },
        orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }],
      });
    let balance = a.openingBalance;
    for (const r of rows) {
      balance = r.type === 'MONEY_IN' ? balance.add(r.amount) : balance.sub(r.amount);
      await tx.bankTransaction.update({ where: { id: r.id }, data: { balanceAfter: balance } });
    }
    await tx.bankAccount.update({ where: { id: accountId }, data: { currentBalance: balance } });
  }
}
