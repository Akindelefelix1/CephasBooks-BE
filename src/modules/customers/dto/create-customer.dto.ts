import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, IsNumber, Min, IsUUID, IsInt, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCustomerDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) name?: string;
  @ApiProperty() @IsString() @MaxLength(160) displayName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) companyName?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) taxId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) billingAddress?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @ApiPropertyOptional({ default: 30, description: 'Payment due period in calendar days; 0 means due on receipt.' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(3650) paymentTermsDays?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) creditLimit?: number;
  @ApiPropertyOptional({ description: 'Reason for the initial credit limit.' })
  @IsOptional() @IsString() @MaxLength(1000) creditLimitReason?: string;
}
