import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { validateEnvironment } from './config/environment.ts';
import { DatabaseModule } from './database/database.module.ts';
import { AuthModule } from './modules/auth/auth.module.ts';
import { CustomersModule } from './modules/customers/customers.module.ts';
import { HealthModule } from './modules/health/health.module.ts';
import { InvoicesModule } from './modules/invoices/invoices.module.ts';
import { MailModule } from './modules/mail/mail.module.ts';
import { OrganizationsModule } from './modules/organizations/organizations.module.ts';
import { BankingModule } from './modules/banking/banking.module.ts';
import { SalesModule } from './modules/sales/sales.module.ts';
import { PurchasesModule } from './modules/purchases/purchases.module.ts';
import { AccountingModule } from './modules/accounting/accounting.module.ts';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnvironment }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', 'info'),
          redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'],
          transport:
            config.get('NODE_ENV') === 'development' ? { target: 'pino-pretty' } : undefined,
        },
      }),
    }),
    DatabaseModule,
    HealthModule,
    MailModule,
    AuthModule,
    OrganizationsModule,
    CustomersModule,
    InvoicesModule,
    BankingModule,
    SalesModule,
    PurchasesModule,
    AccountingModule,
  ],
})
export class AppModule {}
