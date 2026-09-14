import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoicesService } from './invoices.service';

@ApiTags('Invoices') @ApiBearerAuth() @UseGuards(AuthGuard('jwt')) @Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}
  @Get() list(@CurrentUser() user: AuthUser) { return this.invoices.list(user.organizationId); }
  @Get(':id') get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.invoices.get(user.organizationId, id); }
  @Post() create(@CurrentUser() user: AuthUser, @Body() dto: CreateInvoiceDto) { return this.invoices.create(user.organizationId, dto); }
}
