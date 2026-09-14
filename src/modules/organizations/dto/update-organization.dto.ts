import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO31661Alpha2, IsISO4217CurrencyCode, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateOrganizationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO4217CurrencyCode() baseCurrency?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO31661Alpha2() countryCode?: string;
}
