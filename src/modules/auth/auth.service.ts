import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { SignOptions } from 'jsonwebtoken';
import { PrismaService } from '../../database/prisma.service.ts';
import { LoginDto } from './dto/login.dto.ts';
import { RegisterDto } from './dto/register.dto.ts';
import { VerifyEmailDto } from './dto/verify-email.dto.ts';
import { VerificationEmailService } from './verification-email.service.ts';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface VerificationPending {
  email: string;
  verificationRequired: true;
  expiresIn: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly verificationEmail: VerificationEmailService,
  ) {}

  async register(dto: RegisterDto): Promise<VerificationPending> {
    const email = dto.email.trim().toLowerCase();
    const slug = `${dto.organizationName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')}-${randomBytes(3).toString('hex')}`;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            passwordHash: await argon2.hash(dto.password),
            firstName: dto.firstName.trim(),
            lastName: dto.lastName.trim(),
          },
        });
        const organization = await tx.organization.create({
          data: { name: dto.organizationName.trim(), slug },
        });
        await tx.membership.create({
          data: { userId: user.id, organizationId: organization.id, role: Role.OWNER },
        });
        return { user, organization };
      });
      await this.createAndSendVerificationCode(result.user.id, email);
      return { email, verificationRequired: true, expiresIn: 600 };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Email is already registered');
      throw error;
    }
  }

  async login(dto: LoginDto): Promise<Tokens> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
      include: { memberships: { take: 1 } },
    });
    const valid = user && user.isActive && (await argon2.verify(user.passwordHash, dto.password));
    const membership = user?.memberships[0];
    if (!valid || !user || !membership) throw new UnauthorizedException('Invalid credentials');
    if (!user.verifiedAt) throw new ForbiddenException('Email verification required');
    return this.issueTokens(user.id, user.email, membership.organizationId, membership.role);
  }

  async verifyEmail(dto: VerifyEmailDto): Promise<Tokens> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { memberships: { take: 1 } },
    });
    const membership = user?.memberships[0];
    const valid =
      user?.verificationCodeHash === this.hashToken(dto.code) &&
      user.verificationCodeExpiresAt &&
      user.verificationCodeExpiresAt > new Date();
    if (!user || !membership || !valid) {
      throw new UnauthorizedException('The verification code is invalid or has expired');
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        verifiedAt: user.verifiedAt ?? new Date(),
        verificationCodeHash: null,
        verificationCodeExpiresAt: null,
      },
    });
    return this.issueTokens(user.id, user.email, membership.organizationId, membership.role);
  }

  async resendVerification(rawEmail: string): Promise<{ message: string; expiresIn: number }> {
    const email = rawEmail.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    const message = 'If this email needs verification, a new code has been sent.';
    if (!user || user.verifiedAt) return { message, expiresIn: 600 };
    if (
      user.verificationCodeSentAt &&
      Date.now() - user.verificationCodeSentAt.getTime() < 60_000
    ) {
      throw new HttpException(
        'Please wait before requesting another code',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    await this.createAndSendVerificationCode(user.id, email);
    return { message, expiresIn: 600 };
  }

  async refresh(rawToken: string): Promise<Tokens> {
    let payload: { sub: string; sid: string; organizationId: string; email: string; role: Role };
    try {
      payload = await this.jwt.verifyAsync(rawToken, {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const session = await this.prisma.session.findUnique({ where: { id: payload.sid } });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.refreshTokenHash !== this.hashToken(rawToken)
    )
      throw new UnauthorizedException('Refresh token is no longer valid');
    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    return this.issueTokens(payload.sub, payload.email, payload.organizationId, payload.role);
  }

  async logout(rawToken: string): Promise<void> {
    try {
      const payload = await this.jwt.verifyAsync<{ sid: string }>(rawToken, {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
      });
      await this.prisma.session.updateMany({
        where: { id: payload.sid, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } catch {
      /* Logout remains idempotent. */
    }
  }

  private async issueTokens(
    userId: string,
    email: string,
    organizationId: string,
    role: Role,
  ): Promise<Tokens> {
    const session = await this.prisma.session.create({
      data: { userId, refreshTokenHash: 'pending', expiresAt: new Date(Date.now() + 7 * 86400000) },
    });
    const claims = { sub: userId, email, organizationId, role };
    const accessToken = await this.jwt.signAsync(claims, {
      secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
      expiresIn: (this.config.get<string>('JWT_ACCESS_TTL') ?? '15m') as SignOptions['expiresIn'],
    });
    const refreshToken = await this.jwt.signAsync(
      { ...claims, sid: session.id },
      {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
        expiresIn: (this.config.get<string>('JWT_REFRESH_TTL') ?? '7d') as SignOptions['expiresIn'],
      },
    );
    await this.prisma.session.update({
      where: { id: session.id },
      data: { refreshTokenHash: this.hashToken(refreshToken) },
    });
    return { accessToken, refreshToken, expiresIn: 900 };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async createAndSendVerificationCode(userId: string, email: string): Promise<void> {
    const code = randomInt(100000, 1000000).toString();
    const now = new Date();
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        verificationCodeHash: this.hashToken(code),
        verificationCodeExpiresAt: new Date(now.getTime() + 10 * 60_000),
      },
    });
    await this.verificationEmail.sendCode(email, code);
    await this.prisma.user.update({
      where: { id: userId },
      data: { verificationCodeSentAt: now },
    });
  }
}
