import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.ts';
import { CreateCustomerDto } from './dto/create-customer.dto.ts';
import { UpdateCustomerDto } from './dto/update-customer.dto.ts';
import { assertBranch } from '../../common/branch-scope.ts';

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
  async create(organizationId: string, dto: CreateCustomerDto) {
    await assertBranch(this.prisma, organizationId, dto.branchId);
    return this.prisma.customer.create({ data: { ...dto, organizationId } });
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
      include: { customer: true, items: true },
      orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
  }
  async update(organizationId: string, id: string, dto: UpdateCustomerDto) {
    await this.get(organizationId, id);
    return this.prisma.customer.update({ where: { id }, data: dto });
  }
  async archive(organizationId: string, id: string) {
    await this.get(organizationId, id);
    return this.prisma.customer.update({ where: { id }, data: { isActive: false } });
  }
}
