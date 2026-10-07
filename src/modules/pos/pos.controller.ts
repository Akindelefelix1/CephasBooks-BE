import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.ts';
import { Roles } from '../../common/decorators/roles.decorator.ts';
import { RolesGuard } from '../../common/guards/roles.guard.ts';
import { PosService } from './pos.service.ts';
import {
  AssignRegisterStaffDto,
  CloseShiftDto,
  CompletePosSaleDto,
  CreateRegisterDto,
  ListPosSalesDto,
  OpenShiftDto,
  ReturnPosSaleDto,
  UpdateRegisterDto,
  UpdatePosReceiptSignaturesDto,
  VoidPosSaleDto,
} from './dto/pos.dto.ts';
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('pos')
export class PosController {
  constructor(private readonly pos: PosService) {}
  @Get('sales') list(@CurrentUser() u: AuthUser, @Query() query: ListPosSalesDto) {
    return this.pos.list(u.organizationId, query, u.sub, u.role);
  }
  @Get('sales/:id/receipt') receipt(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.pos.receipt(u.organizationId, id, u.sub, u.role);
  }
  @Roles(Role.OWNER, Role.ADMIN)
  @Post('sales/:id/receipt/reprint')
  reprint(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.pos.recordReprint(u.organizationId, u.sub, id);
  }
  @Roles(Role.OWNER, Role.ADMIN)
  @Post('sales/:id/receipt/email')
  emailReceipt(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.pos.emailReceipt(u.organizationId, u.sub, id);
  }
  @Roles(Role.OWNER, Role.ADMIN)
  @Post('sales/:id/receipt/sms')
  smsReceipt(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.pos.smsReceipt(u.organizationId, u.sub, id);
  }
  @Get('registers') registers(@CurrentUser() u: AuthUser) {
    return this.pos.registers(u.organizationId, u.sub, u.role);
  }
  @Get('branches') branches(@CurrentUser() u: AuthUser) {
    return this.pos.branches(u.organizationId, u.sub, u.role);
  }
  @Roles(Role.OWNER)
  @Post('registers')
  createRegister(@CurrentUser() u: AuthUser, @Body() data: CreateRegisterDto) {
    return this.pos.createRegister(u.organizationId, data);
  }
  @Roles(Role.OWNER)
  @Patch('registers/:id/staff')
  assignRegisterStaff(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() data: AssignRegisterStaffDto,
  ) {
    return this.pos.assignRegisterStaff(u.organizationId, id, data.assignedStaffId, data.branchId);
  }
  @Roles(Role.OWNER)
  @Patch('registers/:id')
  updateRegister(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() data: UpdateRegisterDto,
  ) {
    return this.pos.updateRegister(u.organizationId, id, data);
  }
  @Get('shifts/current') currentShift(@CurrentUser() u: AuthUser) {
    return this.pos.currentShift(u.organizationId, u.sub);
  }
  @Post('shifts') openShift(@CurrentUser() u: AuthUser, @Body() data: OpenShiftDto) {
    return this.pos.openShift(u.organizationId, u.sub, data);
  }
  @Post('shifts/:id/close') closeShift(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() data: CloseShiftDto,
  ) {
    return this.pos.closeShift(u.organizationId, u.sub, id, data);
  }
  @Post('sales') complete(@CurrentUser() u: AuthUser, @Body() data: CompletePosSaleDto) {
    return this.pos.complete(u.organizationId, u.sub, data);
  }
  @Patch('sales/:id/receipt-signatures') updateReceiptSignatures(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() data: UpdatePosReceiptSignaturesDto,
  ) {
    return this.pos.updateReceiptSignatures(u.organizationId, id, data);
  }
  @Post('sales/:id/returns') returnItem(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() data: ReturnPosSaleDto,
  ) {
    return this.pos.returnItem(u.organizationId, u.sub, id, data);
  }
  @Roles(Role.OWNER, Role.ADMIN)
  @Post('sales/:id/void')
  voidSale(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() data: VoidPosSaleDto) {
    return this.pos.voidSale(u.organizationId, u.sub, id, data.reason);
  }
}
