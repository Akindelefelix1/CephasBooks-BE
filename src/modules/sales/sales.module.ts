import { Module } from '@nestjs/common';
import { RolesGuard } from '../../common/guards/roles.guard.ts';
import { SalesController } from './sales.controller.ts';
import { SalesService } from './sales.service.ts';
@Module({ controllers: [SalesController], providers: [SalesService, RolesGuard] })
export class SalesModule {}
