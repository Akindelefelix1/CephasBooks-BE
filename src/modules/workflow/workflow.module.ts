import { Module } from '@nestjs/common';
import { WorkflowController } from './workflow.controller.ts';
import { WorkflowService } from './workflow.service.ts';
@Module({
  controllers: [WorkflowController],
  providers: [WorkflowService],
  exports: [WorkflowService],
})
export class WorkflowModule {}
