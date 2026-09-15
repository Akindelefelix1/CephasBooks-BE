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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.ts';
import { Roles } from '../../common/decorators/roles.decorator.ts';
import { RolesGuard } from '../../common/guards/roles.guard.ts';
import { BankingService } from './banking.service.ts';
import {
  CreateBankAccountDto,
  CreateBankTransactionDto,
  CreateTransferDto,
  ImportTransactionsDto,
  ReconcileTransactionDto,
  UpdateBankAccountDto,
  UpdateBankTransactionDto,
} from './dto/banking.dto.ts';
@ApiTags('Money & Banking')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('banking')
export class BankingController {
  constructor(private readonly banking: BankingService) {}
  @Get('summary') summary(@CurrentUser() u: AuthUser) {
    return this.banking.summary(u.organizationId);
  }
  @Get('accounts') accounts(
    @CurrentUser() u: AuthUser,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.banking.accounts(u.organizationId, includeArchived === 'true');
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Post('accounts') createAccount(
    @CurrentUser() u: AuthUser,
    @Body() dto: CreateBankAccountDto,
  ) {
    return this.banking.createAccount(u.organizationId, dto);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Patch('accounts/:id') updateAccount(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBankAccountDto,
  ) {
    return this.banking.updateAccount(u.organizationId, id, dto);
  }
  @Roles(Role.OWNER, Role.ADMIN) @Delete('accounts/:id') deleteAccount(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.banking.deleteAccount(u.organizationId, id);
  }
  @Get('transactions/export') exportTransactions(
    @CurrentUser() u: AuthUser,
    @Query() query: Record<string, string>,
  ) {
    return this.banking.exportTransactions(u.organizationId, query);
  }
  @Get('transactions') transactions(
    @CurrentUser() u: AuthUser,
    @Query() query: Record<string, string>,
  ) {
    return this.banking.transactions(u.organizationId, query);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Post('transactions') createTransaction(
    @CurrentUser() u: AuthUser,
    @Body() dto: CreateBankTransactionDto,
  ) {
    return this.banking.createTransaction(u.organizationId, dto);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Post('transactions/import') importTransactions(
    @CurrentUser() u: AuthUser,
    @Body() dto: ImportTransactionsDto,
  ) {
    return this.banking.importTransactions(u.organizationId, dto);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Post('transfers') transfer(
    @CurrentUser() u: AuthUser,
    @Body() dto: CreateTransferDto,
  ) {
    return this.banking.transfer(u.organizationId, dto);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Patch('transactions/:id') updateTransaction(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBankTransactionDto,
  ) {
    return this.banking.updateTransaction(u.organizationId, id, dto);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Post('transactions/:id/reverse') reverse(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.banking.reverseTransaction(u.organizationId, id);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT)
  @Patch('transactions/:id/reconciliation')
  reconcile(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReconcileTransactionDto,
  ) {
    return this.banking.reconcile(u.organizationId, id, dto.status);
  }
}
