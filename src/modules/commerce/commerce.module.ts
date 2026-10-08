import { Module } from '@nestjs/common';
import { CommerceController } from './commerce.controller.ts';
import { CommerceService } from './commerce.service.ts';

@Module({ controllers: [CommerceController], providers: [CommerceService] })
export class CommerceModule {}
