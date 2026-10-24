import { checkSourceUrl } from './policy.js';

export type WikiFetchResult = {
  status: number;
  headers: Headers;
  bodyText: string;
  finalUrl: string;
  redirected: boolean;
};

export type WikiGetOptions = {
  allowedOrigin?: string;
  allowedWikiPath?: string;
  robotsText?: string;
};

export type WikiClientOptions = {
  userAgent: string;
  timeoutMs: number;
  maxRetries: number;
  minIntervalMs: number;
  jitterMs: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class WikiClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly minIntervalMs: number;
  private readonly jitterMs: number;
  private nextAllowedAt = 0;
  private requestCount = 0;

  constructor(options: WikiClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? (() => Date.now());
    this.random = options.random ?? Math.random;
    this.userAgent = options.userAgent;
    this.timeoutMs = options.timeoutMs;
    this.maxRetries = options.maxRetries;
    this.minIntervalMs = options.minIntervalMs;
    this.jitterMs = options.jitterMs;
  }

  getRequestCount(): number {
    return this.requestCount;
  }

  async get(url: string, options: WikiGetOptions = {}): Promise<WikiFetchResult> {
    let attempt = 0;
    let networkFailures = 0;

    while (true) {
      await this.waitForSlot();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      this.requestCount += 1;

      try {
        const response = await this.fetchImpl(url, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'user-agent': this.userAgent,
            accept: 'application/json,text/plain,*/*',
          },
        });

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) {
            throw new Error(`redirect without location from ${url}`);
          }
          const next = new URL(location, url);
          this.assertRedirectAllowed(next, options);
          // Follow one hop at a time under allowlist; count as new attempt budget separately.
          url = next.toString();
          continue;
        }

        if (response.status === 403) {
          throw new Error(`403 forbidden — stop source: ${url}`);
        }

        if (response.status === 429) {
          if (attempt >= this.maxRetries) {
            throw new Error(`429 too many requests after ${attempt} retries: ${url}`);
          }
          const retryAfter = parseRetryAfter(response.headers.get('retry-after'), this.now());
          attempt += 1;
          await this.sleep(retryAfter);
          continue;
        }

        // 5xx and unusual edge statuses (e.g. bilibili CDN 567) are retriable with cap.
        if (response.status >= 500 || response.status === 567) {
          if (networkFailures >= this.maxRetries) {
            throw new Error(`${response.status} after ${networkFailures} retries: ${url}`);
          }
          networkFailures += 1;
          await this.sleep(backoffMs(networkFailures));
          continue;
        }

        const bodyText = await response.text();
        return {
          status: response.status,
          headers: response.headers,
          bodyText,
          finalUrl: url,
          redirected: false,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/403 forbidden|redirect/i.test(message)) throw error;
        if (networkFailures >= this.maxRetries) {
          throw new Error(`network/timeout after ${networkFailures} retries: ${message}`);
        }
        networkFailures += 1;
        await this.sleep(backoffMs(networkFailures));
      } finally {
        clearTimeout(timer);
      }
    }
  }

  private assertRedirectAllowed(next: URL, options: WikiGetOptions): void {
    if (!options.allowedOrigin || !options.allowedWikiPath) {
      throw new Error(`redirect blocked (no allowlist): ${next.toString()}`);
    }
    const check = checkSourceUrl(
      next,
      options.robotsText ?? 'User-agent: *\nAllow: /\n',
      { origin: options.allowedOrigin, wikiPath: options.allowedWikiPath },
    );
    if (!check.allowed) {
      throw new Error(`redirect leaves allowlist origin/path: ${next.toString()} (${check.reason})`);
    }
  }

  private async waitForSlot(): Promise<void> {
    const now = this.now();
    const jitter = this.jitterMs > 0 ? Math.floor(this.random() * this.jitterMs) : 0;
    const earliest = this.nextAllowedAt;
    if (earliest > now) {
      await this.sleep(earliest - now);
    }
    this.nextAllowedAt = this.now() + this.minIntervalMs + jitter;
  }
}

function parseRetryAfter(header: string | null, nowMs: number): number {
  if (!header) return 1000;
  const asInt = Number(header);
  if (Number.isFinite(asInt) && asInt >= 0) {
    // Retry-After as seconds
    return Math.ceil(asInt * 1000);
  }
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - nowMs);
  }
  return 1000;
}

function backoffMs(attempt: number): number {
  return Math.min(8_000, 250 * 2 ** (attempt - 1));
}
