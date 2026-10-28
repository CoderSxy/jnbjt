import type { SmsProvider, SmsPurpose, SmsSendResult } from './types.js';
import { SmsNotConfiguredError } from './types.js';

export type AliyunSmsConfig = {
  accessKeyId: string;
  accessKeySecret: string;
  signName: string;
  templateCode: string;
  region?: string;
};

/**
 * Stub for future `@alicloud/dysmsapi20170525` integration.
 * Nero will wire credentials later; no SDK calls in this repo yet.
 */
export class AliyunSmsProvider implements SmsProvider {
  readonly name = 'aliyun';

  constructor(private readonly config: AliyunSmsConfig) {}

  static fromEnv(): AliyunSmsProvider {
    const accessKeyId = process.env.ALIYUN_SMS_ACCESS_KEY_ID?.trim() ?? '';
    const accessKeySecret = process.env.ALIYUN_SMS_ACCESS_KEY_SECRET?.trim() ?? '';
    const signName = process.env.ALIYUN_SMS_SIGN_NAME?.trim() ?? '';
    const templateCode = process.env.ALIYUN_SMS_TEMPLATE_CODE?.trim() ?? '';
    if (!accessKeyId || !accessKeySecret || !signName || !templateCode) {
      throw new SmsNotConfiguredError(
        'ALIYUN_SMS_ACCESS_KEY_ID/SECRET/SIGN_NAME/TEMPLATE_CODE required for SMS_PROVIDER=aliyun',
      );
    }
    return new AliyunSmsProvider({
      accessKeyId,
      accessKeySecret,
      signName,
      templateCode,
      region: process.env.ALIYUN_SMS_REGION?.trim() || 'cn-hangzhou',
    });
  }

  async sendVerificationCode(
    _phone: string,
    _code: string,
    _purpose: SmsPurpose,
  ): Promise<SmsSendResult> {
    throw new SmsNotConfiguredError(
      'AliyunSmsProvider stub: install SDK and implement SendSmsRequest when credentials are ready',
    );
  }
}
