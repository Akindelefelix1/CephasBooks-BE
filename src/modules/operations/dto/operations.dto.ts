import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { AdjustmentStatus, ItemType, ProjectStatus, StockMovementType } from '@prisma/client';

export class ProductDto {
  @IsString() @MaxLength(80) sku!: string;
  @IsString() @MaxLength(160) name!: string;
  @IsEnum(ItemType) type!: ItemType;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() unit = 'unit';
  @Type(() => Number) @IsNumber() @Min(0) salePrice!: number;
  @Type(() => Number) @IsNumber() @Min(0) costPrice!: number;
  @Type(() => Number) @IsNumber() @Min(0) taxRate!: number;
  @Type(() => Number) @IsNumber() @Min(0) reorderLevel!: number;
  @IsOptional() @IsUUID() defaultWarehouseId?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) openingQuantity?: number;
  @IsOptional() @IsUUID() openingWarehouseId?: string;
}

export class ProductCategoryDto {
  @IsString() @IsNotEmpty() @MaxLength(100) name!: string;
}

export class WarehouseDto {
  @IsString() @MaxLength(50) code!: string;
  @IsString() @MaxLength(160) name!: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() manager?: string;
}

export class ActiveStatusDto {
  @IsBoolean() isActive!: boolean;
}

export class MovementDto {
  @IsUUID() productId!: string;
  @IsUUID() warehouseId!: string;
  @IsEnum(StockMovementType) type!: StockMovementType;
  @Type(() => Number) @IsNumber() @Min(0.0001) quantity!: number;
  @Type(() => Number) @IsNumber() @Min(0) unitCost!: number;
  @IsDateString() movementDate!: string;
  @IsString() reference!: string;
  @IsOptional() @IsString() notes?: string;
}

export class TransferDto {
  @IsUUID() productId!: string;
  @IsUUID() fromWarehouseId!: string;
  @IsUUID() toWarehouseId!: string;
  @Type(() => Number) @IsNumber() @Min(0.0001) quantity!: number;
  @Type(() => Number) @IsNumber() @Min(0) unitCost!: number;
  @IsDateString() movementDate!: string;
  @IsString() reference!: string;
  @IsOptional() @IsString() notes?: string;
}

export class AdjustmentDto {
  @IsUUID() productId!: string;
  @IsUUID() warehouseId!: string;
  @IsString() reference!: string;
  @IsDateString() adjustmentDate!: string;
  @Type(() => Number) @IsNumber() quantityDelta!: number;
  @Type(() => Number) @IsNumber() @Min(0) unitCost!: number;
  @IsString() reason!: string;
  @IsOptional() @IsString() notes?: string;
}

export class AdjustmentStatusDto {
  @IsEnum(AdjustmentStatus) status!: AdjustmentStatus;
}

export class ProjectDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() client?: string;
  @IsString() owner!: string;
  @IsDateString() startDate!: string;
  @IsOptional() @IsDateString() endDate?: string;
  @Type(() => Number) @IsNumber() @Min(0) budget!: number;
  @Type(() => Number) @IsNumber() @Min(0) actualCost!: number;
  @Type(() => Number) @IsNumber() @Min(0) revenue!: number;
  @IsOptional() @IsEnum(ProjectStatus) status?: ProjectStatus;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsArray() tasks?: Array<Record<string, unknown>>;
}

export class ProjectStatusDto {
  @IsEnum(ProjectStatus) status!: ProjectStatus;
}

export class ProjectPlanDto {
  @IsString() @MaxLength(160) name!: string;
  @IsString() @MaxLength(2000) objective!: string;
  @IsOptional() @IsString() owner?: string;
  @IsOptional() @IsDateString() targetDate?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) budget?: number;
}
