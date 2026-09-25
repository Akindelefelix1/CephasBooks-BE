import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SalesDocumentStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  ArrayMinSize,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
export class SalesLineDto {
  @ApiProperty() @IsString() description!: string;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0.0001) quantity!: number;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0) unitPrice!: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) taxRate = 0;
}
export class CreateQuotationDto {
  @IsOptional() @IsUUID() branchId?: string;
  @IsUUID() customerId!: string;
  @IsString() number!: string;
  @IsOptional() @IsEnum(SalesDocumentStatus) status?: SalesDocumentStatus;
  @IsString() currency = 'NGN';
  @IsDateString() issueDate!: string;
  @IsDateString() expiryDate!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SalesLineDto)
  items!: SalesLineDto[];
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
export class PaymentDto {
  @IsOptional() @IsUUID() branchId?: string;
  @IsUUID() invoiceId!: string;
  @IsString() reference!: string;
  @Type(() => Number) @IsNumber() @Min(0.01) amount!: number;
  @IsDateString() paymentDate!: string;
  @IsString() method!: string;
  @IsOptional() @IsString() notes?: string;
}
export class CreditNoteDto {
  @IsOptional() @IsUUID() branchId?: string;
  @IsUUID() invoiceId!: string;
  @IsString() number!: string;
  @Type(() => Number) @IsNumber() @Min(0.01) amount!: number;
  @IsDateString() issueDate!: string;
  @IsString() reason!: string;
}
export class StatusDto {
  @IsString() status!: string;
}
