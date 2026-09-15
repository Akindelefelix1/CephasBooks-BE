import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches, MaxLength } from 'class-validator';

export class VerifyEmailDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;
  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must contain exactly six digits' })
  code!: string;
}

export class ResendVerificationDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;
}
