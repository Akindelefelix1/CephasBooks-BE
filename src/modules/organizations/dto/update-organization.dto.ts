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
  IsArray,
  ArrayUnique,
  IsUUID,
  IsNotEmpty,
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
  @IsOptional() @IsUUID() customRoleId?: string;
  @IsString() @IsNotEmpty() @MaxLength(80) firstName!: string;
  @IsString() @IsNotEmpty() @MaxLength(80) lastName!: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
}

export class UpdateOrganizationUserDto {
  @IsOptional() @IsEnum(Role) role?: Role;
  @IsOptional() @IsUUID() customRoleId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() @MaxLength(80) firstName?: string;
  @IsOptional() @IsString() @MaxLength(80) lastName?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
}

export class CustomRoleDto {
  @IsString() @MaxLength(80) name!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsEnum(Role) baseRole!: Role;
  @IsArray() @ArrayUnique() @IsString({ each: true }) permissions!: string[];
}
