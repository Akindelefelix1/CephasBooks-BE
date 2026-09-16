import { ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsBoolean,
  IsISO31661Alpha2,
  IsISO4217CurrencyCode,
  IsOptional,
  IsObject,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateOrganizationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO4217CurrencyCode() baseCurrency?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO31661Alpha2() countryCode?: string;
}

export class UpdateOrganizationSectionDto {
  @IsObject() data!: Record<string, unknown>;
}

export class InviteOrganizationUserDto {
  @IsEmail() email!: string;
  @IsEnum(Role) role!: Role;
}

export class UpdateOrganizationUserDto {
  @IsOptional() @IsEnum(Role) role?: Role;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
