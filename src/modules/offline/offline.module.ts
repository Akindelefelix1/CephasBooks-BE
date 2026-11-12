import { Module } from '@nestjs/common';
import { OfflineController } from './offline.controller.ts';
import { OfflineService } from './offline.service.ts';

@Module({ controllers: [OfflineController], providers: [OfflineService] })
export class OfflineModule {}
