import { Module } from '@nestjs/common';
import { RolesGuard } from '../../common/guards/roles.guard.ts';
import { OrganizationsController } from './organizations.controller.ts';
@Module({ controllers: [OrganizationsController], providers: [RolesGuard] })
export class OrganizationsModule {}
