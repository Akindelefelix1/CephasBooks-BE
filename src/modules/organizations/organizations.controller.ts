import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PrismaService } from '../../database/prisma.service';
import { UpdateOrganizationDto } from './dto/update-organization.dto';

@ApiTags('Organizations') @ApiBearerAuth() @UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('organizations/current')
export class OrganizationsController {
  constructor(private readonly prisma: PrismaService) {}
  @Get() get(@CurrentUser() user: AuthUser) { return this.prisma.organization.findUniqueOrThrow({ where: { id: user.organizationId } }); }
  @Roles(Role.OWNER, Role.ADMIN) @Patch() update(@CurrentUser() user: AuthUser, @Body() dto: UpdateOrganizationDto) {
    return this.prisma.organization.update({ where: { id: user.organizationId }, data: dto });
  }
}
