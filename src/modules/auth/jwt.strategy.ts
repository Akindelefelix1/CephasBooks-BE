import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../database/prisma.service.ts';
import type { AuthUser } from '../../common/decorators/current-user.decorator.ts';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }
  async validate(payload: AuthUser): Promise<AuthUser> {
    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_organizationId: { userId: payload.sub, organizationId: payload.organizationId },
      },
      include: { user: true },
    });
    if (!membership?.user.isActive) throw new UnauthorizedException();
    return { ...payload, role: membership.role };
  }
}
