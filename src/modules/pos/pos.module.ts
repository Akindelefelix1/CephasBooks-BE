import { Module } from '@nestjs/common';
import { PosController } from './pos.controller.ts';
import { PosService } from './pos.service.ts';
@Module({ controllers: [PosController], providers: [PosService] })
export class PosModule {}
