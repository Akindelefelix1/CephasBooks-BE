import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller.ts';
import { InvoicesService } from './invoices.service.ts';
import { RolesGuard } from '../../common/guards/roles.guard.ts';
import { WorkflowModule } from '../workflow/workflow.module.ts';
@Module({
  imports: [WorkflowModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, RolesGuard],
})
export class InvoicesModule {}
