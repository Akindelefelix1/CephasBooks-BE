import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.ts';
import { PosService } from './pos.service.ts';
import { CloseShiftDto, CompletePosSaleDto, CreateRegisterDto, OpenShiftDto, ReturnPosSaleDto } from './dto/pos.dto.ts';
@UseGuards(AuthGuard('jwt'))
@Controller('pos')
export class PosController {
  constructor(private readonly pos: PosService) {}
  @Get('sales') list(@CurrentUser() u: AuthUser) { return this.pos.list(u.organizationId); }
  @Get('registers') registers(@CurrentUser() u: AuthUser) { return this.pos.registers(u.organizationId); }
  @Post('registers') createRegister(@CurrentUser() u: AuthUser, @Body() data: CreateRegisterDto) { return this.pos.createRegister(u.organizationId, data); }
  @Post('shifts') openShift(@CurrentUser() u: AuthUser, @Body() data: OpenShiftDto) { return this.pos.openShift(u.organizationId, u.sub, data); }
  @Post('shifts/:id/close') closeShift(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() data: CloseShiftDto) { return this.pos.closeShift(u.organizationId, u.sub, id, data); }
  @Post('sales') complete(@CurrentUser() u: AuthUser, @Body() data: CompletePosSaleDto) { return this.pos.complete(u.organizationId, u.sub, u.role, data); }
  @Post('sales/:id/returns') returnItem(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() data: ReturnPosSaleDto) { return this.pos.returnItem(u.organizationId, u.sub, id, data); }
}
