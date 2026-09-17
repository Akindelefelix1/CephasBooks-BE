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
import {
  ActiveStatusDto,
  AdjustmentDto,
  AdjustmentStatusDto,
  MovementDto,
  ProductDto,
  ProductCategoryDto,
  ProjectDto,
  ProjectPlanDto,
  ProjectStatusDto,
  TransferDto,
  WarehouseDto,
} from './dto/operations.dto.ts';
import { OperationsService } from './operations.service.ts';

@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('operations')
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}
  @Get('summary') summary(@CurrentUser() u: AuthUser) {
    return this.operations.summary(u.organizationId);
  }
  @Get('products') products(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    return this.operations.products(u.organizationId, q);
  }
  @Get('product-categories') categories(@CurrentUser() u: AuthUser) {
    return this.operations.categories(u.organizationId);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Post('product-categories') createCategory(
    @CurrentUser() u: AuthUser,
    @Body() d: ProductCategoryDto,
  ) {
    return this.operations.createCategory(u.organizationId, d.name);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Post('products') createProduct(
    @CurrentUser() u: AuthUser,
    @Body() d: ProductDto,
  ) {
    return this.operations.createProduct(u.organizationId, d);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Patch('products/:id') updateProduct(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: ProductDto,
  ) {
    return this.operations.updateProduct(u.organizationId, id, d);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Patch('products/:id/status') productStatus(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: ActiveStatusDto,
  ) {
    return this.operations.productStatus(u.organizationId, id, d.isActive);
  }
  @Get('warehouses') warehouses(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    return this.operations.warehouses(u.organizationId, q);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Post('warehouses') createWarehouse(
    @CurrentUser() u: AuthUser,
    @Body() d: WarehouseDto,
  ) {
    return this.operations.createWarehouse(u.organizationId, d);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Patch('warehouses/:id') updateWarehouse(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: WarehouseDto,
  ) {
    return this.operations.updateWarehouse(u.organizationId, id, d);
  }
  @Roles(Role.OWNER, Role.ADMIN) @Patch('warehouses/:id/status') warehouseStatus(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: ActiveStatusDto,
  ) {
    return this.operations.warehouseStatus(u.organizationId, id, d.isActive);
  }
  @Get('movements') movements(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    return this.operations.movements(u.organizationId, q);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Post('movements') createMovement(
    @CurrentUser() u: AuthUser,
    @Body() d: MovementDto,
  ) {
    return this.operations.createMovement(u.organizationId, d);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Post('transfers') transfer(
    @CurrentUser() u: AuthUser,
    @Body() d: TransferDto,
  ) {
    return this.operations.transfer(u.organizationId, d);
  }
  @Get('adjustments') adjustments(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    return this.operations.adjustments(u.organizationId, q);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Post('adjustments') createAdjustment(
    @CurrentUser() u: AuthUser,
    @Body() d: AdjustmentDto,
  ) {
    return this.operations.createAdjustment(u.organizationId, d);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT, Role.APPROVER)
  @Patch('adjustments/:id/status')
  adjustmentStatus(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: AdjustmentStatusDto,
  ) {
    return this.operations.adjustmentStatus(u.organizationId, id, d.status);
  }
  @Get('projects') projects(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) {
    return this.operations.projects(u.organizationId, q);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Post('projects') createProject(
    @CurrentUser() u: AuthUser,
    @Body() d: ProjectDto,
  ) {
    return this.operations.createProject(u.organizationId, d);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Patch('projects/:id') updateProject(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: ProjectDto,
  ) {
    return this.operations.updateProject(u.organizationId, id, d);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT, Role.APPROVER)
  @Patch('projects/:id/status')
  projectStatus(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: ProjectStatusDto,
  ) {
    return this.operations.projectStatus(u.organizationId, id, d.status);
  }
  @Roles(Role.OWNER, Role.ADMIN, Role.ACCOUNTANT) @Post('project-ai/plan') plan(
    @Body() d: ProjectPlanDto,
  ) {
    return this.operations.plan(d);
  }
}
