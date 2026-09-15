import { Module } from '@nestjs/common';
import { RolesGuard } from '../../common/guards/roles.guard.ts';
import { AccountingController } from './accounting.controller.ts';
import { AccountingService } from './accounting.service.ts';
@Module({ controllers: [AccountingController], providers: [AccountingService, RolesGuard] })
export class AccountingModule {}
