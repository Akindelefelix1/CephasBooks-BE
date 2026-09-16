import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../../common/decorators/current-user.decorator.ts';
import type {
  InviteOrganizationUserDto,
  UpdateOrganizationDto,
  UpdateOrganizationUserDto,
} from './dto/update-organization.dto.ts';
import { PrismaService } from '../../database/prisma.service.ts';

const STEP_ORDER = ['business', 'financial', 'structure', 'tax', 'team'] as const;
type StepName = (typeof STEP_ORDER)[number];

const COUNTRY_CODES: Record<string, string> = {
  Nigeria: 'NG',
  Ghana: 'GH',
  Kenya: 'KE',
  'South Africa': 'ZA',
};

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

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
    this.validateSection(section, data);
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
        createdAt: true,
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            isActive: true,
            verifiedAt: true,
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
      include: { memberships: { where: { organizationId: actor.organizationId } } },
    });
    if (existing?.memberships.length)
      throw new ConflictException('This user already belongs to the organisation');
    if (!existing)
      throw new BadRequestException(
        'No Cephas Books account exists for this email. Ask the user to register first.',
      );
    if (!existing.verifiedAt || !existing.isActive)
      throw new BadRequestException('The user account must be verified and active first');
    return this.prisma.$transaction(async (tx) => {
      const membership = await tx.membership.create({
        data: {
          userId: existing.id,
          organizationId: actor.organizationId,
          role: dto.role,
        },
        select: {
          id: true,
          role: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              isActive: true,
              verifiedAt: true,
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
    if (!dto.role && typeof dto.isActive !== 'boolean')
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
      if (dto.role) await tx.membership.update({ where: { id }, data: { role: dto.role } });
      if (typeof dto.isActive === 'boolean')
        await tx.user.update({
          where: { id: membership.userId },
          data: { isActive: dto.isActive },
        });
      if (dto.isActive === false)
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
          createdAt: true,
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              isActive: true,
              verifiedAt: true,
            },
          },
        },
      });
    });
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

  private validateSection(section: string, data: Record<string, unknown>) {
    if (JSON.stringify(data).length > 100_000)
      throw new BadRequestException('Organisation settings payload is too large');
    const items = data.items;
    if (section === 'branches' || section === 'currencies' || section === 'integrations') {
      if (!Array.isArray(items)) throw new BadRequestException('Settings items must be an array');
      if (items.length > 100) throw new BadRequestException('A maximum of 100 items is supported');
    }
    if (section === 'branches' && Array.isArray(items)) {
      const branches = items.map((item) => item as Record<string, unknown>);
      const names = branches.map((item) => (typeof item.name === 'string' ? item.name.trim() : ''));
      if (names.some((name) => !name))
        throw new BadRequestException('Every branch requires a name');
      if (branches.some((item) => typeof item.address !== 'string' || !item.address.trim()))
        throw new BadRequestException('Every branch requires an address');
      if (new Set(names.map((name) => name.toLowerCase())).size !== names.length)
        throw new ConflictException('Branch names must be unique');
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
