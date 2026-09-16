import { InsightReportType, SyncDirection, SyncStatus } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class SavedReportDto {
  @IsString() @IsNotEmpty() @MaxLength(100) name!: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsEnum(InsightReportType) type!: InsightReportType;
  @IsOptional() @IsDateString() dateFrom?: string;
  @IsOptional() @IsDateString() dateTo?: string;
}
export class ReportStatusDto {
  @IsBoolean() isArchived!: boolean;
}
export class AiQueryDto {
  @IsString() @IsNotEmpty() @MaxLength(500) question!: string;
}
export class WorkbookDto {
  @IsString() @IsNotEmpty() @MaxLength(100) name!: string;
  @IsString()
  @IsIn(['invoices', 'expenses', 'products', 'projects', 'customers', 'suppliers'])
  dataSource!: string;
  @IsOptional() @IsString() @MaxLength(255) fileName?: string;
  @IsEnum(SyncDirection) direction!: SyncDirection;
}
export class WorkbookStatusDto {
  @IsEnum(SyncStatus) status!: SyncStatus;
}
export class RunSyncDto {
  @IsOptional() @IsInt() @Min(0) rowCount?: number;
  @IsOptional() @IsString() @MaxLength(255) fileName?: string;
}
