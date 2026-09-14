import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.ts';
import { AuthService } from './auth.service.ts';
import { LoginDto } from './dto/login.dto.ts';
import { RefreshDto } from './dto/refresh.dto.ts';
import { RegisterDto } from './dto/register.dto.ts';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post('register') register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }
  @HttpCode(HttpStatus.OK) @Post('login') login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }
  @HttpCode(HttpStatus.OK) @Post('refresh') refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }
  @HttpCode(HttpStatus.NO_CONTENT) @Post('logout') logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }
  @ApiBearerAuth() @UseGuards(AuthGuard('jwt')) @Get('me') me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
