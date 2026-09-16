import { Module } from '@nestjs/common';
import { RolesGuard } from '../../common/guards/roles.guard.ts';
import { PurchasesController } from './purchases.controller.ts';
import { PurchasesService } from './purchases.service.ts';
import { WorkflowModule } from '../workflow/workflow.module.ts';
@Module({
  imports: [WorkflowModule],
  controllers: [PurchasesController],
  providers: [PurchasesService, RolesGuard],
})
export class PurchasesModule {}
