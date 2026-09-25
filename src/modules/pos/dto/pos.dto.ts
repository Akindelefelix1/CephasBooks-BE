import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  IsDateString,
  IsInt,
  Max,
  IsNumber,
  ValidateNested,
} from 'class-validator';
import { PosPaymentMethod } from '@prisma/client';

export class PosLineDto {
  @IsUUID() productId!: string;
  @Type(() => Number) @IsNumber() @Min(0.0001) quantity!: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) discount?: number;
}
export class PosPaymentDto {
  @IsEnum(PosPaymentMethod) method!: PosPaymentMethod;
  @Type(() => Number) @IsNumber() @Min(0.01) amount!: number;
  @IsOptional() @IsString() @MaxLength(128) reference?: string;
}
export class CompletePosSaleDto {
  @IsOptional() @IsUUID() branchId?: string;
  @IsUUID() registerId!: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PosLineDto)
  items!: PosLineDto[];
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PosPaymentDto)
  payments!: PosPaymentDto[];
  @IsOptional() @IsString() @MaxLength(128) idempotencyKey?: string;
}
export class ListPosSalesDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 10;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
}
export class OpenShiftDto {
  @IsUUID() registerId!: string;
  @Type(() => Number) @IsNumber() @Min(0) openingCash!: number;
}
export class CloseShiftDto {
  @Type(() => Number) @IsNumber() @Min(0) closingCash!: number;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
export class CreateRegisterDto {
  @IsUUID() warehouseId!: string;
  @IsString() @MaxLength(32) code!: string;
  @IsString() @MaxLength(120) name!: string;
}
export class ReturnPosSaleDto {
  @IsUUID() productId!: string;
  @Type(() => Number) @IsNumber() @Min(0.0001) quantity!: number;
  @IsString() @MaxLength(1000) reason!: string;
}
export class VoidPosSaleDto {
  @IsString() @MaxLength(1000) reason!: string;
}
