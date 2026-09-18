import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) firstName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) lastName?: string;
}
