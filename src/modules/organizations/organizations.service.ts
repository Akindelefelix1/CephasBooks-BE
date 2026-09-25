import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator.ts';
import type {
  InviteOrganizationUserDto,
  CustomRoleDto,
  UpdateOrganizationDto,
  UpdateOrganizationUserDto,
} from './dto/update-organization.dto.ts';
import { PrismaService } from '../../database/prisma.service.ts';
import { MailService } from '../mail/mail.service.ts';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { isISO4217CurrencyCode } from 'class-validator';

const STEP_ORDER = ['business', 'financial', 'structure', 'tax', 'team'] as const;
type StepName = (typeof STEP_ORDER)[number];

const COUNTRY_CODES: Record<string, string> = {
  Nigeria: 'NG',
  Ghana: 'GH',
  Kenya: 'KE',
  'South Africa': 'ZA',
};

const ROLE_PERMISSIONS = [
  'dashboard.view',
  'banking.view',
  'banking.manage',
  'sales.view',
  'sales.manage',
  'purchases.view',
  'purchases.manage',
  'accounting.view',
  'accounting.manage',
  'inventory.view',
  'inventory.manage',
  'reports.view',
  'reports.export',
  'approvals.review',
  'users.view',
  'users.manage',
  'settings.manage',
] as const;

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail?: MailService,
  ) {}

  async admin(organizationId: string) {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        baseCurrency: true,
        countryCode: true,
        onboardingData: true,
        updatedAt: true,
      },
    });
    const root = this.asObject(organization.onboardingData);
    return {
      organization: {
        id: organization.id,
        name: organization.name,
        baseCurrency: organization.baseCurrency,
        countryCode: organization.countryCode,
        updatedAt: organization.updatedAt,
      },
      settings: this.asObject(root.admin as Prisma.JsonValue),
    };
  }

  async updateOrganization(actor: AuthUser, dto: UpdateOrganizationDto) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.organization.findUniqueOrThrow({
        where: { id: actor.organizationId },
        select: { baseCurrency: true },
      });
      if (dto.baseCurrency && dto.baseCurrency !== current.baseCurrency)
        throw new BadRequestException(
          'Change the default currency through Currency management so exchange rates stay synchronized',
        );
      const organization = await tx.organization.update({
        where: { id: actor.organizationId },
        data: dto,
      });
      await this.recordActivity(
        tx,
        actor,
        'ORGANIZATION_UPDATED',
        'Organization',
        organization.id,
        'Organisation settings updated',
        'Core organisation details were updated.',
      );
      return organization;
    });
  }

  async updateSection(actor: AuthUser, section: string, data: Record<string, unknown>) {
    const allowed = [
      'profile',
      'branches',
      'currencies',
      'security',
      'integrations',
      'preferences',
    ];
    if (!allowed.includes(section))
      throw new BadRequestException('Unknown organisation settings section');
    await this.validateSection(actor.organizationId, section, data);
    return this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: actor.organizationId },
        select: { onboardingData: true },
      });
      const root = this.asObject(organization.onboardingData);
      const admin = this.asObject(root.admin as Prisma.JsonValue);
      const updated = await tx.organization.update({
        where: { id: actor.organizationId },
        data: {
          ...(section === 'currencies' && typeof data.defaultCurrency === 'string'
            ? { baseCurrency: data.defaultCurrency }
            : {}),
          onboardingData: {
            ...root,
            admin: { ...admin, [section]: data },
          } as Prisma.InputJsonObject,
        },
        select: { updatedAt: true },
      });
      const label = section.charAt(0).toUpperCase() + section.slice(1);
      await this.recordActivity(
        tx,
        actor,
        `${section.toUpperCase()}_UPDATED`,
        'OrganizationSettings',
        actor.organizationId,
        `${label} settings updated`,
        `${label} configuration was changed by ${actor.email}.`,
      );
      return { section, data, updatedAt: updated.updatedAt };
    });
  }

  users(organizationId: string) {
    return this.prisma.membership.findMany({
      where: { organizationId },
      select: {
        id: true,
        role: true,
        customRoleId: true,
        customRole: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            address: true,
            isActive: true,
            verifiedAt: true,
            mustChangePassword: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async inviteUser(actor: AuthUser, dto: InviteOrganizationUserDto) {
    const email = dto.email.trim().toLowerCase();
    if (dto.role === 'OWNER')
      throw new BadRequestException('Ownership cannot be assigned from user management');
    const existing = await this.prisma.user.findUnique({
      where: { email },
      include: { memberships: true },
    });
    if (existing?.memberships.some((item) => item.organizationId === actor.organizationId))
      throw new ConflictException('This user already belongs to the organisation');
    if (existing?.memberships.length)
      throw new ConflictException(
        'This email belongs to another organisation. Use a unique work email for this staff member.',
      );
    if (existing && (!existing.verifiedAt || !existing.isActive))
      throw new BadRequestException('The user account must be verified and active first');
    const customRole = dto.customRoleId
      ? await this.prisma.customRole.findFirst({
          where: { id: dto.customRoleId, organizationId: actor.organizationId },
        })
      : null;
    if (dto.customRoleId && !customRole) throw new BadRequestException('Custom role not found');
    const temporaryPassword = existing ? null : this.temporaryPassword();
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: actor.organizationId },
      select: { name: true },
    });
    const membership = await this.prisma.$transaction(async (tx) => {
      const user = existing
        ? await tx.user.update({
          where: { id: existing.id },
          data: {
            firstName: dto.firstName?.trim() || undefined,
            lastName: dto.lastName?.trim() || undefined,
            phone: dto.phone?.trim() || undefined,
            address: dto.address?.trim() || undefined,
          },
        })
        : await tx.user.create({
          data: {
            email,
            passwordHash: await argon2.hash(temporaryPassword!),
            firstName: dto.firstName?.trim() || null,
            lastName: dto.lastName?.trim() || null,
            phone: dto.phone?.trim() || null,
            address: dto.address?.trim() || null,
            verifiedAt: new Date(),
            mustChangePassword: true,
          },
        });
      const membership = await tx.membership.create({
        data: {
          userId: user.id,
          organizationId: actor.organizationId,
          role: customRole?.baseRole ?? dto.role,
          customRoleId: customRole?.id,
        },
        select: {
          id: true,
          role: true,
          customRoleId: true,
          customRole: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              phone: true,
              address: true,
              isActive: true,
              verifiedAt: true,
              mustChangePassword: true,
            },
          },
        },
      });
      await this.recordActivity(
        tx,
        actor,
        'USER_INVITED',
        'Membership',
        membership.id,
        'Team member invited',
        `${email} was invited as ${dto.role.toLowerCase()}.`,
      );
      return membership;
    });
    try {
      await this.mail?.send({
        to: email,
        subject: `You have been invited to ${organization.name} on Cephas Books`,
        html: `<main style="max-width:600px;margin:auto;padding:32px;font-family:Arial,sans-serif;color:#172033"><h1>Welcome to ${this.escapeHtml(organization.name)}</h1><p>${this.escapeHtml(dto.firstName || 'Hello')}, your staff access has been created.</p>${temporaryPassword ? `<p>Sign in with <strong>${this.escapeHtml(email)}</strong> and this temporary password:</p><p style="padding:16px;background:#f1f5f9;border-radius:8px;font-size:18px"><strong>${this.escapeHtml(temporaryPassword)}</strong></p><p>Change this password immediately after signing in.</p>` : '<p>Your existing Cephas Books account now has access to this organisation.</p>'}</main>`,
      });
    } catch {
      // Do not leave an inaccessible staff account behind when credential delivery fails.
      await this.prisma.$transaction(async (tx) => {
        await tx.auditLog.deleteMany({
          where: { organizationId: actor.organizationId, entityId: membership.id },
        });
        await tx.appNotification.deleteMany({
          where: { organizationId: actor.organizationId, relatedId: membership.id },
        });
        await tx.membership.delete({ where: { id: membership.id } });
        if (temporaryPassword) await tx.user.delete({ where: { id: membership.user.id } });
      });
      throw new ServiceUnavailableException(
        'The invitation email could not be delivered. No staff account was created; please try again.',
      );
    }
    return membership;
  }

  private temporaryPassword() {
    return `Cb!7${randomBytes(9).toString('base64url')}`;
  }

  private escapeHtml(value: string) {
    return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
  }

  async updateUser(actor: AuthUser, id: string, dto: UpdateOrganizationUserDto) {
    const membership = await this.prisma.membership.findFirst({
      where: { id, organizationId: actor.organizationId },
      include: { user: true },
    });
    if (!membership) throw new NotFoundException('Organisation user not found');
    if (membership.role === 'OWNER')
      throw new BadRequestException('The organisation owner access cannot be changed');
    if (dto.role === 'OWNER')
      throw new BadRequestException('Ownership cannot be assigned from user management');
    if (
      !dto.role &&
      !dto.customRoleId &&
      typeof dto.isActive !== 'boolean' &&
      dto.firstName === undefined &&
      dto.lastName === undefined &&
      dto.phone === undefined &&
      dto.address === undefined
    )
      throw new BadRequestException('Provide a role or account status to update');
    if (membership.userId === actor.sub && dto.isActive === false)
      throw new BadRequestException('You cannot deactivate your own account');
    if (dto.isActive === false) {
      const membershipCount = await this.prisma.membership.count({
        where: { userId: membership.userId },
      });
      if (membershipCount > 1)
        throw new BadRequestException(
          'This user belongs to more than one organisation and cannot be globally deactivated here',
        );
    }
    return this.prisma.$transaction(async (tx) => {
      let customRole = null;
      if (dto.customRoleId) {
        customRole = await tx.customRole.findFirst({
          where: { id: dto.customRoleId, organizationId: actor.organizationId },
        });
        if (!customRole) throw new BadRequestException('Custom role not found');
      }
      if (dto.role || customRole)
        await tx.membership.update({
          where: { id },
          data: {
            role: customRole?.baseRole ?? dto.role,
            customRoleId: customRole?.id ?? (dto.role ? null : undefined),
          },
        });
      if (
        dto.firstName !== undefined ||
        dto.lastName !== undefined ||
        dto.phone !== undefined ||
        dto.address !== undefined
      )
        await tx.user.update({
          where: { id: membership.userId },
          data: {
            firstName: dto.firstName !== undefined ? dto.firstName.trim() || null : undefined,
            lastName: dto.lastName !== undefined ? dto.lastName.trim() || null : undefined,
            phone: dto.phone !== undefined ? dto.phone.trim() || null : undefined,
            address: dto.address !== undefined ? dto.address.trim() || null : undefined,
          },
        });
      if (typeof dto.isActive === 'boolean')
        await tx.user.update({
          where: { id: membership.userId },
          data: { isActive: dto.isActive },
        });
      if (dto.isActive === false || dto.role || dto.customRoleId)
        await tx.session.updateMany({
          where: { userId: membership.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      await this.recordActivity(
        tx,
        actor,
        'USER_ACCESS_UPDATED',
        'Membership',
        id,
        'User access updated',
        `${membership.user.email} access or role was updated.`,
      );
      return tx.membership.findUniqueOrThrow({
        where: { id },
        select: {
          id: true,
          role: true,
          customRoleId: true,
          customRole: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              phone: true,
              address: true,
              isActive: true,
              verifiedAt: true,
            },
          },
        },
      });
    });
  }

  roles(organizationId: string) {
    return this.prisma.customRole.findMany({
      where: { organizationId },
      include: { _count: { select: { memberships: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async createRole(actor: AuthUser, dto: CustomRoleDto) {
    this.validateRole(dto);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.customRole.create({
        data: { ...dto, name: dto.name.trim(), organizationId: actor.organizationId },
      });
      await this.recordActivity(
        tx,
        actor,
        'CUSTOM_ROLE_CREATED',
        'CustomRole',
        created.id,
        'Access profile created',
        `${created.name} was created with ${dto.permissions.length} permissions.`,
      );
      return created;
    });
  }

  async updateRole(actor: AuthUser, id: string, dto: CustomRoleDto) {
    this.validateRole(dto);
    const role = await this.prisma.customRole.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!role) throw new NotFoundException('Custom role not found');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.customRole.update({
        where: { id },
        data: { ...dto, name: dto.name.trim() },
      });
      if (role.baseRole !== dto.baseRole) {
        const memberships = await tx.membership.findMany({
          where: { customRoleId: id },
          select: { userId: true },
        });
        await tx.membership.updateMany({
          where: { customRoleId: id },
          data: { role: dto.baseRole },
        });
        await tx.session.updateMany({
          where: { userId: { in: memberships.map((item) => item.userId) }, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.recordActivity(
        tx,
        actor,
        'CUSTOM_ROLE_UPDATED',
        'CustomRole',
        updated.id,
        'Access profile updated',
        `${updated.name} permissions or access boundary were updated.`,
      );
      return updated;
    });
  }

  async deleteRole(actor: AuthUser, id: string) {
    const role = await this.prisma.customRole.findFirst({
      where: { id, organizationId: actor.organizationId },
      include: { _count: { select: { memberships: true } } },
    });
    if (!role) throw new NotFoundException('Custom role not found');
    if (role._count.memberships > 0)
      throw new ConflictException('Reassign users before deleting this role');
    await this.prisma.$transaction(async (tx) => {
      await tx.customRole.delete({ where: { id } });
      await this.recordActivity(
        tx,
        actor,
        'CUSTOM_ROLE_DELETED',
        'CustomRole',
        id,
        'Access profile deleted',
        `${role.name} was deleted.`,
      );
    });
    return { deleted: true };
  }

  private validateRole(dto: CustomRoleDto) {
    if (!dto.name.trim()) throw new BadRequestException('Role name is required');
    if (dto.baseRole === 'OWNER')
      throw new BadRequestException('Custom roles cannot grant owner access');
    if (dto.permissions.some((permission) => !ROLE_PERMISSIONS.includes(permission as never)))
      throw new BadRequestException('Custom role contains an unsupported permission');
  }

  auditLogs(organizationId: string, search?: string) {
    return this.prisma.auditLog.findMany({
      where: {
        organizationId,
        ...(search
          ? {
              OR: [
                { action: { contains: search, mode: 'insensitive' as const } },
                { entityType: { contains: search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      include: { actor: { select: { email: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async locationActivity(organizationId: string, type: string, id: string, kind = 'transactions') {
    const allowedTypes = ['state', 'region', 'branch'];
    const allowedKinds = ['transactions', 'sales', 'customers', 'purchases', 'invoices'];
    if (!allowedTypes.includes(type)) throw new BadRequestException('Unknown location level');
    if (!allowedKinds.includes(kind)) throw new BadRequestException('Unknown activity type');

    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { onboardingData: true },
    });
    const root = this.asObject(organization.onboardingData);
    const admin = this.asObject(root.admin as Prisma.JsonValue);
    const hierarchy = this.asObject(admin.branches as Prisma.JsonValue);
    const states = Array.isArray(hierarchy.states)
      ? (hierarchy.states as Array<Record<string, unknown>>)
      : [];
    const regions = Array.isArray(hierarchy.regions)
      ? (hierarchy.regions as Array<Record<string, unknown>>)
      : [];
    const branches = Array.isArray(hierarchy.items)
      ? (hierarchy.items as Array<Record<string, unknown>>)
      : [];
    const exists =
      type === 'state'
        ? states.some((item) => item.id === id)
        : type === 'region'
          ? regions.some((item) => item.id === id)
          : branches.some((item) => item.id === id);
    if (!exists) throw new NotFoundException('Organisation location not found');
    const regionIds =
      type === 'state'
        ? regions.filter((item) => item.stateId === id).map((item) => String(item.id))
        : type === 'region'
          ? [id]
          : [];
    const branchIds =
      type === 'branch'
        ? [id]
        : branches
            .filter((item) => regionIds.includes(String(item.regionId)))
            .map((item) => String(item.id));
    const where = { organizationId, branchId: { in: branchIds } };
    let rows: Array<Record<string, unknown>> = [];
    if (kind === 'transactions') {
      const data = await this.prisma.bankTransaction.findMany({
        where,
        select: {
          id: true,
          description: true,
          amount: true,
          type: true,
          transactionDate: true,
          branchId: true,
        },
        orderBy: { transactionDate: 'desc' },
        take: 100,
      });
      rows = data.map((item) => ({
        ...item,
        amount: item.amount.toString(),
        date: item.transactionDate,
      }));
    } else if (kind === 'sales') {
      const data = await this.prisma.posSale.findMany({
        where,
        select: {
          id: true,
          receiptNumber: true,
          total: true,
          status: true,
          createdAt: true,
          branchId: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      rows = data.map((item) => ({
        ...item,
        label: item.receiptNumber,
        amount: item.total.toString(),
        date: item.createdAt,
      }));
    } else if (kind === 'customers') {
      const data = await this.prisma.customer.findMany({
        where,
        select: {
          id: true,
          displayName: true,
          companyName: true,
          email: true,
          isActive: true,
          createdAt: true,
          branchId: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      rows = data.map((item) => ({ ...item, label: item.displayName, date: item.createdAt }));
    } else if (kind === 'purchases') {
      const [orders, expenses] = await Promise.all([
        this.prisma.purchaseOrder.findMany({
          where,
          select: {
            id: true,
            number: true,
            total: true,
            status: true,
            orderDate: true,
            branchId: true,
          },
          orderBy: { orderDate: 'desc' },
          take: 50,
        }),
        this.prisma.expense.findMany({
          where,
          select: {
            id: true,
            reference: true,
            merchant: true,
            amount: true,
            status: true,
            expenseDate: true,
            branchId: true,
          },
          orderBy: { expenseDate: 'desc' },
          take: 50,
        }),
      ]);
      rows = [
        ...orders.map((item) => ({
          ...item,
          label: item.number,
          amount: item.total.toString(),
          date: item.orderDate,
          recordType: 'Purchase order',
        })),
        ...expenses.map((item) => ({
          ...item,
          label: item.reference,
          amount: item.amount.toString(),
          date: item.expenseDate,
          recordType: 'Expense',
        })),
      ]
        .sort((a, b) => new Date(String(b.date)).getTime() - new Date(String(a.date)).getTime())
        .slice(0, 100);
    } else {
      const data = await this.prisma.invoice.findMany({
        where,
        select: {
          id: true,
          number: true,
          total: true,
          status: true,
          issueDate: true,
          branchId: true,
        },
        orderBy: { issueDate: 'desc' },
        take: 100,
      });
      rows = data.map((item) => ({
        ...item,
        label: item.number,
        amount: item.total.toString(),
        date: item.issueDate,
      }));
    }
    return { kind, branchIds, total: rows.length, data: rows };
  }

  private async recordActivity(
    tx: Prisma.TransactionClient,
    actor: AuthUser,
    action: string,
    entityType: string,
    entityId: string,
    title: string,
    message: string,
  ) {
    await tx.auditLog.create({
      data: {
        organizationId: actor.organizationId,
        actorId: actor.sub,
        action,
        entityType,
        entityId,
        metadata: { email: actor.email },
      },
    });
    await tx.appNotification.create({
      data: {
        organizationId: actor.organizationId,
        title,
        message,
        category: 'SYSTEM',
        relatedType: entityType,
        relatedId: entityId,
      },
    });
  }

  private async validateSection(
    organizationId: string,
    section: string,
    data: Record<string, unknown>,
  ) {
    if (JSON.stringify(data).length > 100_000)
      throw new BadRequestException('Organisation settings payload is too large');
    const items = data.items;
    if (section === 'branches' || section === 'currencies' || section === 'integrations') {
      if (!Array.isArray(items)) throw new BadRequestException('Settings items must be an array');
      if (items.length > 100) throw new BadRequestException('A maximum of 100 items is supported');
    }
    if (section === 'currencies' && Array.isArray(items)) {
      const currencies = items.map((item) => item as Record<string, unknown>);
      const codes = currencies.map((item) => String(item.code || '').toUpperCase());
      if (!currencies.length) throw new BadRequestException('Select at least one currency');
      if (new Set(codes).size !== codes.length)
        throw new ConflictException('Each currency can only be selected once');
      if (codes.some((code) => !isISO4217CurrencyCode(code)))
        throw new BadRequestException('Currency codes must be valid ISO 4217 codes');
      if (
        currencies.some((item) => {
          const rate = Number(item.rate);
          return !Number.isFinite(rate) || rate <= 0;
        })
      )
        throw new BadRequestException('Every currency must have a positive exchange rate');
      const defaultCurrency = String(data.defaultCurrency || '').toUpperCase();
      const selectedDefault = currencies.find((item) => String(item.code).toUpperCase() === defaultCurrency);
      if (!selectedDefault || selectedDefault.active === false)
        throw new BadRequestException('The default currency must be selected and active');
      if (Number(selectedDefault.rate) !== 1)
        throw new BadRequestException('The default currency exchange rate must be 1');
    }
    if (section === 'branches' && Array.isArray(items)) {
      const branches = items.map((item) => item as Record<string, unknown>);
      const states = Array.isArray(data.states)
        ? data.states.map((item) => item as Record<string, unknown>)
        : [];
      const regions = Array.isArray(data.regions)
        ? data.regions.map((item) => item as Record<string, unknown>)
        : [];
      if (states.length > 100 || regions.length > 500)
        throw new BadRequestException('Organisation hierarchy is too large');
      const validId = (value: unknown) =>
        typeof value === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
      const stateIds = states.map((item) => item.id);
      const regionIds = regions.map((item) => item.id);
      const hierarchical = states.length > 0 || regions.length > 0;
      if (hierarchical) {
        if (
          states.some(
            (item) => !validId(item.id) || typeof item.name !== 'string' || !item.name.trim(),
          )
        )
          throw new BadRequestException('Every state requires a valid id and name');
        if (new Set(stateIds).size !== stateIds.length)
          throw new ConflictException('State ids must be unique');
        const stateNames = states.map((item) => String(item.name).trim().toLowerCase());
        if (new Set(stateNames).size !== stateNames.length)
          throw new ConflictException('State names must be unique');
        if (
          regions.some(
            (item) =>
              !validId(item.id) ||
              !stateIds.includes(item.stateId) ||
              typeof item.name !== 'string' ||
              !item.name.trim(),
          )
        )
          throw new BadRequestException('Every region requires a valid state and name');
        if (new Set(regionIds).size !== regionIds.length)
          throw new ConflictException('Region ids must be unique');
        const regionKeys = regions.map(
          (item) => `${String(item.stateId)}:${String(item.name).trim().toLowerCase()}`,
        );
        if (new Set(regionKeys).size !== regionKeys.length)
          throw new ConflictException('Region names must be unique within a state');
        if (branches.some((item) => !validId(item.id) || !regionIds.includes(item.regionId)))
          throw new BadRequestException('Every branch requires a valid region');
      }
      const names = branches.map((item) => (typeof item.name === 'string' ? item.name.trim() : ''));
      if (names.some((name) => !name))
        throw new BadRequestException('Every branch requires a name');
      if (branches.some((item) => typeof item.address !== 'string' || !item.address.trim()))
        throw new BadRequestException('Every branch requires an address');
      if (
        branches.some(
          (item) =>
            item.status !== undefined &&
            (typeof item.status !== 'string' || !['Active', 'Inactive'].includes(item.status)),
        )
      )
        throw new BadRequestException('Branch status must be Active or Inactive');
      if (new Set(names.map((name) => name.toLowerCase())).size !== names.length)
        throw new ConflictException('Branch names must be unique');
      const managerIds: unknown[] = [];
      for (const item of [...states, ...regions, ...branches]) {
        if (Array.isArray(item.managerIds)) {
          for (const managerId of item.managerIds as unknown[]) managerIds.push(managerId);
        }
      }
      if (
        [...states, ...regions, ...branches].some(
          (item) => item.managerIds !== undefined && !Array.isArray(item.managerIds),
        )
      )
        throw new BadRequestException('Manager assignments must be an array');
      if (managerIds.some((id) => !validId(id)))
        throw new BadRequestException('Manager assignments contain an invalid id');
      if (managerIds.length) {
        const validManagers = await this.prisma.membership.count({
          where: {
            organizationId,
            id: { in: [...new Set(managerIds as string[])] },
            user: { isActive: true },
          },
        });
        if (validManagers !== new Set(managerIds).size)
          throw new BadRequestException('Managers must be active members of this organisation');
      }
    }
    if (section === 'currencies' && Array.isArray(items)) {
      const currencies = items.map((item) => item as Record<string, unknown>);
      const codes = currencies.map((item) =>
        typeof item.code === 'string' ? item.code.toUpperCase() : '',
      );
      if (codes.some((code) => !/^[A-Z]{3}$/.test(code)))
        throw new BadRequestException('Every currency requires a valid three-letter code');
      if (new Set(codes).size !== codes.length)
        throw new ConflictException('Currency codes must be unique');
      if (
        currencies.some((item) => {
          const rate = Number(item.rate);
          return (
            typeof item.name !== 'string' ||
            !item.name.trim() ||
            !Number.isFinite(rate) ||
            rate <= 0
          );
        })
      )
        throw new BadRequestException('Every currency requires a name and positive exchange rate');
    }
    if (section === 'security') {
      if (Object.values(data).some((value) => typeof value !== 'boolean'))
        throw new BadRequestException('Security control values must be true or false');
    }
    if (section === 'integrations' && Array.isArray(items)) {
      if (
        items.some((item) => {
          const entry = item as Record<string, unknown>;
          return (
            typeof entry.id !== 'string' || !entry.id.trim() || typeof entry.connected !== 'boolean'
          );
        })
      )
        throw new BadRequestException('Every integration requires an id and connection state');
    }
  }

  async getOnboarding(organizationId: string) {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: {
        name: true,
        onboardingData: true,
        onboardingStep: true,
        onboardingCompletedAt: true,
      },
    });
    return {
      organizationName: organization.name,
      onboardingData: organization.onboardingData,
      onboardingStep: organization.onboardingStep,
      onboardingCompletedAt: organization.onboardingCompletedAt,
    };
  }

  async saveOnboardingStep(organizationId: string, step: StepName, payload: object) {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { onboardingData: true, onboardingStep: true },
    });
    const current = this.asObject(organization.onboardingData);
    const values = payload as Record<string, unknown>;
    const stepIndex = STEP_ORDER.indexOf(step);
    const data: Prisma.OrganizationUpdateInput = {
      onboardingData: { ...current, [step]: values } as Prisma.InputJsonObject,
      onboardingStep: Math.max(organization.onboardingStep, stepIndex + 1),
    };

    if (step === 'business' && typeof values.businessName === 'string') {
      data.name = values.businessName.trim();
    }
    if (step === 'financial' && typeof values.baseCurrency === 'string') {
      data.baseCurrency = values.baseCurrency.toUpperCase();
    }
    if (step === 'tax' && typeof values.taxCountry === 'string') {
      data.countryCode = COUNTRY_CODES[values.taxCountry];
    }

    return this.prisma.organization.update({
      where: { id: organizationId },
      data,
      select: { onboardingData: true, onboardingStep: true, onboardingCompletedAt: true },
    });
  }

  async completeOnboarding(organizationId: string) {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { onboardingData: true },
    });
    const onboarding = this.asObject(organization.onboardingData);
    const missing = STEP_ORDER.filter((step) => !(step in onboarding));
    if (missing.length) {
      throw new BadRequestException(`Complete all onboarding steps first: ${missing.join(', ')}`);
    }
    return this.prisma.organization.update({
      where: { id: organizationId },
      data: { onboardingStep: STEP_ORDER.length, onboardingCompletedAt: new Date() },
      select: { onboardingData: true, onboardingStep: true, onboardingCompletedAt: true },
    });
  }

  private asObject(value: Prisma.JsonValue): Prisma.JsonObject {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }
}
