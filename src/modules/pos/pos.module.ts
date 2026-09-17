import { Module } from '@nestjs/common';
import { PosController } from './pos.controller.ts';
import { PosService } from './pos.service.ts';
import { RolesGuard } from '../../common/guards/roles.guard.ts';
@Module({ controllers: [PosController], providers: [PosService, RolesGuard] })
export class PosModule {}
