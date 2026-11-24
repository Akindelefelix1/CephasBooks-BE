import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BillStatus,
  ExpenseStatus,
  Prisma,
  PurchaseOrderStatus,
  PurchaseRequestStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.ts';
import { assertBranch } from '../../common/branch-scope.ts';
import {
  postAutomaticJournal,
  reverseAutomaticJournal,
} from '../../common/automatic-accounting.ts';
import { WorkflowService } from '../workflow/workflow.service.ts';
import {
  BillDto,
  ExpenseDto,
  GoodsReceivedNoteDto,
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
  private async currency(org: string, requested?: string) {
    if (requested) return requested.toUpperCase();
    const organization = await this.db.organization.findUniqueOrThrow({
      where: { id: org },
      select: { baseCurrency: true },
    });
    return organization.baseCurrency;
  }
  private async nextBillNumber(org: string) {
    const bills = await this.db.bill.findMany({
      where: { organizationId: org },
      select: { number: true },
    });
    const last = bills.reduce((highest, bill) => {
      const match = /^BILL-(\d+)$/i.exec(bill.number);
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0);
    return `BILL-${String(last + 1).padStart(5, '0')}`;
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
  async createSupplier(org: string, d: SupplierDto) {
    await assertBranch(this.db, org, d.branchId);
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
  async createRequest(org: string, d: RequestDto) {
    await assertBranch(this.db, org, d.branchId);
    const { total } = this.totals(d.items);
    const currency = await this.currency(org, d.currency);
    return this.db.purchaseRequest.create({
      data: {
        ...d,
        currency,
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
      include: { supplier: true, request: true, goodsReceivedNotes: { select: { items: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }
  goodsReceivedNotes(org: string, q: Record<string, string>) {
    return this.db.goodsReceivedNote.findMany({
      where: {
        organizationId: org,
        ...(q.search
          ? {
              OR: [
                { reference: { contains: q.search, mode: 'insensitive' as const } },
                { supplierReference: { contains: q.search, mode: 'insensitive' as const } },
                { purchaseOrder: { number: { contains: q.search, mode: 'insensitive' as const } } },
                { supplier: { displayName: { contains: q.search, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      },
      include: {
        supplier: true,
        purchaseOrder: { select: { id: true, number: true, currency: true, items: true } },
        warehouse: { select: { id: true, code: true, name: true } },
        recordedBy: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
      orderBy: [{ receivedDate: 'desc' }, { createdAt: 'desc' }],
    });
  }
  async goodsReceivedNoteOptions(org: string) {
    const [products, warehouses] = await Promise.all([
      this.db.product.findMany({
        where: { organizationId: org, isActive: true, type: 'PRODUCT' },
        select: { id: true, sku: true, name: true, unit: true },
        orderBy: { name: 'asc' },
      }),
      this.db.warehouse.findMany({
        where: { organizationId: org, isActive: true },
        select: { id: true, branchId: true, code: true, name: true, isDefault: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return { products, warehouses };
  }
  async createGoodsReceivedNote(org: string, actorId: string, d: GoodsReceivedNoteDto) {
    const reference = d.reference.trim();
    if (!reference) throw new BadRequestException('GRN reference is required');
    return this.db.$transaction(
      async (tx) => {
        const order = await tx.purchaseOrder.findFirst({
          where: { id: d.purchaseOrderId, organizationId: org },
        });
        if (!order) throw new NotFoundException('Purchase order not found');
        if (['DRAFT', 'CANCELLED'].includes(order.status))
          throw new BadRequestException('Only an issued purchase order can receive goods');
        const warehouse = await tx.warehouse.findFirst({
          where: { id: d.warehouseId, organizationId: org, isActive: true },
        });
        if (!warehouse) throw new NotFoundException('Active stock location not found');
        if (order.branchId && warehouse.branchId !== order.branchId)
          throw new BadRequestException(
            'The receiving stock location must belong to the purchase order branch',
          );
        const orderItems = Array.isArray(order.items)
          ? (order.items as Array<Record<string, unknown>>)
          : [];
        if (!orderItems.length)
          throw new BadRequestException('Purchase order has no receivable items');
        const seen = new Set<number>();
        for (const line of d.items) {
          if (
            !Number.isInteger(line.orderLineIndex) ||
            line.orderLineIndex < 0 ||
            line.orderLineIndex >= orderItems.length
          )
            throw new BadRequestException('A received item does not match a purchase order line');
          if (seen.has(line.orderLineIndex))
            throw new BadRequestException('Each purchase order line can appear only once per GRN');
          seen.add(line.orderLineIndex);
          const split = line.acceptedQuantity + line.damagedQuantity + line.rejectedQuantity;
          if (Math.abs(split - line.receivedQuantity) > 0.00001)
            throw new BadRequestException(
              'Received quantity must equal accepted, damaged and rejected quantities',
            );
          for (const quantity of [
            line.receivedQuantity,
            line.acceptedQuantity,
            line.damagedQuantity,
            line.rejectedQuantity,
          ])
            if (Math.abs(quantity * 10000 - Math.round(quantity * 10000)) > 0.00001)
              throw new BadRequestException(
                'Received quantities can have at most four decimal places',
              );
        }
        const duplicate = await tx.goodsReceivedNote.findFirst({
          where: { organizationId: org, reference },
        });
        if (duplicate) throw new BadRequestException('A GRN with this reference already exists');
        const prior = await tx.goodsReceivedNote.findMany({
          where: { organizationId: org, purchaseOrderId: order.id },
          select: { items: true },
        });
        const previouslyReceived = new Map<number, number>();
        for (const note of prior)
          for (const item of (Array.isArray(note.items) ? note.items : []) as Array<
            Record<string, unknown>
          >) {
            const index = Number(item.orderLineIndex);
            previouslyReceived.set(
              index,
              (previouslyReceived.get(index) ?? 0) + Number(item.receivedQuantity ?? 0),
            );
          }
        let complete = true;
        for (const line of d.items) {
          const ordered = Number(orderItems[line.orderLineIndex]?.quantity ?? 0);
          const received =
            (previouslyReceived.get(line.orderLineIndex) ?? 0) + line.receivedQuantity;
          if (ordered <= 0 || received - ordered > 0.00001)
            throw new BadRequestException(
              `Received quantity exceeds the ordered quantity for ${String(orderItems[line.orderLineIndex]?.name ?? 'an item')}`,
            );
        }
        for (let i = 0; i < orderItems.length; i++) {
          const ordered = Number(orderItems[i]?.quantity ?? 0);
          const next =
            (previouslyReceived.get(i) ?? 0) +
            (d.items.find((item) => item.orderLineIndex === i)?.receivedQuantity ?? 0);
          if (next + 0.00001 < ordered) complete = false;
        }
        const normalizedItems: Array<
          GoodsReceivedNoteDto['items'][number] & {
            itemName: string;
            itemDescription: string;
            orderedQuantity: number;
            unitCost: number;
            outstandingQuantity: number;
          }
        > = [];
        const inventoryProducts = new Map<string, { id: string; name: string }>();
        for (const line of d.items) {
          const orderItem = orderItems[line.orderLineIndex];
          if (!orderItem)
            throw new BadRequestException('A received item does not match a purchase order line');
          const mappedProductId =
            typeof orderItem.productId === 'string' ? orderItem.productId : undefined;
          if (mappedProductId && line.productId && mappedProductId !== line.productId)
            throw new BadRequestException(
              'This purchase order line is already mapped to a different inventory product',
            );
          const productId = mappedProductId ?? line.productId;
          if (line.acceptedQuantity > 0 && !productId)
            throw new BadRequestException(
              'Select an inventory product for every accepted quantity',
            );
          const product = productId
            ? await tx.product.findFirst({
                where: { id: productId, organizationId: org, isActive: true, type: 'PRODUCT' },
                select: { id: true, name: true },
              })
            : null;
          if (productId && !product)
            throw new BadRequestException('Select an active inventory product for received goods');
          if (product) inventoryProducts.set(product.id, product);
          normalizedItems.push({
            ...line,
            productId,
            itemName: String(orderItem.name ?? ''),
            itemDescription: String(orderItem.description ?? ''),
            orderedQuantity: Number(orderItem.quantity ?? 0),
            unitCost: Number(orderItem.unitPrice ?? 0),
            outstandingQuantity: Math.max(
              0,
              Number(orderItem.quantity ?? 0) -
                (previouslyReceived.get(line.orderLineIndex) ?? 0) -
                line.receivedQuantity,
            ),
          });
        }
        const mappedOrderItems = orderItems.map((item, index) => {
          const receivedLine = normalizedItems.find((line) => line.orderLineIndex === index);
          return receivedLine?.productId ? { ...item, productId: receivedLine.productId } : item;
        });
        const note = await tx.goodsReceivedNote.create({
          data: {
            organizationId: org,
            purchaseOrderId: order.id,
            supplierId: order.supplierId,
            warehouseId: warehouse.id,
            recordedById: actorId,
            reference,
            supplierReference: d.supplierReference?.trim() || null,
            receivedDate: new Date(`${d.receivedDate.slice(0, 10)}T00:00:00.000Z`),
            items: normalizedItems as unknown as Prisma.InputJsonValue,
            notes: d.notes?.trim() || null,
          },
        });
        for (const line of normalizedItems) {
          if (line.acceptedQuantity <= 0 || !line.productId) continue;
          const product = inventoryProducts.get(line.productId);
          if (!product)
            throw new BadRequestException('Select an active inventory product for accepted goods');
          const movement = await tx.stockMovement.create({
            data: {
              organizationId: org,
              productId: product.id,
              warehouseId: warehouse.id,
              type: 'RECEIPT',
              quantity: new Prisma.Decimal(line.acceptedQuantity),
              unitCost: new Prisma.Decimal(line.unitCost),
              movementDate: new Date(`${d.receivedDate.slice(0, 10)}T00:00:00.000Z`),
              reference: `${reference}-${line.orderLineIndex + 1}`,
              performedById: actorId,
              notes: `Accepted goods from ${reference} / ${order.number}`,
            },
          });
          const stockValue = new Prisma.Decimal(line.acceptedQuantity).mul(line.unitCost);
          if (stockValue.gt(0))
            await postAutomaticJournal(tx, {
              organizationId: org,
              number: `AUTO-GRN-${movement.id}`,
              journalDate: movement.movementDate,
              description: `Inventory receipt ${reference}`,
              lines: [
                { accountCode: '1300', debit: stockValue, credit: 0, memo: product.name },
                { accountCode: '2000', debit: 0, credit: stockValue, memo: 'Inventory received' },
              ],
            });
        }
        await tx.purchaseOrder.update({
          where: { id: order.id },
          data: {
            status: complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED',
            items: mappedOrderItems as unknown as Prisma.InputJsonValue,
          },
        });
        await tx.auditLog.create({
          data: {
            organizationId: org,
            actorId,
            action: 'CREATE',
            entityType: 'GoodsReceivedNote',
            entityId: note.id,
            metadata: {
              reference,
              purchaseOrder: order.number,
              warehouse: warehouse.name,
              items: normalizedItems,
            } as unknown as Prisma.InputJsonValue,
          },
        });
        return note;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  async createOrder(org: string, d: OrderDto) {
    await assertBranch(this.db, org, d.branchId);
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
    const currency = await this.currency(org, d.currency);
    return this.db.$transaction(async (tx) => {
      const o = await tx.purchaseOrder.create({
        data: {
          ...d,
          currency,
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
  }
  async orderStatus(org: string, id: string, status: PurchaseOrderStatus) {
    const x = await this.db.purchaseOrder.findFirst({ where: { id, organizationId: org } });
    if (!x) throw new NotFoundException('Purchase order not found');
    const allowed: Record<string, string[]> = {
      DRAFT: ['ISSUED', 'CANCELLED'],
      ISSUED: ['CANCELLED'],
      PARTIALLY_RECEIVED: ['CANCELLED'],
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
    await assertBranch(this.db, org, d.branchId);
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
    const currency = await this.currency(org, d.currency);
    const bill = await this.db.$transaction(
      async (tx) => {
        if (d.purchaseOrderId) {
          const existingBill = await tx.bill.findFirst({
            where: { organizationId: org, purchaseOrderId: d.purchaseOrderId },
            select: { id: true },
          });
          if (existingBill)
            throw new BadRequestException(
              'A supplier bill has already been created for this purchase order',
            );
        }
        const b = await tx.bill.create({
          data: {
            ...d,
            currency,
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
      },
      d.purchaseOrderId
        ? { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        : undefined,
    );
    await this.workflows?.executeEvent(org, 'BILL_CREATED', {
      entityType: 'BILL',
      entityId: bill.id,
      reference: bill.number,
      title: `Approve bill ${bill.number}`,
      amount: Number(bill.total),
    });
    return bill;
  }
  async orderToBill(
    org: string,
    id: string,
    d: { number?: string; issueDate: string; dueDate: string },
  ) {
    const o = await this.db.purchaseOrder.findFirst({
      where: {
        id,
        organizationId: org,
        status: { in: ['ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED'] },
      },
    });
    if (!o) throw new BadRequestException('Purchase order is unavailable');
    const number = d.number || (await this.nextBillNumber(org));
    return this.createBill(org, {
      branchId: o.branchId ?? undefined,
      supplierId: o.supplierId,
      purchaseOrderId: o.id,
      number,
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
    return this.db.$transaction(async (tx) => {
      const bill = await tx.bill.update({ where: { id }, data: { status } });
      if (status === 'APPROVED')
        await postAutomaticJournal(tx, {
          organizationId: org,
          number: `AUTO-BILL-${bill.id}`,
          journalDate: bill.issueDate,
          description: `Supplier bill ${bill.number}`,
          lines: [
            {
              accountCode: '5000',
              debit: bill.total.sub(bill.taxTotal),
              credit: 0,
              memo: 'Purchases',
            },
            { accountCode: '1150', debit: bill.taxTotal, credit: 0, memo: 'Tax receivable' },
            { accountCode: '2000', debit: 0, credit: bill.total, memo: 'Accounts payable' },
          ],
        });
      if (status === 'VOID')
        await reverseAutomaticJournal(tx, {
          organizationId: org,
          number: `AUTO-BILL-${bill.id}`,
          reversalNumber: `AUTO-REV-BILL-${bill.id}`,
          journalDate: new Date(),
          description: `Reverse supplier bill ${bill.number}`,
        });
      return bill;
    });
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
    await assertBranch(this.db, org, d.branchId);
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
          branchId: d.branchId ?? b.branchId,
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
      await postAutomaticJournal(tx, {
        organizationId: org,
        number: `AUTO-SUPPLIER-PAYMENT-${p.id}`,
        journalDate: p.paymentDate,
        description: `Supplier payment ${p.reference}`,
        lines: [
          { accountCode: '2000', debit: amount, credit: 0, memo: 'Accounts payable' },
          { accountCode: '1000', debit: 0, credit: amount, memo: p.method },
        ],
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
      await reverseAutomaticJournal(tx, {
        organizationId: org,
        number: `AUTO-SUPPLIER-PAYMENT-${p.id}`,
        reversalNumber: `AUTO-REV-SUPPLIER-PAYMENT-${p.id}`,
        journalDate: new Date(),
        description: `Reverse supplier payment ${p.reference}`,
      });
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
    await assertBranch(this.db, org, d.branchId);
    if (d.supplierId) await this.supplier(org, d.supplierId);
    const currency = await this.currency(org, d.currency);
    const expense = await this.db.expense.create({
      data: {
        ...d,
        currency,
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
      if (status === 'APPROVED') {
        const expenseAmount = e.amount.sub(e.taxAmount);
        await postAutomaticJournal(tx, {
          organizationId: org,
          number: `AUTO-EXPENSE-${e.id}`,
          journalDate: e.expenseDate,
          description: `Expense ${e.reference}: ${e.merchant}`,
          lines: [
            { accountCode: '5100', debit: expenseAmount, credit: 0, memo: e.category },
            { accountCode: '1150', debit: e.taxAmount, credit: 0, memo: 'Tax receivable' },
            {
              accountCode: e.bankAccountId ? '1000' : '2000',
              debit: 0,
              credit: e.amount,
              memo: e.bankAccountId ? 'Bank payment' : 'Accounts payable',
            },
          ],
        });
      }
      if (status === 'VOID') {
        await reverseAutomaticJournal(tx, {
          organizationId: org,
          number: `AUTO-EXPENSE-${e.id}`,
          reversalNumber: `AUTO-REV-EXPENSE-${e.id}`,
          journalDate: new Date(),
          description: `Reverse expense ${e.reference}`,
        });
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
