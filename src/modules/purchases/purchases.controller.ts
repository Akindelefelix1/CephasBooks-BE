import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.ts';
import { Roles } from '../../common/decorators/roles.decorator.ts';
import { RolesGuard } from '../../common/guards/roles.guard.ts';
import {
  BillDto,
  BillStatusDto,
  ConvertOrderDto,
  ExpenseDto,
  ExpenseStatusDto,
  OrderDto,
  OrderStatusDto,
  RequestDto,
  RequestStatusDto,
  SupplierDto,
  SupplierPaymentDto,
} from './dto/purchases.dto.ts';
import { PurchasesService } from './purchases.service.ts';
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('purchases')
export class PurchasesController {
  constructor(private readonly s: PurchasesService) {}
  @Get('summary') summary(@CurrentUser() u: AuthUser) {
    return this.s.summary(u.organizationId);
  }
  @Get('suppliers') suppliers(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    return this.s.suppliers(u.organizationId, q);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Post('suppliers') createSupplier(
    @CurrentUser() u: AuthUser,
    @Body() d: SupplierDto,
  ) {
    return this.s.createSupplier(u.organizationId, d);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Patch('suppliers/:id') updateSupplier(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: SupplierDto,
  ) {
    return this.s.updateSupplier(u.organizationId, id, d);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Delete('suppliers/:id') archiveSupplier(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.s.archiveSupplier(u.organizationId, id);
  }
  @Roles(Role.OWNER, Role.ADMIN)
  @Delete('suppliers/:id/permanent')
  deleteSupplier(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.s.deleteSupplier(u.organizationId, id);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT)
  @Patch('suppliers/:id/restore')
  restoreSupplier(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.s.restoreSupplier(u.organizationId, id);
  }
  @Get('requests') requests(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    return this.s.requests(u.organizationId, q);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT, Role.MEMBER) @Post('requests') createRequest(
    @CurrentUser() u: AuthUser,
    @Body() d: RequestDto,
  ) {
    return this.s.createRequest(u.organizationId, d);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT, Role.APPROVER)
  @Patch('requests/:id/status')
  requestStatus(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: RequestStatusDto,
  ) {
    return this.s.requestStatus(u.organizationId, id, d.status);
  }
  @Get('orders') orders(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    return this.s.orders(u.organizationId, q);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Post('orders') createOrder(
    @CurrentUser() u: AuthUser,
    @Body() d: OrderDto,
  ) {
    return this.s.createOrder(u.organizationId, d);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Patch('orders/:id/status') orderStatus(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: OrderStatusDto,
  ) {
    return this.s.orderStatus(u.organizationId, id, d.status);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Post('orders/:id/convert') orderToBill(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: ConvertOrderDto,
  ) {
    return this.s.orderToBill(u.organizationId, id, d);
  }
  @Get('bills') bills(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    return this.s.bills(u.organizationId, q);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Post('bills') createBill(
    @CurrentUser() u: AuthUser,
    @Body() d: BillDto,
  ) {
    return this.s.createBill(u.organizationId, d);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT, Role.APPROVER)
  @Patch('bills/:id/status')
  billStatus(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: BillStatusDto,
  ) {
    return this.s.billStatus(u.organizationId, id, d.status);
  }
  @Get('payments') payments(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    return this.s.payments(u.organizationId, q);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Post('payments') createPayment(
    @CurrentUser() u: AuthUser,
    @Body() d: SupplierPaymentDto,
  ) {
    return this.s.createPayment(u.organizationId, d);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Post('payments/:id/reverse') reversePayment(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.s.reversePayment(u.organizationId, id);
  }
  @Get('payables') payables(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    return this.s.payables(u.organizationId, q);
  }
  @Get('expenses') expenses(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    return this.s.expenses(u.organizationId, q);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT, Role.MEMBER) @Post('expenses') createExpense(
    @CurrentUser() u: AuthUser,
    @Body() d: ExpenseDto,
  ) {
    return this.s.createExpense(u.organizationId, d);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT, Role.APPROVER)
  @Patch('expenses/:id/status')
  expenseStatus(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: ExpenseStatusDto,
  ) {
    return this.s.expenseStatus(u.organizationId, id, d.status);
  }
}
