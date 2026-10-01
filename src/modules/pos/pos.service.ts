import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.ts';
import { assertBranch } from '../../common/branch-scope.ts';
import type { UpdatePosReceiptSignaturesDto } from './dto/pos.dto.ts';
import { postAutomaticJournal } from '../../common/automatic-accounting.ts';

export function assertSaleQuantity(
  product: { name?: string; allowFractionalSale: boolean },
  rawQuantity: number | Prisma.Decimal,
  action = 'sale',
) {
  const quantity = new Prisma.Decimal(rawQuantity);
  const valid = product.allowFractionalSale ? quantity.mul(2).isInteger() : quantity.isInteger();
  if (!valid) {
    const increments = product.allowFractionalSale ? 'half-unit increments' : 'whole units';
    throw new BadRequestException(
      `${product.name ?? 'This product'} can only be processed in ${increments} for this ${action}`,
    );
  }
}

@Injectable()
export class PosService {
  constructor(private readonly db: PrismaService) {}
  async list(
    org: string,
    query: {
      page?: number;
      limit?: number;
      from?: string;
      to?: string;
      customerId?: string;
      search?: string;
    },
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const endDate = query.to ? new Date(query.to) : undefined;
    if (endDate && /^\d{4}-\d{2}-\d{2}$/.test(query.to!)) endDate.setDate(endDate.getDate() + 1);
    const where: Prisma.PosSaleWhereInput = {
      organizationId: org,
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(endDate ? { lt: endDate } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { receiptNumber: { contains: query.search, mode: 'insensitive' } },
              { customer: { displayName: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [data, total] = await this.db.$transaction([
      this.db.posSale.findMany({
        where,
        include: { items: true, payments: true, customer: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.posSale.count({ where }),
    ]);
    return {
      data,
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  }
  registers(org: string, staffId: string, role: string) {
    return this.db.posRegister.findMany({
      where: {
        organizationId: org,
        isActive: true,
        ...(!['OWNER', 'ADMIN'].includes(role) ? { assignedStaffId: staffId } : {}),
      },
      include: {
        warehouse: true,
        assignedStaff: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
      orderBy: { code: 'asc' },
    });
  }
  async updateReceiptSignatures(org: string, saleId: string, data: UpdatePosReceiptSignaturesDto) {
    const sale = await this.db.posSale.findFirst({
      where: { id: saleId, organizationId: org },
      select: { id: true },
    });
    if (!sale) throw new NotFoundException('Sale not found');
    return this.db.posSale.update({
      where: { id: sale.id },
      data: {
        customerSignature: data.customerSignature ?? null,
        salesManagerSignature: data.salesManagerSignature ?? null,
      },
      include: { items: true, payments: true, customer: true },
    });
  }
  async createRegister(
    org: string,
    data: { warehouseId: string; assignedStaffId: string; code: string; name: string },
  ) {
    const [warehouse, membership] = await Promise.all([
      this.db.warehouse.findFirst({
        where: { id: data.warehouseId, organizationId: org, isActive: true },
      }),
      this.db.membership.findFirst({
        where: {
          organizationId: org,
          userId: data.assignedStaffId,
          user: { isActive: true },
        },
      }),
    ]);
    if (!warehouse) throw new BadRequestException('Select an active warehouse for this register');
    if (!membership) throw new BadRequestException('Select an active staff member for this register');
    return this.db.posRegister.create({
      data: { ...data, organizationId: org },
      include: {
        warehouse: true,
        assignedStaff: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });
  }
  async assignRegisterStaff(org: string, registerId: string, assignedStaffId: string) {
    const [register, membership] = await Promise.all([
      this.db.posRegister.findFirst({ where: { id: registerId, organizationId: org, isActive: true } }),
      this.db.membership.findFirst({
        where: { organizationId: org, userId: assignedStaffId, user: { isActive: true } },
      }),
    ]);
    if (!register) throw new NotFoundException('Active register not found');
    if (!membership) throw new BadRequestException('Select an active staff member for this register');
    return this.db.posRegister.update({
      where: { id: register.id },
      data: { assignedStaffId },
      include: {
        warehouse: true,
        assignedStaff: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });
  }
  currentShift(org: string, cashierId: string) {
    return this.db.posShift.findFirst({
      where: { organizationId: org, cashierId, status: 'OPEN' },
      include: { register: true },
      orderBy: { openedAt: 'desc' },
    });
  }
  async openShift(
    org: string,
    cashierId: string,
    data: { registerId: string; openingCash: number },
  ) {
    const register = await this.db.posRegister.findFirst({
      where: { id: data.registerId, organizationId: org, isActive: true },
    });
    if (!register) throw new NotFoundException('Active register not found');
    if (!register.assignedStaffId)
      throw new BadRequestException('Assign this register to an active staff member first');
    if (register.assignedStaffId !== cashierId)
      throw new BadRequestException('This register is assigned to another staff member');
    const existing = await this.db.posShift.findFirst({
      where: { registerId: register.id, status: 'OPEN' },
    });
    if (existing) throw new BadRequestException('This register already has an open shift');
    return this.db.posShift.create({
      data: {
        organizationId: org,
        registerId: register.id,
        cashierId,
        openingCash: data.openingCash,
      },
    });
  }
  async closeShift(
    org: string,
    cashierId: string,
    id: string,
    data: { closingCash: number; notes?: string },
  ) {
    const shift = await this.db.posShift.findFirst({
      where: { id, organizationId: org, cashierId, status: 'OPEN' },
    });
    if (!shift) throw new NotFoundException('Open cashier shift not found');
    const cash = await this.db.posPayment.aggregate({
      where: { method: 'CASH', sale: { shiftId: id, status: 'COMPLETED' } },
      _sum: { amount: true },
    });
    const expectedCash = new Prisma.Decimal(shift.openingCash).add(cash._sum.amount ?? 0);
    return this.db.posShift.update({
      where: { id },
      data: {
        status: 'CLOSED',
        closingCash: data.closingCash,
        expectedCash,
        variance: new Prisma.Decimal(data.closingCash).sub(expectedCash),
        closeNotes: data.notes,
        closedAt: new Date(),
      },
    });
  }
  async complete(
    org: string,
    cashierId: string,
    role: string,
    data: {
      registerId: string;
      branchId?: string;
      idempotencyKey?: string;
      customerId?: string;
      items: Array<{ productId: string; quantity: number; discount?: number }>;
      payments: Array<{
        method: 'CASH' | 'CARD' | 'TRANSFER' | 'CREDIT';
        amount: number;
        reference?: string;
      }>;
    },
  ) {
    await assertBranch(this.db, org, data.branchId);
    if (!data.items?.length || !data.payments?.length)
      throw new BadRequestException('Items and payment are required');
    return this.db.$transaction(async (tx) => {
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: org },
        select: { baseCurrency: true },
      });
      if (data.idempotencyKey) {
        const prior = await tx.posSale.findFirst({
          where: { organizationId: org, idempotencyKey: data.idempotencyKey },
          include: { items: true, payments: true, customer: true },
        });
        if (prior) return prior;
      }
      const shift = await tx.posShift.findFirst({
        where: { organizationId: org, registerId: data.registerId, cashierId, status: 'OPEN' },
        include: { register: { include: { warehouse: true } } },
      });
      if (!shift || !shift.register.isActive || !shift.register.warehouse.isActive)
        throw new BadRequestException(
          'Open a cashier shift on an active register before completing a sale',
        );
      if (shift.register.assignedStaffId !== cashierId)
        throw new BadRequestException('This register is not assigned to the signed-in staff member');
      const warehouse = shift.register.warehouse;
      const products = await tx.product.findMany({
        where: {
          organizationId: org,
          id: { in: data.items.map((x) => x.productId) },
          isActive: true,
        },
      });
      if (products.length !== data.items.length)
        throw new BadRequestException('One or more products are unavailable');
      let subtotal = new Prisma.Decimal(0),
        discountTotal = new Prisma.Decimal(0),
        taxTotal = new Prisma.Decimal(0);
      const items = data.items.map((line) => {
        const product = products.find((x) => x.id === line.productId)!;
        assertSaleQuantity(product, line.quantity);
        const base = new Prisma.Decimal(product.salePrice).mul(line.quantity),
          discount = new Prisma.Decimal(line.discount || 0);
        const taxable = base.sub(discount),
          tax = taxable.mul(product.taxRate).div(100);
        subtotal = subtotal.add(base);
        discountTotal = discountTotal.add(discount);
        taxTotal = taxTotal.add(tax);
        return {
          product,
          quantity: new Prisma.Decimal(line.quantity),
          discount,
          total: taxable.add(tax),
        };
      });
      const total = subtotal.sub(discountTotal).add(taxTotal),
        paid = data.payments.reduce((sum, p) => sum.add(p.amount), new Prisma.Decimal(0));
      if (paid.lt(total)) throw new BadRequestException('Payment is less than the total due');
      const nonCashPaid = data.payments
        .filter((payment) => payment.method !== 'CASH')
        .reduce((sum, payment) => sum.add(payment.amount), new Prisma.Decimal(0));
      if (nonCashPaid.gt(total))
        throw new BadRequestException(
          'Card, transfer, and credit payments cannot exceed the total due',
        );
      if (paid.gt(total) && !data.payments.some((payment) => payment.method === 'CASH'))
        throw new BadRequestException('Only cash payments can exceed the total due');
      if (discountTotal.gt(0) && !['OWNER', 'ADMIN', 'APPROVER'].includes(role))
        throw new BadRequestException('Discounts require an approved role');
      const credit = data.payments
        .filter((p) => p.method === 'CREDIT')
        .reduce((sum, p) => sum.add(p.amount), new Prisma.Decimal(0));
      if (credit.gt(0)) {
        if (!data.customerId)
          throw new BadRequestException('Credit sales require a selected customer');
        const customer = await tx.customer.findFirst({
          where: { id: data.customerId, organizationId: org, isActive: true },
        });
        if (!customer) throw new BadRequestException('Selected customer is unavailable');
        const exposure = await tx.posPayment.aggregate({
          where: {
            method: 'CREDIT',
            sale: { organizationId: org, customerId: data.customerId, status: 'COMPLETED' },
          },
          _sum: { amount: true },
        });
        if (new Prisma.Decimal(exposure._sum.amount ?? 0).add(credit).gt(customer.creditLimit))
          throw new BadRequestException('Customer credit limit would be exceeded');
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pos-receipt:${org}`}))`;
      const count = await tx.posSale.count({ where: { organizationId: org } });
      const receiptNumber = `POS-${String(count + 1).padStart(6, '0')}`;
      // A terminal/provider reference is retained when supplied. Manual card and
      // transfer payments receive a traceable POS reference automatically.
      const payments = data.payments.map((payment, index) => ({
        ...payment,
        reference:
          payment.reference?.trim() ||
          (['CARD', 'TRANSFER'].includes(payment.method)
            ? `${payment.method}-${receiptNumber}-${String(index + 1).padStart(2, '0')}`
            : undefined),
      }));
      for (const item of items.filter((x) => x.product.type === 'PRODUCT')) {
        const movements = await tx.stockMovement.findMany({
          where: { organizationId: org, productId: item.product.id, warehouseId: warehouse.id },
          select: { type: true, quantity: true },
        });
        const available = movements.reduce(
          (sum, m) =>
            sum.add(
              ['ISSUE', 'TRANSFER_OUT'].includes(m.type)
                ? new Prisma.Decimal(m.quantity).neg()
                : m.quantity,
            ),
          new Prisma.Decimal(0),
        );
        if (available.lt(item.quantity))
          throw new BadRequestException(`${item.product.name}: insufficient stock`);
      }
      const sale = await tx.posSale.create({
        data: {
          organizationId: org,
          branchId: data.branchId,
          customerId: data.customerId || null,
          registerId: shift.registerId,
          shiftId: shift.id,
          warehouseId: warehouse.id,
          cashierId,
          idempotencyKey: data.idempotencyKey,
          discountApprovedBy: discountTotal.gt(0) ? cashierId : null,
          receiptNumber,
          currency: organization.baseCurrency,
          subtotal,
          discountTotal,
          taxTotal,
          total,
          paidAmount: paid,
          changeAmount: paid.sub(total),
          items: {
            create: items.map((x) => ({
              productId: x.product.id,
              description: x.product.name,
              quantity: x.quantity,
              unitPrice: x.product.salePrice,
              discount: x.discount,
              taxRate: x.product.taxRate,
              lineTotal: x.total,
            })),
          },
          payments: { create: payments },
        },
        include: { items: true, payments: true, customer: true },
      });
      await Promise.all(
        items
          .filter((x) => x.product.type === 'PRODUCT')
          .map((x) =>
            tx.stockMovement.create({
              data: {
                organizationId: org,
                productId: x.product.id,
                warehouseId: warehouse.id,
                type: 'ISSUE',
                quantity: x.quantity,
                unitCost: x.product.costPrice,
                movementDate: new Date(),
                reference: `${receiptNumber}-${x.product.sku}`,
                notes: 'POS sale',
              },
            }),
          ),
      );
      await this.postSaleJournals(tx, org, receiptNumber, total, taxTotal, credit, items);
      await tx.posAuditLog.create({
        data: {
          organizationId: org,
          actorId: cashierId,
          action: 'SALE_COMPLETED',
          entityType: 'PosSale',
          entityId: sale.id,
          metadata: { receiptNumber, registerId: shift.registerId, shiftId: shift.id },
        },
      });
      return sale;
    });
  }
  async voidSale(org: string, actorId: string, saleId: string, reason: string) {
    return this.db.$transaction(async (tx) => {
      const sale = await tx.posSale.findFirst({
        where: { id: saleId, organizationId: org, status: 'COMPLETED' },
        include: { items: { include: { product: true } }, returns: true },
      });
      if (!sale || !sale.warehouseId) throw new NotFoundException('Completed sale not found');
      if (sale.returns.length)
        throw new BadRequestException('Use returns for a sale with returned items');
      const journals = await tx.journal.findMany({
        where: {
          organizationId: org,
          number: { in: [`POS-${sale.receiptNumber}`, `COGS-${sale.receiptNumber}`] },
          status: 'POSTED',
        },
      });
      if (!journals.length) throw new BadRequestException('POS accounting journals not found');
      for (const journal of journals) {
        const lines = (
          journal.lines as Array<{
            accountId: string;
            debit: number;
            credit: number;
            memo?: string;
          }>
        ).map((line) => ({ ...line, debit: line.credit, credit: line.debit }));
        await tx.journal.create({
          data: {
            organizationId: org,
            number: `VOID-${journal.number}`,
            journalDate: new Date(),
            description: `Void ${journal.number}: ${reason}`,
            status: 'POSTED',
            postedAt: new Date(),
            lines,
            total: journal.total,
            reversedJournalId: journal.id,
          },
        });
        await tx.journal.update({ where: { id: journal.id }, data: { status: 'REVERSED' } });
      }
      await Promise.all(
        sale.items
          .filter((item) => item.product.type === 'PRODUCT')
          .map((item) =>
            tx.stockMovement.create({
              data: {
                organizationId: org,
                productId: item.productId,
                warehouseId: sale.warehouseId!,
                type: 'RECEIPT',
                quantity: item.quantity,
                unitCost: item.product.costPrice,
                movementDate: new Date(),
                reference: `VOID-${sale.receiptNumber}-${item.id}`,
                notes: reason,
              },
            }),
          ),
      );
      await tx.posPayment.updateMany({ where: { saleId }, data: { status: 'REVERSED' } });
      const result = await tx.posSale.update({ where: { id: saleId }, data: { status: 'VOIDED' } });
      await tx.posAuditLog.create({
        data: {
          organizationId: org,
          actorId,
          action: 'SALE_VOIDED',
          entityType: 'PosSale',
          entityId: saleId,
          metadata: { receiptNumber: sale.receiptNumber, reason },
        },
      });
      return result;
    });
  }
  private async postSaleJournals(
    tx: Prisma.TransactionClient,
    org: string,
    receipt: string,
    total: Prisma.Decimal,
    tax: Prisma.Decimal,
    credit: Prisma.Decimal,
    items: Array<{
      product: { type: string; costPrice: Prisma.Decimal };
      quantity: Prisma.Decimal;
    }>,
  ) {
    const revenue = total.sub(tax),
      cash = total.sub(credit),
      cogs = items
        .filter((item) => item.product.type === 'PRODUCT')
        .reduce(
          (sum, item) => sum.add(item.product.costPrice.mul(item.quantity)),
          new Prisma.Decimal(0),
        );
    await postAutomaticJournal(tx, {
      organizationId: org,
      number: `POS-${receipt}`,
      journalDate: new Date(),
      description: `POS sale ${receipt}`,
      lines: [
        { accountCode: '1000', debit: cash, credit: 0, memo: 'POS payment' },
        { accountCode: '1100', debit: credit, credit: 0, memo: 'POS credit sale' },
        { accountCode: '4000', debit: 0, credit: revenue, memo: 'POS revenue' },
        { accountCode: '2100', debit: 0, credit: tax, memo: 'Output tax' },
      ],
    });
    if (cogs.gt(0))
      await postAutomaticJournal(tx, {
        organizationId: org,
        number: `COGS-${receipt}`,
        journalDate: new Date(),
        description: `Inventory cost for POS sale ${receipt}`,
        lines: [
          { accountCode: '5300', debit: cogs, credit: 0, memo: 'Cost of goods sold' },
          { accountCode: '1300', debit: 0, credit: cogs, memo: 'Inventory issued' },
        ],
      });
  }
  async returnItem(
    org: string,
    actorId: string,
    saleId: string,
    data: { productId: string; quantity: number; reason: string },
  ) {
    return this.db.$transaction(async (tx) => {
      const sale = await tx.posSale.findFirst({
        where: { id: saleId, organizationId: org, status: 'COMPLETED' },
        include: {
          items: {
            include: {
              product: {
                select: {
                  costPrice: true,
                  sku: true,
                  type: true,
                  name: true,
                  allowFractionalSale: true,
                },
              },
            },
          },
          returns: true,
        },
      });
      if (!sale || !sale.warehouseId) throw new NotFoundException('Completed sale not found');
      const item = sale.items.find((x) => x.productId === data.productId);
      if (!item) throw new BadRequestException('Product was not sold on this receipt');
      assertSaleQuantity(item.product, data.quantity, 'return');
      const returned = sale.returns
        .filter((x) => x.productId === data.productId)
        .reduce((sum, x) => sum.add(x.quantity), new Prisma.Decimal(0));
      if (returned.add(data.quantity).gt(item.quantity))
        throw new BadRequestException('Return quantity exceeds the quantity sold');
      const amount = new Prisma.Decimal(item.lineTotal).div(item.quantity).mul(data.quantity);
      const returnedBase = amount.div(new Prisma.Decimal(1).add(item.taxRate.div(100)));
      const returnedTax = amount.sub(returnedBase);
      const originalMovement = await tx.stockMovement.findFirst({
        where: {
          organizationId: org,
          reference: `${sale.receiptNumber}-${item.product.sku}`,
        },
        select: { unitCost: true },
      });
      const unitCost = originalMovement?.unitCost ?? item.product.costPrice;
      const costReturned =
        item.product.type === 'PRODUCT' ? unitCost.mul(data.quantity) : new Prisma.Decimal(0);
      const result = await tx.posReturn.create({
        data: {
          organizationId: org,
          saleId,
          productId: data.productId,
          quantity: data.quantity,
          amount,
          reason: data.reason,
          processedBy: actorId,
        },
      });
      if (item.product.type === 'PRODUCT')
        await tx.stockMovement.create({
          data: {
            organizationId: org,
            productId: data.productId,
            warehouseId: sale.warehouseId,
            type: 'RECEIPT',
            quantity: data.quantity,
            unitCost,
            movementDate: new Date(),
            reference: `RETURN-${sale.receiptNumber}-${result.id}`,
            notes: data.reason,
          },
        });
      await postAutomaticJournal(tx, {
        organizationId: org,
        number: `AUTO-POS-RETURN-${result.id}`,
        journalDate: new Date(),
        description: `POS return ${sale.receiptNumber}`,
        lines: [
          { accountCode: '4000', debit: returnedBase, credit: 0, memo: 'Sales return' },
          { accountCode: '2100', debit: returnedTax, credit: 0, memo: 'Tax adjustment' },
          { accountCode: '1000', debit: 0, credit: amount, memo: 'Customer refund' },
          { accountCode: '1300', debit: costReturned, credit: 0, memo: 'Inventory returned' },
          {
            accountCode: '5300',
            debit: 0,
            credit: costReturned,
            memo: 'Reverse cost of goods sold',
          },
        ],
      });
      await tx.posAuditLog.create({
        data: {
          organizationId: org,
          actorId,
          action: 'ITEM_RETURNED',
          entityType: 'PosReturn',
          entityId: result.id,
          metadata: { saleId, productId: data.productId, quantity: data.quantity },
        },
      });
      return result;
    });
  }

}
