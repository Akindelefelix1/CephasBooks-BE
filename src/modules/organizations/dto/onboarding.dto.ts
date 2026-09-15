import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsISO4217CurrencyCode,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

export class BusinessProfileDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(120) businessName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) legalName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) registrationNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) taxId?: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(80) industry!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(80) businessType!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) businessAddress?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(250)
  website?: string;
}

export class FinancialSettingsDto {
  @ApiProperty() @IsISO4217CurrencyCode() baseCurrency!: string;
  @ApiProperty() @IsIn(['January', 'April', 'July', 'October']) fiscalYearStart!: string;
  @ApiProperty() @IsIn(['Accrual basis', 'Cash basis']) accountingMethod!: string;
  @ApiProperty() @IsIn(['Due on receipt', 'Net 15', 'Net 30', 'Net 60']) paymentTerms!: string;
  @ApiProperty() @IsIn(['Weighted average', 'FIFO']) inventoryValuation!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(80) timezone!: string;
}

export class OrganizationStructureDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(120) primaryBranch!: string;
  @ApiProperty() @IsIn(['1', '2-5', '6-20', 'More than 20']) branchCount!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) departments?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) defaultCostCentre?: string;
  @ApiProperty() @IsIn(['Yes', 'No']) projectTracking!: string;
}

export class TaxSetupDto {
  @ApiProperty() @IsIn(['Nigeria', 'Ghana', 'Kenya', 'South Africa']) taxCountry!: string;
  @ApiProperty() @IsIn(['Yes', 'No']) vatRegistered!: string;
  @ApiProperty() @IsIn(['7.5%', '0%', 'Exempt']) salesVatRate!: string;
  @ApiProperty() @IsIn(['Monthly', 'Quarterly', 'Annually']) taxFrequency!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) taxNotes?: string;
}

export class TeamSetupDto {
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(254) inviteEmail?: string;
  @ApiPropertyOptional({ enum: Role }) @IsOptional() @IsEnum(Role) inviteRole?: Role;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) inviteMessage?: string;
}
