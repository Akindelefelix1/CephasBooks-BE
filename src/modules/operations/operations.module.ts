import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller.ts';
import { OperationsService } from './operations.service.ts';

@Module({ controllers: [OperationsController], providers: [OperationsService] })
export class OperationsModule {}
