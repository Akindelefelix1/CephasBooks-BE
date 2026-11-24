import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsBoolean,
  IsISO4217CurrencyCode,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class InvoiceItemDto {
  @ApiProperty() @IsString() @MaxLength(160) name!: string;
  @ApiProperty() @IsString() @MaxLength(500) description!: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001) quantity!: number;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) unitPrice!: number;
  @ApiProperty({ default: 0 }) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) taxRate = 0;
}

export class CreateInvoiceDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ description: 'Optional project used to classify later customer payments.' })
  @IsOptional() @IsUUID() projectId?: string;
  @ApiProperty() @IsUUID() customerId!: string;
  @ApiPropertyOptional({ readOnly: true }) @IsOptional() @IsString() @MaxLength(50) number?: string;
  @ApiPropertyOptional({ description: 'Email the invoice and customer statement after saving.' })
  @IsOptional() @IsBoolean() sendEmail?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() creditLimitOverride?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) creditLimitOverrideReason?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO4217CurrencyCode() currency?: string;
  @ApiProperty() @IsDateString() issueDate!: string;
  @ApiProperty() @IsDateString() dueDate!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) shippingAddress?: string;
  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  shippingAmount = 0;
  @ApiProperty({ type: [InvoiceItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemDto)
  items!: InvoiceItemDto[];
}

export class SendInvoiceDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() creditLimitOverride?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) creditLimitOverrideReason?: string;
}
