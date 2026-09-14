import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InvoiceStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsEnum, IsISO4217CurrencyCode, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';

export class InvoiceItemDto {
  @ApiProperty() @IsString() @MaxLength(500) description!: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001) quantity!: number;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) unitPrice!: number;
  @ApiProperty({ default: 0 }) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) taxRate = 0;
}

export class CreateInvoiceDto {
  @ApiProperty() @IsUUID() customerId!: string;
  @ApiProperty() @IsString() @MaxLength(50) number!: string;
  @ApiProperty({ enum: InvoiceStatus }) @IsOptional() @IsEnum(InvoiceStatus) status?: InvoiceStatus;
  @ApiProperty({ default: 'NGN' }) @IsISO4217CurrencyCode() currency = 'NGN';
  @ApiProperty() @IsDateString() issueDate!: string;
  @ApiProperty() @IsDateString() dueDate!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @ApiProperty({ type: [InvoiceItemDto] }) @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => InvoiceItemDto) items!: InvoiceItemDto[];
}
