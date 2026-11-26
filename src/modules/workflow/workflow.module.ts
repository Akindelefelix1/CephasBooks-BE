import { Module } from '@nestjs/common';
import { WorkflowController } from './workflow.controller.ts';
import { WorkflowService } from './workflow.service.ts';
import { DueDateNotificationsService } from './due-date-notifications.service.ts';
import { PushSubscriptionsService } from './push-subscriptions.service.ts';
@Module({
  controllers: [WorkflowController],
  providers: [WorkflowService, DueDateNotificationsService, PushSubscriptionsService],
  exports: [WorkflowService, DueDateNotificationsService, PushSubscriptionsService],
})
export class WorkflowModule {}
