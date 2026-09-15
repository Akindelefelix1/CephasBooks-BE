import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FinanceRecordKind, Role } from '@prisma/client';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.ts';
import { Roles } from '../../common/decorators/roles.decorator.ts';
import { RolesGuard } from '../../common/guards/roles.guard.ts';
import { AccountDto, FinanceRecordDto, JournalDto, StatusDto } from './dto/accounting.dto.ts';
import { AccountingService } from './accounting.service.ts';
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('accounting')
export class AccountingController {
  constructor(private readonly s: AccountingService) {}
  @Get('accounts') accounts(@CurrentUser() u: AuthUser, @Query('includeArchived') all?: string) {
    return this.s.accounts(u.organizationId, all === 'true');
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Post('accounts') createAccount(
    @CurrentUser() u: AuthUser,
    @Body() d: AccountDto,
  ) {
    return this.s.createAccount(u.organizationId, d);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Patch('accounts/:id/status') accountStatus(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: StatusDto,
  ) {
    return this.s.accountStatus(u.organizationId, id, d.status === 'ACTIVE');
  }
  @Get('journals') journals(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    return this.s.journals(u.organizationId, q);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Post('journals') createJournal(
    @CurrentUser() u: AuthUser,
    @Body() d: JournalDto,
  ) {
    return this.s.createJournal(u.organizationId, d);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT, Role.APPROVER)
  @Post('journals/:id/post')
  postJournal(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.s.postJournal(u.organizationId, id);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Post('journals/:id/reverse') reverseJournal(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.s.reverseJournal(u.organizationId, id);
  }
  @Get('ledger') ledger(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    return this.s.ledger(u.organizationId, q);
  }
  @Get('trial-balance') trial(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    return this.s.trialBalance(u.organizationId, q);
  }
  @Get('records/:kind') records(
    @CurrentUser() u: AuthUser,
    @Param('kind', new ParseEnumPipe(FinanceRecordKind)) kind: FinanceRecordKind,
    @Query() q: Record<string, string>,
  ) {
    return this.s.records(u.organizationId, kind, q);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Post('records') createRecord(
    @CurrentUser() u: AuthUser,
    @Body() d: FinanceRecordDto,
  ) {
    return this.s.createRecord(u.organizationId, d);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT, Role.APPROVER)
  @Patch('records/:id/status')
  recordStatus(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: StatusDto,
  ) {
    return this.s.recordStatus(u.organizationId, id, d.status);
  }
  @Get('summary') summary(@CurrentUser() u: AuthUser) {
    return this.s.summary(u.organizationId);
  }
}
