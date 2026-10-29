import { MockSmsProvider } from './mock.js';
import { AliyunSmsProvider } from './aliyun-stub.js';
import type { SmsProvider } from './types.js';
import { SmsNotConfiguredError } from './types.js';

let singleton: SmsProvider | null = null;

export function createSmsProvider(): SmsProvider {
  const kind = (process.env.SMS_PROVIDER ?? 'mock').toLowerCase();
  if (kind === 'mock') return new MockSmsProvider();
  if (kind === 'aliyun') return AliyunSmsProvider.fromEnv();
  throw new SmsNotConfiguredError(`unknown SMS_PROVIDER: ${kind}`);
}

export function getSmsProvider(): SmsProvider {
  if (!singleton) singleton = createSmsProvider();
  return singleton;
}

/** Test hook */
export function resetSmsProviderForTests(): void {
  singleton = null;
}

export function shouldExposeMockCodeInResponse(): boolean {
  if (process.env.SMS_MOCK_EXPOSE_CODE === 'true') return true;
  return process.env.NODE_ENV === 'test';
}
