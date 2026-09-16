import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Param, Post, Query } from '@nestjs/common';
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
import {
  InviteOrganizationUserDto,
  UpdateOrganizationDto,
  UpdateOrganizationSectionDto,
  UpdateOrganizationUserDto,
} from './dto/update-organization.dto.ts';
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
    return this.organizations.updateOrganization(user, dto);
  }

  @Get('admin') admin(@CurrentUser() user: AuthUser) {
    return this.organizations.admin(user.organizationId);
  }

  @Roles(Role.OWNER, Role.ADMIN) @Patch('admin/:section') updateSection(
    @CurrentUser() user: AuthUser,
    @Param('section') section: string,
    @Body() dto: UpdateOrganizationSectionDto,
  ) {
    return this.organizations.updateSection(user, section, dto.data);
  }

  @Roles(Role.OWNER, Role.ADMIN, Role.AUDITOR) @Get('users') users(@CurrentUser() user: AuthUser) {
    return this.organizations.users(user.organizationId);
  }

  @Roles(Role.OWNER, Role.ADMIN) @Post('users') inviteUser(
    @CurrentUser() user: AuthUser,
    @Body() dto: InviteOrganizationUserDto,
  ) {
    return this.organizations.inviteUser(user, dto);
  }

  @Roles(Role.OWNER, Role.ADMIN) @Patch('users/:id') updateUser(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateOrganizationUserDto,
  ) {
    return this.organizations.updateUser(user, id, dto);
  }

  @Roles(Role.OWNER, Role.ADMIN, Role.AUDITOR) @Get('audit-logs') auditLogs(
    @CurrentUser() user: AuthUser,
    @Query('search') search?: string,
  ) {
    return this.organizations.auditLogs(user.organizationId, search);
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
