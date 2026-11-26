import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service.ts';

@Injectable()
export class PushSubscriptionsService {
  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService,
  ) {}

  configuration() {
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY');
    return {
      enabled: Boolean(publicKey && this.config.get<string>('VAPID_PRIVATE_KEY')),
      publicKey: publicKey || null,
    };
  }

  async subscribe(organizationId: string, userId: string, input: any) {
    if (
      !input ||
      typeof input.endpoint !== 'string' ||
      input.endpoint.length > 4096 ||
      !input.endpoint.startsWith('https://') ||
      typeof input.keys?.p256dh !== 'string' ||
      input.keys.p256dh.length > 512 ||
      typeof input.keys?.auth !== 'string' ||
      input.keys.auth.length > 512
    )
      throw new BadRequestException('A valid browser push subscription is required');
    const member = await this.db.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { id: true },
    });
    if (!member) throw new NotFoundException('Organization membership not found');
    const existing = await this.db.pushSubscription.findUnique({
      where: { endpoint: input.endpoint },
      select: { userId: true, organizationId: true },
    });
    if (existing && (existing.userId !== userId || existing.organizationId !== organizationId)) {
      throw new ForbiddenException(
        'This device subscription is already registered to another workspace user',
      );
    }
    return this.db.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: {
        organizationId,
        userId,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: typeof input.userAgent === 'string' ? input.userAgent.slice(0, 300) : null,
      },
      update: {
        organizationId,
        userId,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: typeof input.userAgent === 'string' ? input.userAgent.slice(0, 300) : null,
      },
      select: { id: true },
    });
  }

  async unsubscribe(userId: string, endpoint: string) {
    if (!endpoint) throw new BadRequestException('Subscription endpoint is required');
    const result = await this.db.pushSubscription.deleteMany({ where: { userId, endpoint } });
    return { removed: result.count > 0 };
  }
}
