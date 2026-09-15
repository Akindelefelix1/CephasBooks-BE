import { Module } from '@nestjs/common';
import { RolesGuard } from '../../common/guards/roles.guard.ts';
import { PurchasesController } from './purchases.controller.ts';
import { PurchasesService } from './purchases.service.ts';
@Module({ controllers: [PurchasesController], providers: [PurchasesService, RolesGuard] })
export class PurchasesModule {}
