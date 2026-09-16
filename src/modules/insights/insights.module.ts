import { Module } from '@nestjs/common';
import { InsightsController } from './insights.controller.ts';
import { InsightsService } from './insights.service.ts';

@Module({ controllers: [InsightsController], providers: [InsightsService] })
export class InsightsModule {}
