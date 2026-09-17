import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.ts';
import { PosService } from './pos.service.ts';
@UseGuards(AuthGuard('jwt'))
@Controller('pos')
export class PosController {
  constructor(private readonly pos: PosService) {}
  @Get('sales') list(@CurrentUser() u: AuthUser) { return this.pos.list(u.organizationId); }
  @Post('sales') complete(@CurrentUser() u: AuthUser, @Body() data: any) { return this.pos.complete(u.organizationId, data); }
}
