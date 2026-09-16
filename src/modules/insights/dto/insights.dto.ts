import { InsightReportType, SyncDirection, SyncStatus } from '@prisma/client';
import { IsBoolean, IsDateString, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class SavedReportDto {
  @IsString() @IsNotEmpty() @MaxLength(100) name!: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsEnum(InsightReportType) type!: InsightReportType;
  @IsOptional() @IsDateString() dateFrom?: string;
  @IsOptional() @IsDateString() dateTo?: string;
}
export class ReportStatusDto { @IsBoolean() isArchived!: boolean; }
export class AiQueryDto { @IsString() @IsNotEmpty() @MaxLength(500) question!: string; }
export class WorkbookDto {
  @IsString() @IsNotEmpty() @MaxLength(100) name!: string;
  @IsString() @IsNotEmpty() @MaxLength(50) dataSource!: string;
  @IsOptional() @IsString() @MaxLength(255) fileName?: string;
  @IsEnum(SyncDirection) direction!: SyncDirection;
}
export class WorkbookStatusDto { @IsEnum(SyncStatus) status!: SyncStatus; }
export class RunSyncDto {
  @IsOptional() @IsInt() @Min(0) rowCount?: number;
  @IsOptional() @IsString() fileName?: string;
}
