import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BankAccountType, BankTransactionType, ReconciliationStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateBankAccountDto {
  @ApiProperty() @IsString() @MaxLength(120) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) bankName?: string;
  @ApiProperty({ enum: BankAccountType }) @IsEnum(BankAccountType) accountType!: BankAccountType;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(4, 4) accountNumberLast4?: string;
  @ApiPropertyOptional({ default: 'NGN' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;
  @ApiPropertyOptional({ default: 0 }) @Type(() => Number) @IsNumber() openingBalance = 0;
}
export class UpdateBankAccountDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) bankName?: string;
  @ApiPropertyOptional({ enum: BankAccountType })
  @IsOptional()
  @IsEnum(BankAccountType)
  accountType?: BankAccountType;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(4, 4) accountNumberLast4?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class CreateBankTransactionDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiProperty() @IsUUID() bankAccountId!: string;
  @ApiProperty() @IsDateString() transactionDate!: string;
  @ApiProperty() @IsString() @MaxLength(240) description!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @ApiProperty({ enum: BankTransactionType })
  @IsEnum(BankTransactionType)
  type!: BankTransactionType;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0.01) amount!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
export class ReconcileTransactionDto {
  @ApiProperty({ enum: ReconciliationStatus })
  @IsEnum(ReconciliationStatus)
  status!: ReconciliationStatus;
}
export class ImportTransactionsDto {
  @ApiProperty() @IsUUID() bankAccountId!: string;
  @ApiProperty({ description: 'CSV with date,description,reference,type,amount columns' })
  @IsString()
  csv!: string;
}

export class CreateTransferDto {
  @ApiProperty() @IsUUID() fromAccountId!: string;
  @ApiProperty() @IsUUID() toAccountId!: string;
  @ApiProperty() @IsDateString() transactionDate!: string;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0.01) amount!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class UpdateBankTransactionDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() transactionDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(240) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @ApiPropertyOptional({ enum: BankTransactionType })
  @IsOptional()
  @IsEnum(BankTransactionType)
  type?: BankTransactionType;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0.01) amount?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class ReverseBankTransactionDto {
  @ApiProperty() @IsString() @MaxLength(500) reason!: string;
}
