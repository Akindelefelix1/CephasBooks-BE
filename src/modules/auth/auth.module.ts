import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller.ts';
import { AuthService } from './auth.service.ts';
import { JwtStrategy } from './jwt.strategy.ts';
import { VerificationEmailService } from './verification-email.service.ts';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({ inject: [ConfigService], useFactory: () => ({}) }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, VerificationEmailService],
  exports: [AuthService],
})
export class AuthModule {}
