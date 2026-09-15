import {
  Body,
  Controller,
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
import { CreditNoteDto, CreateQuotationDto, PaymentDto, StatusDto } from './dto/sales.dto.ts';
import { SalesService } from './sales.service.ts';
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}
  @Get('summary') summary(@CurrentUser() u: AuthUser) {
    return this.sales.summary(u.organizationId);
  }
  @Get('quotations') quotations(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    return this.sales.quotations(u.organizationId, q);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Post('quotations') createQuotation(
    @CurrentUser() u: AuthUser,
    @Body() d: CreateQuotationDto,
  ) {
    return this.sales.createQuotation(u.organizationId, d);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Patch('quotations/:id') updateQuotation(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: CreateQuotationDto,
  ) {
    return this.sales.updateQuotation(u.organizationId, id, d);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Patch('quotations/:id/status') quotationStatus(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: StatusDto,
  ) {
    return this.sales.quotationStatus(u.organizationId, id, d.status);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Post('quotations/:id/convert') convert(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.sales.convertQuotation(u.organizationId, id);
  }
  @Get('payments') payments(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    return this.sales.payments(u.organizationId, q);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Post('payments') payment(
    @CurrentUser() u: AuthUser,
    @Body() d: PaymentDto,
  ) {
    return this.sales.recordPayment(u.organizationId, d);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Post('payments/:id/reverse') reversePayment(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.sales.reversePayment(u.organizationId, id);
  }
  @Get('credit-notes') credits(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    return this.sales.creditNotes(u.organizationId, q);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Post('credit-notes') credit(
    @CurrentUser() u: AuthUser,
    @Body() d: CreditNoteDto,
  ) {
    return this.sales.createCreditNote(u.organizationId, d);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Post('credit-notes/:id/void') voidCredit(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.sales.voidCredit(u.organizationId, id);
  }
  @Get('receivables') receivables(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    return this.sales.receivables(u.organizationId, q);
  }
}
