import { Module } from '@nestjs/common';
import { RolesGuard } from '../../common/guards/roles.guard.ts';
import { OrganizationsController } from './organizations.controller.ts';
import { OrganizationsService } from './organizations.service.ts';
@Module({ controllers: [OrganizationsController], providers: [RolesGuard, OrganizationsService] })
export class OrganizationsModule {}
