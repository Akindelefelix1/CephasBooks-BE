import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { SignOptions } from 'jsonwebtoken';
import { PrismaService } from '../../database/prisma.service.ts';
import { MailService } from '../mail/mail.service.ts';
import {
  accountVerifiedEmailTemplate,
  verificationEmailTemplate,
} from '../mail/templates/auth-email.templates.ts';
import { LoginDto } from './dto/login.dto.ts';
import { RegisterDto } from './dto/register.dto.ts';
import { VerifyEmailDto } from './dto/verify-email.dto.ts';
import { UpdateProfileDto } from './dto/update-profile.dto.ts';

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
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
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
      await this.createAndSendVerificationCode(
        result.user.id,
        email,
        result.organization.name,
        result.organization.name,
      );
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

  async getProfile(userId: string, organizationId: string, role: string) {
    const [user, organization] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { firstName: true, lastName: true, email: true, createdAt: true, isActive: true },
      }),
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { name: true, baseCurrency: true, countryCode: true },
      }),
    ]);
    return { ...user, role, organization };
  }

  async updateProfile(userId: string, organizationId: string, role: string, dto: UpdateProfileDto) {
    const profile = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.firstName !== undefined ? { firstName: dto.firstName.trim() || null } : {}),
        ...(dto.lastName !== undefined ? { lastName: dto.lastName.trim() || null } : {}),
      },
      select: { firstName: true, lastName: true, email: true, createdAt: true, isActive: true },
    });
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true, baseCurrency: true, countryCode: true },
    });
    return { ...profile, role, organization };
  }

  async verifyEmail(dto: VerifyEmailDto): Promise<Tokens> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        memberships: { take: 1, include: { organization: { select: { name: true } } } },
      },
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
    try {
      await this.mail.send({
        to: user.email,
        subject: 'Your Cephas Books account is verified',
        html: accountVerifiedEmailTemplate({
          firstName: user.firstName ?? membership.organization.name,
          organizationName: membership.organization.name,
          appUrl: this.config.get<string>('FRONTEND_URL') ?? 'https://cephas-books.onrender.com',
        }),
      });
    } catch (error) {
      this.logger.warn(
        `Account verified, but confirmation email failed for user ${user.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return this.issueTokens(user.id, user.email, membership.organizationId, membership.role);
  }

  async resendVerification(rawEmail: string): Promise<{ message: string; expiresIn: number }> {
    const email = rawEmail.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        memberships: { take: 1, include: { organization: { select: { name: true } } } },
      },
    });
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
    await this.createAndSendVerificationCode(
      user.id,
      email,
      user.firstName ?? user.memberships[0]?.organization.name ?? 'there',
      user.memberships[0]?.organization.name ?? 'your organisation',
    );
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

  private async createAndSendVerificationCode(
    userId: string,
    email: string,
    firstName: string,
    organizationName: string,
  ): Promise<void> {
    const code = randomInt(100000, 1000000).toString();
    const now = new Date();
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        verificationCodeHash: this.hashToken(code),
        verificationCodeExpiresAt: new Date(now.getTime() + 10 * 60_000),
      },
    });
    await this.mail.send({
      to: email,
      subject: `${firstName}, verify your Cephas Books account`,
      html: verificationEmailTemplate({
        firstName,
        organizationName,
        code,
        appUrl: this.config.get<string>('FRONTEND_URL') ?? 'https://cephas-books.onrender.com',
      }),
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: { verificationCodeSentAt: now },
    });
  }
}
