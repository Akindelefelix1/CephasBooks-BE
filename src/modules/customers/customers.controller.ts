import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@ApiTags('Customers') @ApiBearerAuth() @UseGuards(AuthGuard('jwt')) @Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}
  @Get() @ApiQuery({ name: 'search', required: false }) list(@CurrentUser() u: AuthUser, @Query('page') page = 1, @Query('limit') limit = 25, @Query('search') search?: string) { return this.customers.list(u.organizationId, Math.max(1, page), Math.min(100, Math.max(1, limit)), search); }
  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: CreateCustomerDto) { return this.customers.create(u.organizationId, dto); }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.customers.get(u.organizationId, id); }
  @Patch(':id') update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCustomerDto) { return this.customers.update(u.organizationId, id, dto); }
  @Delete(':id') archive(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.customers.archive(u.organizationId, id); }
}
