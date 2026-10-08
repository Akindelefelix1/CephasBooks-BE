import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service.ts';
import { assertBranch } from '../../common/branch-scope.ts';
import type { UpdatePosReceiptSignaturesDto } from './dto/pos.dto.ts';
import { postAutomaticJournal } from '../../common/automatic-accounting.ts';
import { MailService } from '../mail/mail.service.ts';

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

export function calculatePosLine(
  product: { name?: string; salePrice: number | Prisma.Decimal; taxRate: number | Prisma.Decimal },
  rawQuantity: number | Prisma.Decimal,
  rawUnitDiscount = 0,
) {
  const quantity = new Prisma.Decimal(rawQuantity);
  const unitPrice = new Prisma.Decimal(product.salePrice);
  const unitDiscount = new Prisma.Decimal(rawUnitDiscount);
  if (unitDiscount.gt(unitPrice))
    throw new BadRequestException(
      `${product.name ?? 'Product'}: discount per unit cannot exceed the unit price`,
    );
  const base = unitPrice.mul(quantity);
  const discount = unitDiscount.mul(quantity);
  const taxable = base.sub(discount);
  const tax = taxable.mul(product.taxRate).div(100);
  return { quantity, unitDiscount, base, discount, tax, total: taxable.add(tax) };
}

@Injectable()
export class PosService {
  constructor(
    private readonly db: PrismaService,
    private readonly mail?: MailService,
    private readonly config?: ConfigService,
  ) {}
  async list(
    org: string,
    query: {
      page?: number;
      limit?: number;
      from?: string;
      to?: string;
      customerId?: string;
      search?: string;
      includeVoided?: boolean;
    },
    staffId?: string,
    role = 'OWNER',
    permissions: string[] = [],
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const endDate = query.to ? new Date(query.to) : undefined;
    if (endDate && /^\d{4}-\d{2}-\d{2}$/.test(query.to!)) endDate.setDate(endDate.getDate() + 1);
    const accessibleBranches =
      staffId && role !== 'OWNER' ? await this.branches(org, staffId, role) : [];
    const restrictions: Prisma.PosSaleWhereInput[] = [];
    if (staffId && role !== 'OWNER')
      restrictions.push({
        OR: [
          { cashierId: staffId },
          { branchId: { in: accessibleBranches.map((branch) => String(branch.id)) } },
        ],
      });
    if (query.search)
      restrictions.push({
        OR: [
          { receiptNumber: { contains: query.search, mode: 'insensitive' } },
          { customer: { displayName: { contains: query.search, mode: 'insensitive' } } },
        ],
      });
    const where: Prisma.PosSaleWhereInput = {
      organizationId: org,
      status:
        query.includeVoided &&
        (['OWNER', 'ADMIN'].includes(role) || permissions.includes('sales.manage'))
          ? { in: ['COMPLETED', 'VOIDED'] }
          : 'COMPLETED',
      ...(restrictions.length ? { AND: restrictions } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(endDate ? { lt: endDate } : {}),
            },
          }
        : {}),
    };
    const [data, total] = await this.db.$transaction([
      this.db.posSale.findMany({
        where,
        include: {
          items: { include: { product: { select: { allowFractionalSale: true } } } },
          payments: true,
          customer: true,
          returns: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.posSale.count({ where }),
    ]);
    return {
      data: await Promise.all(
        data.map((sale) => this.decorateReceipt(org, sale as unknown as Record<string, unknown>)),
      ),
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  }
  async receipt(org: string, saleId: string, staffId?: string, role = 'OWNER') {
    const accessibleBranches =
      staffId && role !== 'OWNER' ? await this.branches(org, staffId, role) : [];
    const sale = await this.db.posSale.findFirst({
      where: {
        id: saleId,
        organizationId: org,
        ...(staffId && role !== 'OWNER'
          ? {
              OR: [
                { cashierId: staffId },
                { branchId: { in: accessibleBranches.map((branch) => String(branch.id)) } },
              ],
            }
          : {}),
      },
      include: {
        items: { include: { product: { select: { allowFractionalSale: true } } } },
        payments: true,
        customer: true,
        returns: true,
      },
    });
    if (!sale) throw new NotFoundException('Sale receipt not found');
    return this.decorateReceipt(org, sale as unknown as Record<string, unknown>);
  }
  async saleAudit(org: string, saleId: string) {
    const sale = await this.db.posSale.findFirst({
      where: { id: saleId, organizationId: org },
      select: { id: true },
    });
    if (!sale) throw new NotFoundException('Sale not found');
    const returns = await this.db.posReturn.findMany({
      where: { organizationId: org, saleId },
      select: { id: true },
    });
    return this.db.posAuditLog.findMany({
      where: {
        organizationId: org,
        OR: [
          { entityType: 'PosSale', entityId: saleId },
          { entityType: 'PosReturn', entityId: { in: returns.map((item) => item.id) } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  posAudit(org: string) {
    return this.db.posAuditLog.findMany({
      where: { organizationId: org },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  async recordReprint(org: string, actorId: string, saleId: string) {
    const sale = await this.receipt(org, saleId);
    await this.db.posAuditLog.create({
      data: {
        organizationId: org,
        actorId,
        action: 'RECEIPT_REPRINTED',
        entityType: 'PosSale',
        entityId: saleId,
      },
    });
    return sale;
  }
  async emailReceipt(org: string, actorId: string, saleId: string) {
    const sale = (await this.receipt(org, saleId)) as Record<string, unknown> & {
      customer?: { email?: string | null } | null;
      receiptNumber?: string;
      receipt?: Record<string, unknown>;
    };
    if (!this.mail) throw new ServiceUnavailableException('Email delivery is unavailable');
    const customer = sale.customer as { email?: string | null } | null;
    const email = customer?.email?.trim();
    if (!email) throw new BadRequestException('This sale customer does not have an email address');
    const context = sale.receipt as Record<string, unknown>;
    await this.mail.send({
      to: email,
      subject: `${String(context.organizationName)} receipt ${String(sale.receiptNumber)}`,
      html: this.receiptEmailHtml(sale),
    });
    await this.db.posAuditLog.create({
      data: {
        organizationId: org,
        actorId,
        action: 'RECEIPT_EMAILED',
        entityType: 'PosSale',
        entityId: saleId,
        metadata: { email },
      },
    });
    return { sent: true };
  }
  async smsReceipt(org: string, actorId: string, saleId: string) {
    const sale = (await this.receipt(org, saleId)) as Record<string, unknown> & {
      customer?: { phone?: string | null } | null;
      receiptNumber?: string;
      receipt?: Record<string, unknown>;
    };
    const customer = sale.customer as { phone?: string | null } | null;
    const phone = customer?.phone?.trim();
    if (!phone) throw new BadRequestException('This sale customer does not have a phone number');
    const url = this.config?.get<string>('SMS_API_URL');
    const token = this.config?.get<string>('SMS_API_TOKEN');
    const sender = this.config?.get<string>('SMS_SENDER') || 'CephasBooks';
    if (!url || !token) throw new ServiceUnavailableException('SMS delivery is not configured');
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        to: phone,
        from: sender,
        message: `${String((sale.receipt as Record<string, unknown>).organizationName)} receipt ${String(sale.receiptNumber)}: ${String((sale.receipt as Record<string, unknown>).digitalUrl)}`,
      }),
    });
    if (!response.ok) throw new ServiceUnavailableException('Unable to send SMS receipt');
    await this.db.posAuditLog.create({
      data: {
        organizationId: org,
        actorId,
        action: 'RECEIPT_SMS_SENT',
        entityType: 'PosSale',
        entityId: saleId,
        metadata: { phone },
      },
    });
    return { sent: true };
  }
  async branches(org: string, staffId: string, role: string) {
    const organization = await this.db.organization.findUnique({
      where: { id: org },
      select: { onboardingData: true },
    });
    const membership =
      role === 'OWNER'
        ? null
        : await this.db.membership.findFirst({
            where: { organizationId: org, userId: staffId, user: { isActive: true } },
            select: { id: true },
          });
    const root = this.asObject(organization?.onboardingData);
    const admin = this.asObject(root.admin);
    const hierarchy = this.asObject(admin.branches);
    const branches = Array.isArray(hierarchy.items)
      ? (hierarchy.items as Array<Record<string, unknown>>)
      : [];
    return branches.filter(
      (branch) =>
        branch.status !== 'Inactive' &&
        (role === 'OWNER' ||
          (membership &&
            Array.isArray(branch.managerIds) &&
            branch.managerIds.includes(membership.id))),
    );
  }
  async registers(org: string, staffId: string, role: string) {
    const accessibleBranches = await this.branches(org, staffId, role);
    return this.db.posRegister.findMany({
      where: {
        organizationId: org,
        ...(role !== 'OWNER'
          ? {
              isActive: true,
              OR: [
                { branchId: { in: accessibleBranches.map((branch) => String(branch.id)) } },
                { branchId: null, assignedStaffId: staffId },
              ],
            }
          : {}),
      },
      include: {
        warehouse: true,
        assignedStaff: { select: { id: true, email: true, firstName: true, lastName: true } },
        shifts: {
          where: { status: 'OPEN' },
          include: {
            cashier: { select: { id: true, email: true, firstName: true, lastName: true } },
          },
          take: 1,
        },
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
    const updated = await this.db.posSale.update({
      where: { id: sale.id },
      data: {
        customerSignature: data.customerSignature ?? null,
        salesManagerSignature: data.salesManagerSignature ?? null,
      },
      include: { items: true, payments: true, customer: true },
    });
    return this.decorateReceipt(org, updated as unknown as Record<string, unknown>);
  }
  async createRegister(
    org: string,
    data: {
      warehouseId: string;
      assignedStaffId: string;
      branchId: string;
      defaultCashAccountId?: string | null;
      defaultCardAccountId?: string | null;
      defaultBankAccountId?: string | null;
      terminalId?: string | null;
      code: string;
      name: string;
    },
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
    if (!membership)
      throw new BadRequestException('Select an active staff member for this register');
    await this.requireBranch(org, data.branchId);
    await this.requireRegisterAccounts(org, [
      data.defaultCashAccountId,
      data.defaultCardAccountId,
      data.defaultBankAccountId,
    ]);
    return this.db.posRegister.create({
      data: {
        ...data,
        terminalId: data.terminalId?.trim() || null,
        organizationId: org,
      },
      include: {
        warehouse: true,
        assignedStaff: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });
  }
  async updateRegister(
    org: string,
    registerId: string,
    data: {
      warehouseId?: string;
      assignedStaffId?: string;
      branchId?: string;
      defaultCashAccountId?: string | null;
      defaultCardAccountId?: string | null;
      defaultBankAccountId?: string | null;
      terminalId?: string | null;
      code?: string;
      name?: string;
      isActive?: boolean;
    },
  ) {
    const register = await this.db.posRegister.findFirst({
      where: { id: registerId, organizationId: org },
    });
    if (!register) throw new NotFoundException('Register not found');
    const changesConfiguration = [
      data.warehouseId,
      data.assignedStaffId,
      data.branchId,
      data.defaultCashAccountId,
      data.defaultCardAccountId,
      data.defaultBankAccountId,
      data.terminalId,
      data.code,
      data.name,
    ].some((value) => value !== undefined);
    if (data.isActive === false || changesConfiguration) {
      const openShift = await this.db.posShift.findFirst({
        where: { registerId, organizationId: org, status: 'OPEN' },
        select: { id: true },
      });
      if (openShift)
        throw new BadRequestException('Close the open cashier shift before changing this register');
    }
    if (data.warehouseId) {
      const warehouse = await this.db.warehouse.findFirst({
        where: { id: data.warehouseId, organizationId: org, isActive: true },
        select: { id: true },
      });
      if (!warehouse) throw new BadRequestException('Select an active warehouse for this register');
    }
    if (data.assignedStaffId) {
      const membership = await this.db.membership.findFirst({
        where: {
          organizationId: org,
          userId: data.assignedStaffId,
          user: { isActive: true },
        },
        select: { id: true },
      });
      if (!membership)
        throw new BadRequestException('Select an active staff member for this register');
    }
    if (data.branchId) await this.requireBranch(org, data.branchId);
    await this.requireRegisterAccounts(org, [
      data.defaultCashAccountId,
      data.defaultCardAccountId,
      data.defaultBankAccountId,
    ]);
    return this.db.posRegister.update({
      where: { id: register.id },
      data: {
        ...data,
        ...(data.terminalId === undefined ? {} : { terminalId: data.terminalId?.trim() || null }),
      },
      include: {
        warehouse: true,
        assignedStaff: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });
  }
  async assignRegisterStaff(
    org: string,
    registerId: string,
    assignedStaffId: string,
    branchId: string,
  ) {
    const [register, membership] = await Promise.all([
      this.db.posRegister.findFirst({
        where: { id: registerId, organizationId: org, isActive: true },
      }),
      this.db.membership.findFirst({
        where: { organizationId: org, userId: assignedStaffId, user: { isActive: true } },
      }),
    ]);
    if (!register) throw new NotFoundException('Active register not found');
    const openShift = await this.db.posShift.findFirst({
      where: { registerId, organizationId: org, status: 'OPEN' },
      select: { id: true },
    });
    if (openShift)
      throw new BadRequestException('Close the open cashier shift before changing this register');
    if (!membership)
      throw new BadRequestException('Select an active staff member for this register');
    await this.requireBranch(org, branchId);
    return this.db.posRegister.update({
      where: { id: register.id },
      data: { assignedStaffId, branchId },
      include: {
        warehouse: true,
        assignedStaff: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });
  }
  async handoverRegister(
    org: string,
    actorId: string,
    registerId: string,
    data: { assignedStaffId: string; branchId: string; closingCash: number; notes?: string },
  ) {
    const [register, membership, openShift] = await Promise.all([
      this.db.posRegister.findFirst({
        where: { id: registerId, organizationId: org, isActive: true },
      }),
      this.db.membership.findFirst({
        where: { organizationId: org, userId: data.assignedStaffId, user: { isActive: true } },
      }),
      this.db.posShift.findFirst({
        where: { registerId, organizationId: org, status: 'OPEN' },
      }),
    ]);
    if (!register) throw new NotFoundException('Active register not found');
    if (!membership)
      throw new BadRequestException('Select an active staff member for this register');
    await this.requireBranch(org, data.branchId);

    let expectedCash = new Prisma.Decimal(0);
    if (openShift) {
      const [cash, change, returned] = await Promise.all([
        this.db.posPayment.aggregate({
          where: { method: 'CASH', sale: { shiftId: openShift.id, status: 'COMPLETED' } },
          _sum: { amount: true },
        }),
        this.db.posSale.aggregate({
          where: { shiftId: openShift.id, status: 'COMPLETED' },
          _sum: { changeAmount: true },
        }),
        this.db.posReturn.aggregate({
          where: { organizationId: org, sale: { shiftId: openShift.id, status: 'COMPLETED' } },
          _sum: { amount: true },
        }),
      ]);
      expectedCash = new Prisma.Decimal(openShift.openingCash)
        .add(cash._sum.amount ?? 0)
        .sub(change._sum.changeAmount ?? 0)
        .sub(returned._sum.amount ?? 0);
    }

    return this.db.$transaction(async (tx) => {
      if (openShift) {
        await tx.posShift.update({
          where: { id: openShift.id },
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
      const updated = await tx.posRegister.update({
        where: { id: register.id },
        data: { assignedStaffId: data.assignedStaffId, branchId: data.branchId },
        include: {
          warehouse: true,
          assignedStaff: { select: { id: true, email: true, firstName: true, lastName: true } },
          shifts: {
            where: { status: 'OPEN' },
            include: {
              cashier: { select: { id: true, email: true, firstName: true, lastName: true } },
            },
            take: 1,
          },
        },
      });
      await tx.posAuditLog.create({
        data: {
          organizationId: org,
          actorId,
          action: 'REGISTER_HANDED_OVER',
          entityType: 'PosRegister',
          entityId: register.id,
          metadata: {
            previousCashierId: openShift?.cashierId ?? null,
            assignedStaffId: data.assignedStaffId,
            branchId: data.branchId,
            shiftId: openShift?.id ?? null,
            closingCash: data.closingCash,
            expectedCash: expectedCash.toString(),
            notes: data.notes,
          },
        },
      });
      return updated;
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
    if (!(await this.canUseRegister(org, cashierId, register)))
      throw new BadRequestException('This register is not assigned to your branch');
    const existing = await this.db.posShift.findFirst({
      where: { registerId: register.id, status: 'OPEN' },
    });
    if (existing) throw new BadRequestException('This register already has an open shift');
    return this.db.$transaction(async (tx) => {
      const shift = await tx.posShift.create({
        data: {
          organizationId: org,
          registerId: register.id,
          cashierId,
          openingCash: data.openingCash,
        },
        include: { register: { select: { id: true, code: true, name: true } } },
      });
      await tx.posAuditLog.create({
        data: {
          organizationId: org,
          actorId: cashierId,
          action: 'SHIFT_OPENED',
          entityType: 'PosShift',
          entityId: shift.id,
          metadata: { registerId: register.id, openingCash: data.openingCash },
        },
      });
      return shift;
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
    const [cash, change, returned] = await Promise.all([
      this.db.posPayment.aggregate({
        where: { method: 'CASH', sale: { shiftId: id, status: 'COMPLETED' } },
        _sum: { amount: true },
      }),
      this.db.posSale.aggregate({
        where: { shiftId: id, status: 'COMPLETED' },
        _sum: { changeAmount: true },
      }),
      this.db.posReturn.aggregate({
        where: { organizationId: org, sale: { shiftId: id, status: 'COMPLETED' } },
        _sum: { amount: true },
      }),
    ]);
    const expectedCash = new Prisma.Decimal(shift.openingCash)
      .add(cash._sum.amount ?? 0)
      .sub(change._sum.changeAmount ?? 0)
      .sub(returned._sum.amount ?? 0);
    return this.db.$transaction(async (tx) => {
      const closedAt = new Date();
      const result = await tx.posShift.update({
        where: { id },
        data: {
          status: 'CLOSED',
          closingCash: data.closingCash,
          expectedCash,
          variance: new Prisma.Decimal(data.closingCash).sub(expectedCash),
          closeNotes: data.notes,
          closedAt,
        },
        include: { register: { select: { id: true, code: true, name: true } } },
      });
      await tx.posAuditLog.create({
        data: {
          organizationId: org,
          actorId: cashierId,
          action: 'SHIFT_CLOSED',
          entityType: 'PosShift',
          entityId: id,
          metadata: {
            registerId: shift.registerId,
            openingCash: shift.openingCash.toString(),
            closingCash: data.closingCash,
            expectedCash: expectedCash.toString(),
            variance: result.variance?.toString(),
            notes: data.notes,
          },
        },
      });
      return result;
    });
  }
  async complete(
    org: string,
    cashierId: string,
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
      let shift = await tx.posShift.findFirst({
        where: { organizationId: org, registerId: data.registerId, cashierId, status: 'OPEN' },
        include: { register: { include: { warehouse: true } } },
      });
      if (!shift) {
        const register = await tx.posRegister.findFirst({
          where: { id: data.registerId, organizationId: org, isActive: true },
          include: { warehouse: true },
        });
        if (!register || !register.warehouse.isActive)
          throw new BadRequestException('Select an active register before completing a sale');
        if (!(await this.canUseRegister(org, cashierId, register)))
          throw new BadRequestException('This register is not assigned to your branch');
        const registerShift = await tx.posShift.findFirst({
          where: { registerId: register.id, status: 'OPEN' },
        });
        if (registerShift)
          throw new BadRequestException('This register is currently in use by another cashier');
        shift = await tx.posShift.create({
          data: {
            organizationId: org,
            registerId: register.id,
            cashierId,
            openingCash: 0,
          },
          include: { register: { include: { warehouse: true } } },
        });
        await tx.posAuditLog.create({
          data: {
            organizationId: org,
            actorId: cashierId,
            action: 'SHIFT_AUTO_OPENED',
            entityType: 'PosShift',
            entityId: shift.id,
            metadata: { registerId: register.id, openingCash: 0 },
          },
        });
      }
      if (!shift.register.isActive || !shift.register.warehouse.isActive)
        throw new BadRequestException('Select an active register before completing a sale');
      if (!(await this.canUseRegister(org, cashierId, shift.register)))
        throw new BadRequestException('This register is not assigned to your branch');
      const saleBranchId = shift.register.branchId ?? data.branchId;
      await assertBranch(this.db, org, saleBranchId);
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
        const calculated = calculatePosLine(product, line.quantity, line.discount || 0);
        const { base, discount, tax, total, unitDiscount } = calculated;
        subtotal = subtotal.add(base);
        discountTotal = discountTotal.add(discount);
        taxTotal = taxTotal.add(tax);
        return {
          product,
          quantity: calculated.quantity,
          unitDiscount,
          discount,
          total,
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
          branchId: saleBranchId,
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

  private asObject(value: Prisma.JsonValue | undefined): Prisma.JsonObject {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  private async decorateReceipt(org: string, sale: Record<string, unknown>) {
    const [organization, register, cashier] = await Promise.all([
      this.db.organization.findUnique({
        where: { id: org },
        select: { name: true, onboardingData: true },
      }),
      sale.registerId
        ? this.db.posRegister.findFirst({
            where: { id: String(sale.registerId), organizationId: org },
            select: { id: true, code: true, name: true },
          })
        : null,
      sale.cashierId
        ? this.db.user.findUnique({
            where: { id: String(sale.cashierId) },
            select: { email: true, firstName: true, lastName: true },
          })
        : null,
    ]);
    const root = this.asObject(organization?.onboardingData);
    const business = this.asObject(root.business as Prisma.JsonValue);
    const admin = this.asObject(root.admin as Prisma.JsonValue);
    const profile = this.asObject(admin.profile as Prisma.JsonValue);
    const hierarchy = this.asObject(admin.branches as Prisma.JsonValue);
    const branches = Array.isArray(hierarchy.items)
      ? (hierarchy.items as Array<Record<string, unknown>>)
      : [];
    const branch = branches.find((item) => item.id === sale.branchId);
    const token = String(sale.receiptToken || sale.id);
    const appUrl = (
      this.config?.get<string>('PUBLIC_APP_URL') || 'https://cephas-books.onrender.com'
    ).replace(/\/$/, '');
    return {
      ...sale,
      receipt: {
        organizationName: organization?.name || String(business.businessName || 'Cephas Books'),
        logoUrl: String(profile.logoUrl || business.logoUrl || ''),
        organizationPhone: String(profile.phone || business.phone || ''),
        organizationAddress: String(profile.address || business.address || ''),
        organizationWebsite: String(profile.website || business.website || ''),
        returnPolicy: String(
          profile.returnPolicy || 'Returns are subject to the business return policy.',
        ),
        branchName: String(branch?.name || ''),
        branchAddress: String(branch?.address || ''),
        branchPhone: String(branch?.phone || ''),
        register: register || null,
        cashier: cashier
          ? {
              name:
                [cashier.firstName, cashier.lastName].filter(Boolean).join(' ') || cashier.email,
              email: cashier.email,
            }
          : null,
        verificationCode: token.slice(0, 8).toUpperCase(),
        digitalUrl: `${appUrl}/receipt/${token}`,
      },
    };
  }

  private receiptEmailHtml(sale: Record<string, unknown>) {
    const receipt = sale.receipt as Record<string, unknown>;
    const items = (sale.items as Array<Record<string, unknown>>)
      .map(
        (item) =>
          `<tr><td>${this.escapeHtml(String(item.description))}</td><td>${this.escapeHtml(String(item.quantity))}</td><td>${this.escapeHtml(String(item.lineTotal))}</td></tr>`,
      )
      .join('');
    return `<h2>${this.escapeHtml(String(receipt.organizationName))}</h2><p>Receipt ${this.escapeHtml(String(sale.receiptNumber))}</p><p>${this.escapeHtml(String(receipt.branchName || ''))}</p><table><thead><tr><th>Item</th><th>Quantity</th><th>Total</th></tr></thead><tbody>${items}</tbody></table><p><strong>Total: ${this.escapeHtml(String(sale.currency))} ${this.escapeHtml(String(sale.total))}</strong></p><p><a href="${this.escapeHtml(String(receipt.digitalUrl))}">View digital receipt</a></p>`;
  }

  private escapeHtml(value: string) {
    return value.replace(
      /[&<>"']/g,
      (character) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ||
        character,
    );
  }

  private async requireBranch(org: string, branchId: string) {
    const branches = await this.branches(org, '', 'OWNER');
    if (!branches.some((branch) => branch.id === branchId))
      throw new BadRequestException('Select an active branch for this register');
  }

  private async requireRegisterAccounts(org: string, accountIds: Array<string | null | undefined>) {
    const ids = [...new Set(accountIds.filter((id): id is string => Boolean(id)))];
    if (!ids.length) return;
    const accounts = await this.db.bankAccount.findMany({
      where: { organizationId: org, id: { in: ids }, isActive: true },
      select: { id: true },
    });
    if (accounts.length !== ids.length)
      throw new BadRequestException('Select active bank accounts from this organization');
  }

  private async canUseRegister(
    org: string,
    staffId: string,
    register: { branchId?: string | null; assignedStaffId?: string | null },
  ) {
    if (!register.branchId) return register.assignedStaffId === staffId;
    const branches = await this.branches(org, staffId, 'MEMBER');
    return branches.some((branch) => branch.id === register.branchId);
  }
  async voidSale(org: string, actorId: string, role: string, saleId: string, reason: string) {
    return this.db.$transaction(async (tx) => {
      const accessibleBranches = role === 'OWNER' ? [] : await this.branches(org, actorId, role);
      const sale = await tx.posSale.findFirst({
        where: {
          id: saleId,
          organizationId: org,
          status: 'COMPLETED',
          ...(role === 'OWNER'
            ? {}
            : {
                OR: [
                  { cashierId: actorId },
                  { branchId: { in: accessibleBranches.map((branch) => String(branch.id)) } },
                ],
              }),
        },
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
    role: string,
    saleId: string,
    data: { productId: string; quantity: number; reason: string },
  ) {
    return this.db.$transaction(async (tx) => {
      const accessibleBranches = role === 'OWNER' ? [] : await this.branches(org, actorId, role);
      const sale = await tx.posSale.findFirst({
        where: {
          id: saleId,
          organizationId: org,
          status: 'COMPLETED',
          ...(role === 'OWNER'
            ? {}
            : {
                OR: [
                  { cashierId: actorId },
                  { branchId: { in: accessibleBranches.map((branch) => String(branch.id)) } },
                ],
              }),
        },
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
