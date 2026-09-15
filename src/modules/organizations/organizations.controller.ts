import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.ts';
import { Roles } from '../../common/decorators/roles.decorator.ts';
import { RolesGuard } from '../../common/guards/roles.guard.ts';
import { PrismaService } from '../../database/prisma.service.ts';
import {
  BusinessProfileDto,
  FinancialSettingsDto,
  OrganizationStructureDto,
  TaxSetupDto,
  TeamSetupDto,
} from './dto/onboarding.dto.ts';
import { UpdateOrganizationDto } from './dto/update-organization.dto.ts';
import { OrganizationsService } from './organizations.service.ts';

@ApiTags('Organizations')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('organizations/current')
export class OrganizationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizations: OrganizationsService,
  ) {}
  @Get() get(@CurrentUser() user: AuthUser) {
    return this.prisma.organization.findUniqueOrThrow({ where: { id: user.organizationId } });
  }
  @Roles(Role.OWNER, Role.ADMIN) @Patch() update(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateOrganizationDto,
  ) {
    return this.prisma.organization.update({ where: { id: user.organizationId }, data: dto });
  }

  @Get('onboarding')
  getOnboarding(@CurrentUser() user: AuthUser) {
    return this.organizations.getOnboarding(user.organizationId);
  }

  @Roles(Role.OWNER, Role.ADMIN)
  @Patch('onboarding/business')
  saveBusiness(@CurrentUser() user: AuthUser, @Body() dto: BusinessProfileDto) {
    return this.organizations.saveOnboardingStep(user.organizationId, 'business', dto);
  }

  @Roles(Role.OWNER, Role.ADMIN)
  @Patch('onboarding/financial')
  saveFinancial(@CurrentUser() user: AuthUser, @Body() dto: FinancialSettingsDto) {
    return this.organizations.saveOnboardingStep(user.organizationId, 'financial', dto);
  }

  @Roles(Role.OWNER, Role.ADMIN)
  @Patch('onboarding/structure')
  saveStructure(@CurrentUser() user: AuthUser, @Body() dto: OrganizationStructureDto) {
    return this.organizations.saveOnboardingStep(user.organizationId, 'structure', dto);
  }

  @Roles(Role.OWNER, Role.ADMIN)
  @Patch('onboarding/tax')
  saveTax(@CurrentUser() user: AuthUser, @Body() dto: TaxSetupDto) {
    return this.organizations.saveOnboardingStep(user.organizationId, 'tax', dto);
  }

  @Roles(Role.OWNER, Role.ADMIN)
  @Patch('onboarding/team')
  saveTeam(@CurrentUser() user: AuthUser, @Body() dto: TeamSetupDto) {
    return this.organizations.saveOnboardingStep(user.organizationId, 'team', dto);
  }

  @Roles(Role.OWNER, Role.ADMIN)
  @Patch('onboarding/complete')
  completeOnboarding(@CurrentUser() user: AuthUser) {
    return this.organizations.completeOnboarding(user.organizationId);
  }
}
