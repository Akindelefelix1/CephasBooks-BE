import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { FinanceRecordKind, LedgerAccountType } from '@prisma/client';
export class AccountDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsEnum(LedgerAccountType) type!: LedgerAccountType;
  @IsOptional() @IsString() description?: string;
}
export class JournalLineDto {
  @IsUUID() accountId!: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) debit = 0;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) credit = 0;
  @IsOptional() @IsString() memo?: string;
}
export class JournalDto {
  @IsString() number!: string;
  @IsDateString() journalDate!: string;
  @IsString() @MaxLength(500) description!: string;
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => JournalLineDto)
  lines!: JournalLineDto[];
}
export class FinanceRecordDto {
  @IsEnum(FinanceRecordKind) kind!: FinanceRecordKind;
  @IsString() @IsNotEmpty() @MaxLength(100) reference!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @IsDateString() startDate!: string;
  @IsOptional() @IsDateString() endDate?: string;
  @Type(() => Number) @IsNumber() @Min(0) amount!: number;
  @IsOptional() @IsString() status = 'DRAFT';
  @IsOptional() @IsObject() data: Record<string, unknown> = {};
}
export class StatusDto {
  @IsString() status!: string;
}

export class AssetDepreciationSettingsDto {
  @Type(() => Number) @IsNumber() @Min(0) residualValue!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) usefulLifeYears!: number;
  @IsIn(['STRAIGHT_LINE', 'REDUCING_BALANCE']) method!: 'STRAIGHT_LINE' | 'REDUCING_BALANCE';
  @IsIn(['MONTHLY', 'QUARTERLY', 'ANNUALLY']) frequency!: 'MONTHLY' | 'QUARTERLY' | 'ANNUALLY';
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.01) @Max(100) reducingBalanceRate?: number;
}

export class RunAssetDepreciationDto {
  @IsOptional() @IsDateString() throughDate?: string;
}
