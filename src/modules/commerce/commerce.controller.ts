import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.ts';
import { Roles } from '../../common/decorators/roles.decorator.ts';
import { RolesGuard } from '../../common/guards/roles.guard.ts';
import { CommerceService } from './commerce.service.ts';
import { CreateCommerceChannelDto, UpdateCommerceChannelDto } from './dto/commerce.dto.ts';

@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('commerce')
export class CommerceController {
  constructor(private readonly commerce: CommerceService) {}

  @Get('summary') summary(@CurrentUser() user: AuthUser) {
    return this.commerce.summary(user.organizationId);
  }

  @Get('channels') channels(@CurrentUser() user: AuthUser) {
    return this.commerce.channels(user.organizationId);
  }

  @Roles(Role.OWNER, Role.ADMIN)
  @Post('channels') createChannel(
    @CurrentUser() user: AuthUser,
    @Body() data: CreateCommerceChannelDto,
  ) {
    return this.commerce.createChannel(user.organizationId, data);
  }

  @Roles(Role.OWNER, Role.ADMIN)
  @Patch('channels/:id') updateChannel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: UpdateCommerceChannelDto,
  ) {
    return this.commerce.updateChannel(user.organizationId, id, data);
  }

  @Roles(Role.OWNER, Role.ADMIN)
  @Post('channels/:id/sync') syncChannel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.commerce.syncChannel(user.organizationId, id);
  }

  @Get('orders') orders(@CurrentUser() user: AuthUser) {
    return this.commerce.orders(user.organizationId);
  }

  @Get('catalog') catalog(@CurrentUser() user: AuthUser) {
    return this.commerce.catalog(user.organizationId);
  }
}
