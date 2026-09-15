import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service.ts';

@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
