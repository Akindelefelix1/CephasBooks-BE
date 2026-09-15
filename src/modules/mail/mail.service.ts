import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  async send(input: SendMailInput): Promise<void> {
    const url = this.config.get<string>('ZOHO_MAIL_API_URL');
    const token = this.config.get<string>('ZOHO_MAIL_API_TOKEN');
    const from = this.config.get<string>('EMAIL_FROM');

    if (!url || !token || !from) {
      if (this.config.get('NODE_ENV') === 'production') {
        throw new ServiceUnavailableException('Email delivery is not configured');
      }
      this.logger.warn(`Email delivery is not configured; skipped email to ${input.to}`);
      return;
    }

    const response = url.toLowerCase().includes('zeptomail')
      ? await this.sendWithZeptoMail(url, token, from, input)
      : await this.sendWithZohoMail(url, token, from, input);

    if (!response.ok) {
      const providerMessage = await response.text();
      this.logger.error(
        `Zoho mail provider returned ${response.status}: ${providerMessage.slice(0, 1000)}`,
      );
      throw new ServiceUnavailableException('Unable to send email');
    }
  }

  private sendWithZohoMail(
    url: string,
    rawToken: string,
    from: string,
    input: SendMailInput,
  ): Promise<Response> {
    const token = rawToken.replace(/^Zoho-oauthtoken\s+/i, '').trim();
    return fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Zoho-oauthtoken ${token}`,
      },
      body: JSON.stringify({
        fromAddress: this.emailAddress(from),
        toAddress: input.to,
        subject: input.subject,
        content: input.html,
        mailFormat: 'html',
      }),
    });
  }

  private sendWithZeptoMail(
    url: string,
    rawToken: string,
    from: string,
    input: SendMailInput,
  ): Promise<Response> {
    const authorization = /^Zoho-enczapikey\s+/i.test(rawToken)
      ? rawToken.trim()
      : `Zoho-enczapikey ${rawToken.trim()}`;
    return fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: authorization,
      },
      body: JSON.stringify({
        from: { address: this.emailAddress(from), name: this.displayName(from) },
        to: [{ email_address: { address: input.to } }],
        subject: input.subject,
        htmlbody: input.html,
      }),
    });
  }

  private emailAddress(from: string): string {
    return from.match(/<([^>]+)>/)?.[1]?.trim() ?? from.trim();
  }

  private displayName(from: string): string {
    return from.includes('<') ? from.slice(0, from.indexOf('<')).trim() : 'Cephas Books';
  }
}
