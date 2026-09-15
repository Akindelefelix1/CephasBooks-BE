import { Module } from '@nestjs/common';
import { BankingController } from './banking.controller.ts';
import { BankingService } from './banking.service.ts';
import { RolesGuard } from '../../common/guards/roles.guard.ts';
@Module({ controllers: [BankingController], providers: [BankingService, RolesGuard] })
export class BankingModule {}
