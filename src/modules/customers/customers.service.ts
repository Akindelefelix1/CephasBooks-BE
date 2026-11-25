import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.ts';
import { CreateCustomerDto } from './dto/create-customer.dto.ts';
import { UpdateCustomerDto } from './dto/update-customer.dto.ts';
import { assertBranch } from '../../common/branch-scope.ts';
import { customerCreditExposure, lockCustomerCredit } from './customer-credit.ts';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}
  list(organizationId: string, page: number, limit: number, search?: string) {
    const where = {
      organizationId,
      ...(search ? { displayName: { contains: search, mode: 'insensitive' as const } } : {}),
    };
    return this.prisma
      .$transaction([
        this.prisma.customer.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.customer.count({ where }),
      ])
      .then(([data, total]) => ({
        data,
        meta: { page, limit, total, pages: Math.ceil(total / limit) },
      }));
  }
  async create(organizationId: string, actorId: string, dto: CreateCustomerDto) {
    await assertBranch(this.prisma, organizationId, dto.branchId);
    const { creditLimitReason, ...customerData } = dto;
    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({ data: { ...customerData, organizationId } });
      if (customer.creditLimit.gt(0))
        await tx.customerCreditLimitAdjustment.create({
          data: {
            organizationId,
            customerId: customer.id,
            actorId,
            previousLimit: 0,
            newLimit: customer.creditLimit,
            reason: creditLimitReason?.trim() || 'Initial credit limit assigned when customer was created.',
          },
        });
      return customer;
    });
  }
  async get(organizationId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({ where: { id, organizationId } });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }
  async purchaseHistory(organizationId: string, id: string) {
    await this.get(organizationId, id);
    return this.prisma.invoice.findMany({
      where: { organizationId, customerId: id },
      include: { customer: true, items: true, payments: true, creditNotes: true },
      orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
    });
  }
  async creditStatus(organizationId: string, id: string) {
    const customer = await this.get(organizationId, id);
    const [exposure, organization] = await Promise.all([
      customerCreditExposure(this.prisma, organizationId, id),
      this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { baseCurrency: true } }),
    ]);
    const limit = new Prisma.Decimal(customer.creditLimit);
    const available = Prisma.Decimal.max(new Prisma.Decimal(0), limit.sub(exposure));
    return {
      customerId: id,
      creditLimit: limit.toString(),
      outstandingBalance: exposure.toString(),
      availableCredit: available.toString(),
      currency: organization.baseCurrency,
      usagePercent: limit.gt(0) ? Number(exposure.div(limit).mul(100).toFixed(2)) : 0,
      nearLimit: limit.gt(0) && exposure.gte(limit.mul(0.8)),
      exceeded: exposure.gt(limit),
    };
  }
  async creditLimitHistory(organizationId: string, id: string) {
    await this.get(organizationId, id);
    return this.prisma.customerCreditLimitAdjustment.findMany({
      where: { organizationId, customerId: id },
      include: { actor: { select: { firstName: true, lastName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }
  async creditOverrideHistory(organizationId: string, id: string) {
    await this.get(organizationId, id);
    return this.prisma.customerCreditOverrideApproval.findMany({
      where: { organizationId, customerId: id },
      include: { approver: { select: { firstName: true, lastName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }
  async posCreditPaymentHistory(organizationId: string, id: string) {
    await this.get(organizationId, id);
    return this.prisma.posCreditPayment.findMany({
      where: { organizationId, customerId: id },
      include: {
        sale: { select: { id: true, receiptNumber: true } },
        receivedBy: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }],
    });
  }
  async update(organizationId: string, id: string, actorId: string, dto: UpdateCustomerDto) {
    const { creditLimitReason, creditLimit, ...customerData } = dto;
    return this.prisma.$transaction(async (tx) => {
      if (creditLimit !== undefined) await lockCustomerCredit(tx, organizationId, id);
      const current = await tx.customer.findFirst({ where: { id, organizationId } });
      if (!current) throw new NotFoundException('Customer not found');
      const limitChanged = creditLimit !== undefined &&
        !new Prisma.Decimal(creditLimit).equals(current.creditLimit);
      if (limitChanged && !creditLimitReason?.trim())
        throw new BadRequestException('A reason is required when adjusting the customer credit limit');
      const updated = await tx.customer.update({
        where: { id },
        data: { ...customerData, ...(limitChanged ? { creditLimit } : {}) },
      });
      if (limitChanged)
        await tx.customerCreditLimitAdjustment.create({
          data: {
            organizationId,
            customerId: id,
            actorId,
            previousLimit: current.creditLimit,
            newLimit: new Prisma.Decimal(creditLimit!),
            reason: creditLimitReason!.trim(),
          },
        });
      return updated;
    });
  }
  async archive(organizationId: string, id: string) {
    await this.get(organizationId, id);
    return this.prisma.customer.update({ where: { id }, data: { isActive: false } });
  }
}
