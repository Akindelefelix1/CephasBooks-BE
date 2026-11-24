import { Module } from '@nestjs/common';
import { RolesGuard } from '../../common/guards/roles.guard.ts';
import { SalesController } from './sales.controller.ts';
import { SalesService } from './sales.service.ts';
import { MailModule } from '../mail/mail.module.ts';
@Module({ imports: [MailModule], controllers: [SalesController], providers: [SalesService, RolesGuard] })
export class SalesModule {}
