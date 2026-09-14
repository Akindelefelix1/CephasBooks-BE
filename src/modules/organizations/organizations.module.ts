import { Module } from '@nestjs/common';
import { RolesGuard } from '../../common/guards/roles.guard';
import { OrganizationsController } from './organizations.controller';
@Module({ controllers: [OrganizationsController], providers: [RolesGuard] })
export class OrganizationsModule {}
