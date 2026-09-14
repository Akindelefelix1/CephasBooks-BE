import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, Length, Matches, MaxLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'Ada' }) @IsString() @IsNotEmpty() @MaxLength(80) firstName!: string;
  @ApiProperty({ example: 'Okafor' }) @IsString() @IsNotEmpty() @MaxLength(80) lastName!: string;
  @ApiProperty({ example: 'ada@example.com' }) @IsEmail() @MaxLength(254) email!: string;
  @ApiProperty({ minLength: 12 })
  @IsString()
  @Length(12, 128)
  @Matches(/[a-z]/, { message: 'password must contain a lowercase letter' })
  @Matches(/[A-Z]/, { message: 'password must contain an uppercase letter' })
  @Matches(/\d/, { message: 'password must contain a number' })
  password!: string;
  @ApiProperty({ example: 'Ada Ventures' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  organizationName!: string;
}
