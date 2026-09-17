import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCustomerDto {
  @ApiProperty() @IsString() @MaxLength(160) displayName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) companyName?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) taxId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) billingAddress?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) creditLimit?: number;
}
