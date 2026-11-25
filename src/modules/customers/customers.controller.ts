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
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.ts';
import { Roles } from '../../common/decorators/roles.decorator.ts';
import { RolesGuard } from '../../common/guards/roles.guard.ts';
import { CustomersService } from './customers.service.ts';
import { CreateCustomerDto } from './dto/create-customer.dto.ts';
import { UpdateCustomerDto } from './dto/update-customer.dto.ts';

@ApiTags('Customers')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}
  @Get() @ApiQuery({ name: 'search', required: false }) list(
    @CurrentUser() u: AuthUser,
    @Query('page') page = 1,
    @Query('limit') limit = 25,
    @Query('search') search?: string,
  ) {
    return this.customers.list(
      u.organizationId,
      Math.max(1, page),
      Math.min(100, Math.max(1, limit)),
      search,
    );
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT)
  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: CreateCustomerDto) {
    return this.customers.create(u.organizationId, u.sub, dto);
  }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.get(u.organizationId, id);
  }
  @Get(':id/credit-status') creditStatus(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.customers.creditStatus(u.organizationId, id);
  }
  @Get(':id/credit-limit-history') creditLimitHistory(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.customers.creditLimitHistory(u.organizationId, id);
  }
  @Get(':id/credit-override-history') creditOverrideHistory(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.customers.creditOverrideHistory(u.organizationId, id);
  }
  @Get(':id/pos-credit-payments') posCreditPaymentHistory(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.customers.posCreditPaymentHistory(u.organizationId, id);
  }
  @Get(':id/purchase-history') purchaseHistory(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.customers.purchaseHistory(u.organizationId, id);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT)
  @Patch(':id') update(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customers.update(u.organizationId, id, u.sub, dto);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT)
  @Delete(':id') archive(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.archive(u.organizationId, id);
  }
}
