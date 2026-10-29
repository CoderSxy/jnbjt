export type SmsPurpose = 'login' | 'register';

export type SmsSendResult = {
  provider: string;
  messageId?: string;
};

export class SmsNotConfiguredError extends Error {
  constructor(message = 'SMS provider not configured') {
    super(message);
    this.name = 'SmsNotConfiguredError';
  }
}

export interface SmsProvider {
  readonly name: string;
  sendVerificationCode(phone: string, code: string, purpose: SmsPurpose): Promise<SmsSendResult>;
}
