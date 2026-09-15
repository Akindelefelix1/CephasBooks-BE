import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class VerificationEmailService {
  private readonly logger = new Logger(VerificationEmailService.name);

  constructor(private readonly config: ConfigService) {}

  async sendCode(email: string, code: string): Promise<void> {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    const from = this.config.get<string>('EMAIL_FROM');
    if (!apiKey || !from) {
      if (this.config.get('NODE_ENV') === 'production') {
        throw new ServiceUnavailableException('Verification email delivery is not configured');
      }
      this.logger.warn(`Email delivery is not configured; verification code for ${email}: ${code}`);
      return;
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [email],
        subject: 'Verify your Cephas Books email',
        html: `<p>Your Cephas Books verification code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>This code expires in 10 minutes.</p>`,
      }),
    });
    if (!response.ok) {
      const providerMessage = await response.text();
      this.logger.error(
        `Verification email provider returned ${response.status}: ${providerMessage.slice(0, 1000)}`,
      );
      throw new ServiceUnavailableException('Unable to send verification email');
    }
  }
}
