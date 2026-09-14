import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service.ts';
import { PrismaService } from '../../database/prisma.service.ts';

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
      ],
    }).compile();
    await expect(
      module.get(AuthService).login({ email: 'nobody@example.com', password: 'incorrect' }),
    ).rejects.toThrow('Invalid credentials');
  });
});
