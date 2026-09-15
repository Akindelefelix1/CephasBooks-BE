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
});
