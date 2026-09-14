import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller.ts';
import { InvoicesService } from './invoices.service.ts';
@Module({ controllers: [InvoicesController], providers: [InvoicesService] })
export class InvoicesModule {}
