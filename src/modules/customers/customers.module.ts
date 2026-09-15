import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller.ts';
import { CustomersService } from './customers.service.ts';
import { RolesGuard } from '../../common/guards/roles.guard.ts';
@Module({ controllers: [CustomersController], providers: [CustomersService, RolesGuard] })
export class CustomersModule {}
