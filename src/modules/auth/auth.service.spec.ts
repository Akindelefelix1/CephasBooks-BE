import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service.ts';
import { PrismaService } from '../../database/prisma.service.ts';
import { MailService } from '../mail/mail.service.ts';

describe('AuthService', () => {
  it('rejects unknown credentials without revealing which field failed', async () => {
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: { user: { findUnique: jest.fn().mockResolvedValue(null) } },
        },
        { provide: JwtService, useValue: {} },
        { provide: ConfigService, useValue: {} },
        { provide: MailService, useValue: { send: jest.fn() } },
      ],
    }).compile();
    await expect(
      module.get(AuthService).login({ email: 'nobody@example.com', password: 'incorrect' }),
    ).rejects.toThrow('Invalid credentials');
  });

  it('allows a legacy invited user to sign in with their temporary password', async () => {
    const passwordHash = await import('argon2').then(({ hash }) => hash('Temporary!123'));
    const update = jest.fn().mockResolvedValue({});
    const service = new AuthService(
      {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'invited-user',
            email: 'staff@example.com',
            passwordHash,
            isActive: true,
            verifiedAt: null,
            mustChangePassword: true,
            memberships: [{ organizationId: 'org-a', role: 'MEMBER' }],
          }),
          update,
        },
        session: {
          create: jest.fn().mockResolvedValue({ id: 'session-a' }),
          update: jest.fn().mockResolvedValue({}),
        },
      } as never,
      {
        signAsync: jest
          .fn()
          .mockResolvedValueOnce('access-token')
          .mockResolvedValueOnce('refresh-token'),
      } as never,
      {
        getOrThrow: jest.fn().mockReturnValue('test-secret'),
        get: jest.fn().mockImplementation((key: string) =>
          key === 'JWT_ACCESS_TTL' ? '15m' : '7d',
        ),
      } as never,
      {} as never,
    );

    await expect(
      service.login({ email: 'staff@example.com', password: 'Temporary!123' }),
    ).resolves.toMatchObject({ accessToken: 'access-token', refreshToken: 'refresh-token' });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'invited-user' },
      data: { verifiedAt: expect.any(Date) as Date },
    });
  });

  it('rejects an incorrect email verification code', async () => {
    const service = new AuthService(
      {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'user-a',
            email: 'ada@example.com',
            verificationCodeHash: 'not-the-code-hash',
            verificationCodeExpiresAt: new Date(Date.now() + 60_000),
            memberships: [{ organizationId: 'org-a', role: 'OWNER' }],
          }),
        },
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.verifyEmail({ email: 'ada@example.com', code: '123456' })).rejects.toThrow(
      'invalid or has expired',
    );
  });

  it('throttles verification-code resends for one minute', async () => {
    const sendCode = jest.fn();
    const service = new AuthService(
      {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'user-a',
            email: 'ada@example.com',
            verifiedAt: null,
            verificationCodeSentAt: new Date(),
          }),
        },
      } as never,
      {} as never,
      {} as never,
      { sendCode } as never,
    );

    await expect(service.resendVerification('ada@example.com')).rejects.toThrow(
      'Please wait before requesting another code',
    );
    expect(sendCode).not.toHaveBeenCalled();
  });

  it('changes the password and records when it was changed', async () => {
    const argon2 = await import('argon2');
    const oldHash = await argon2.hash('Current!123');
    const changedAt = new Date('2026-10-01T12:00:00.000Z');
    const findUniqueOrThrow = jest
      .fn()
      .mockResolvedValueOnce({ id: 'user-a', passwordHash: oldHash })
      .mockResolvedValueOnce({ passwordChangedAt: changedAt });
    const transaction = jest.fn().mockResolvedValue([]);
    const service = new AuthService(
      {
        user: { findUniqueOrThrow, update: jest.fn() },
        session: { updateMany: jest.fn() },
        $transaction: transaction,
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.changePassword('user-a', {
        currentPassword: 'Current!123',
        newPassword: 'NewPassword!456',
      }),
    ).resolves.toEqual({ changed: true, passwordChangedAt: changedAt });
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
