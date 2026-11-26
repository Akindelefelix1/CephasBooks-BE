import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import webpush from 'web-push';
import { MailService } from '../mail/mail.service.ts';
import { PrismaService } from '../../database/prisma.service.ts';

type Reminder = {
  organizationId: string;
  recipientId: string;
  title: string;
  message: string;
  category: 'FINANCIAL';
  relatedType: 'INVOICE' | 'BILL';
  relatedId: string;
  dedupeKey: string;
};

@Injectable()
export class DueDateNotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DueDateNotificationsService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private pushReady = false;

  constructor(
    private readonly db: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.configurePush();
    this.timer = setInterval(() => void this.runSafely(), 60 * 60 * 1000);
    this.timer.unref?.();
    setTimeout(() => void this.runSafely(), 15_000).unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private configurePush() {
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY');
    const subject = this.config.get<string>('VAPID_SUBJECT') || 'mailto:support@cephasbooks.com';
    if (!publicKey || !privateKey) return;
    try {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      this.pushReady = true;
    } catch (error) {
      this.logger.error(
        'Push notifications are disabled because VAPID configuration is invalid',
        error,
      );
    }
  }

  private async runSafely() {
    if (this.running) return;
    this.running = true;
    try {
      await this.db.$transaction(
        async (tx) => {
          const locks = await tx.$queryRaw<Array<{ locked: boolean }>>`
          SELECT pg_try_advisory_xact_lock(hashtext('cephas_due_date_notifications')) AS locked
        `;
          if (!locks[0]?.locked) return;
          await this.generateReminders(tx);
        },
        { timeout: 120_000 },
      );
      await this.deliverPending();
    } catch (error) {
      this.logger.error(
        'Due date reminder cycle failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running = false;
    }
  }

  private async generateReminders(tx: Prisma.TransactionClient) {
    const organizations = await tx.organization.findMany({
      select: { id: true, baseCurrency: true, onboardingData: true },
    });
    const reminders: Reminder[] = [];

    for (const organization of organizations) {
      const data = organization.onboardingData as Record<string, any> | null;
      const timezone = data?.financial?.timezone || 'UTC';
      const today = this.localDate(timezone);
      const members = await tx.membership.findMany({
        where: { organizationId: organization.id, user: { isActive: true } },
        select: {
          userId: true,
          role: true,
          user: { select: { email: true } },
          customRole: { select: { permissions: true } },
        },
      });
      const receivableUsers = members.filter(
        (m) =>
          (!m.customRole && ['OWNER', 'ADMIN', 'ACCOUNTANT'].includes(m.role)) ||
          this.hasPermission(m.customRole?.permissions, 'sales.view'),
      );
      const payableUsers = members.filter(
        (m) =>
          (!m.customRole && ['OWNER', 'ADMIN', 'ACCOUNTANT'].includes(m.role)) ||
          this.hasPermission(m.customRole?.permissions, 'purchases.view'),
      );
      if (!receivableUsers.length && !payableUsers.length) continue;

      if (receivableUsers.length) {
        const invoices = await tx.invoice.findMany({
          where: {
            organizationId: organization.id,
            status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] },
          },
          select: {
            id: true,
            number: true,
            dueDate: true,
            currency: true,
            total: true,
            paidAmount: true,
            creditedAmount: true,
            customer: { select: { displayName: true } },
          },
        });
        for (const invoice of invoices) {
          const outstanding = Math.max(
            0,
            Number(invoice.total) - Number(invoice.paidAmount) - Number(invoice.creditedAmount),
          );
          if (outstanding <= 0) continue;
          const stage = this.stage(today, this.dateOnly(invoice.dueDate));
          if (!stage) continue;
          const amount = this.money(outstanding, invoice.currency || organization.baseCurrency);
          const name = invoice.customer.displayName || 'Customer';
          const detail = this.stageText(stage);
          const message = `${name} · Invoice ${invoice.number} · ${amount} outstanding · Due ${this.dateOnly(invoice.dueDate)}. ${detail}`;
          for (const recipient of receivableUsers)
            reminders.push({
              organizationId: organization.id,
              recipientId: recipient.userId,
              title: stage.startsWith('OVERDUE')
                ? 'Customer invoice overdue'
                : 'Customer invoice due soon',
              message,
              category: 'FINANCIAL',
              relatedType: 'INVOICE',
              relatedId: invoice.id,
              dedupeKey: `due:${organization.id}:invoice:${invoice.id}:${stage}:${recipient.userId}`,
            });
        }
      }

      if (payableUsers.length) {
        const bills = await tx.bill.findMany({
          where: {
            organizationId: organization.id,
            status: { in: ['APPROVED', 'PARTIALLY_PAID', 'OVERDUE'] },
          },
          select: {
            id: true,
            number: true,
            dueDate: true,
            currency: true,
            total: true,
            paidAmount: true,
            supplier: { select: { displayName: true } },
          },
        });
        for (const bill of bills) {
          const outstanding = Math.max(0, Number(bill.total) - Number(bill.paidAmount));
          if (outstanding <= 0) continue;
          const stage = this.stage(today, this.dateOnly(bill.dueDate));
          if (!stage) continue;
          const amount = this.money(outstanding, bill.currency || organization.baseCurrency);
          const name = bill.supplier.displayName || 'Supplier';
          const detail = this.stageText(stage);
          const message = `${name} · Bill ${bill.number} · ${amount} outstanding · Due ${this.dateOnly(bill.dueDate)}. ${detail}`;
          for (const recipient of payableUsers)
            reminders.push({
              organizationId: organization.id,
              recipientId: recipient.userId,
              title: stage.startsWith('OVERDUE')
                ? 'Supplier bill overdue'
                : 'Supplier bill due soon',
              message,
              category: 'FINANCIAL',
              relatedType: 'BILL',
              relatedId: bill.id,
              dedupeKey: `due:${organization.id}:bill:${bill.id}:${stage}:${recipient.userId}`,
            });
        }
      }
    }
    if (reminders.length) {
      await tx.appNotification.createMany({
        data: reminders.map(({ dedupeKey, ...item }) => ({ ...item, dedupeKey })),
        skipDuplicates: true,
      });
    }
  }

  private async deliverPending() {
    const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const pending = await this.db.appNotification.findMany({
      where: {
        category: 'FINANCIAL',
        dedupeKey: { startsWith: 'due:' },
        recipientId: { not: null },
        OR: [
          {
            emailSentAt: null,
            OR: [{ emailAttemptedAt: null }, { emailAttemptedAt: { lt: cutoff } }],
          },
          ...(this.pushReady
            ? [
                {
                  pushSentAt: null,
                  OR: [{ pushAttemptedAt: null }, { pushAttemptedAt: { lt: cutoff } }],
                },
              ]
            : []),
        ],
      },
      include: {
        recipient: { select: { id: true, email: true } },
        organization: { select: { name: true } },
      },
      take: 100,
      orderBy: { createdAt: 'asc' },
    });
    for (const item of pending) {
      if (!item.recipient) continue;
      if (!item.emailSentAt && (!item.emailAttemptedAt || item.emailAttemptedAt < cutoff)) {
        const claimed = await this.db.appNotification.updateMany({
          where: {
            id: item.id,
            emailSentAt: null,
            OR: [{ emailAttemptedAt: null }, { emailAttemptedAt: { lt: cutoff } }],
          },
          data: { emailAttemptedAt: new Date(), emailLastError: null },
        });
        if (claimed.count) {
          try {
            const url =
              this.config.get<string>('FRONTEND_URL') || this.config.get<string>('APP_URL') || '';
            const link = url ? `${url.replace(/\/$/, '')}/notifications` : '';
            await this.mail.send({
              to: item.recipient.email,
              subject: item.title,
              html: `<p>${this.escapeHtml(item.message)}</p>${link ? `<p><a href="${this.escapeHtml(link)}">Open Cephas Books</a></p>` : ''}<p>${this.escapeHtml(item.organization.name)}</p>`,
            });
            await this.db.appNotification.update({
              where: { id: item.id },
              data: { emailSentAt: new Date(), emailLastError: null },
            });
          } catch (error) {
            const message =
              error instanceof Error ? error.message.slice(0, 500) : 'Email delivery failed';
            await this.db.appNotification.update({
              where: { id: item.id },
              data: { emailLastError: message },
            });
            this.logger.warn(`Email reminder ${item.id} failed: ${message}`);
          }
        }
      }
      if (
        this.pushReady &&
        !item.pushSentAt &&
        (!item.pushAttemptedAt || item.pushAttemptedAt < cutoff)
      ) {
        const claimed = await this.db.appNotification.updateMany({
          where: {
            id: item.id,
            pushSentAt: null,
            OR: [{ pushAttemptedAt: null }, { pushAttemptedAt: { lt: cutoff } }],
          },
          data: { pushAttemptedAt: new Date(), pushLastError: null },
        });
        if (claimed.count)
          await this.sendPush(item.id, item.organizationId, item.recipientId!, {
            title: item.title,
            body: item.message,
            url: '/notifications',
          });
      }
    }
  }

  private async sendPush(
    notificationId: string,
    organizationId: string,
    userId: string,
    payload: { title: string; body: string; url: string },
  ) {
    const subscriptions = await this.db.pushSubscription.findMany({
      where: { organizationId, userId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    if (!subscriptions.length) {
      await this.db.appNotification.update({
        where: { id: notificationId },
        data: { pushSentAt: new Date() },
      });
      return;
    }
    const errors: string[] = [];
    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            },
            JSON.stringify(payload),
          );
        } catch (error: any) {
          if (error?.statusCode === 404 || error?.statusCode === 410) {
            await this.db.pushSubscription
              .delete({ where: { id: subscription.id } })
              .catch(() => undefined);
          } else errors.push(String(error?.message || 'Push delivery failed').slice(0, 400));
        }
      }),
    );
    await this.db.appNotification.update({
      where: { id: notificationId },
      data: errors.length
        ? { pushLastError: errors.join('; ').slice(0, 500) }
        : { pushSentAt: new Date(), pushLastError: null },
    });
  }

  private hasPermission(value: unknown, permission: string) {
    return Array.isArray(value) && value.includes(permission);
  }
  private localDate(timezone: string): string {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date());
      const part = (type: string) => parts.find((p) => p.type === type)?.value || '';
      return `${part('year')}-${part('month')}-${part('day')}`;
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  }
  private dateOnly(value: Date): string {
    return value.toISOString().slice(0, 10);
  }
  private stage(today: string, due: string): string | null {
    const days = Math.round(
      (Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
    );
    if (days > 7) return null;
    if (days < -1)
      return Math.floor((-days - 1) / 7) !== Math.floor((-days - 2) / 7)
        ? `OVERDUE_${Math.floor((-days - 1) / 7)}`
        : null;
    if (days < 0) return 'OVERDUE_0';
    if (days === 0) return 'DUE_TODAY';
    if (days === 1) return 'DUE_TOMORROW';
    return days === 2 ? 'UPCOMING_2' : null;
  }
  private stageText(stage: string) {
    if (stage === 'DUE_TODAY') return 'Due today.';
    if (stage === 'DUE_TOMORROW') return 'Due tomorrow.';
    if (stage.startsWith('UPCOMING_')) return `Due in ${stage.slice(9)} days.`;
    const days = stage === 'OVERDUE_0' ? 1 : Number(stage.slice(8)) * 7 + 1;
    return `Overdue by ${days}+ day${days === 1 ? '' : 's'}.`;
  }
  private money(amount: number, currency: string) {
    try {
      return new Intl.NumberFormat('en', { style: 'currency', currency: currency.trim() }).format(
        amount,
      );
    } catch {
      return `${currency.trim()} ${amount.toFixed(2)}`;
    }
  }
  private escapeHtml(value: string) {
    return value.replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
    );
  }
}
