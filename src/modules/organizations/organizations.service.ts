import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

  getOnboarding(organizationId: string) {
    return this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { onboardingData: true, onboardingStep: true, onboardingCompletedAt: true },
    });
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
