import type { SmsProvider, SmsPurpose, SmsSendResult } from './types.js';

export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock';
  lastSent: { phone: string; code: string; purpose: SmsPurpose } | null = null;

  async sendVerificationCode(
    phone: string,
    code: string,
    purpose: SmsPurpose,
  ): Promise<SmsSendResult> {
    this.lastSent = { phone, code, purpose };
    if (process.env.NODE_ENV !== 'test') {
      console.error(`[mock-sms] ${purpose} → ${phone}: ${code}`);
    }
    return { provider: this.name, messageId: `mock-${Date.now()}` };
  }
}
