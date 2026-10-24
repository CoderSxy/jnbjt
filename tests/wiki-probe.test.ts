import { describe, expect, it, vi } from 'vitest';
import { WikiClient, probeWiki, type ProbeConfig } from '@jnbjt/knowledge-import';

const ORIGIN = 'https://wiki.biligame.com';
const WIKI_PATH = '/jiangnan';

const ROBOTS = `User-agent: *
Disallow: /*index.php?*
Disallow: /*oldid=*
Allow: /
`;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  });
}

function baseConfig(fetchImpl: typeof fetch): ProbeConfig {
  return {
    origin: ORIGIN,
    wikiPath: WIKI_PATH,
    seeds: [
      { title: '首页', kind: 'home' },
      { title: '农田', kind: 'building' },
    ],
    limit: 2,
    userAgent: 'jnbjt-planner-probe-test/0.1 (local unit test; no contact)',
    minIntervalMs: 0,
    jitterMs: 0,
    timeoutMs: 20_000,
    maxRetries: 3,
    fetchImpl,
    sleep: async () => undefined,
    now: () => 0,
  };
}

describe('WikiClient rate limits and stop conditions', () => {
  it('reads Retry-After on 429 and does not retry without bound', async () => {
    const calls: string[] = [];
    const sleep = vi.fn(async (_ms: number) => undefined);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (calls.length === 1) {
        return new Response('slow down', {
          status: 429,
          headers: { 'retry-after': '7' },
        });
      }
      return jsonResponse({ ok: true });
    }) as unknown as typeof fetch;

    const client = new WikiClient({
      userAgent: 'test',
      timeoutMs: 20_000,
      maxRetries: 3,
      minIntervalMs: 0,
      jitterMs: 0,
      fetchImpl,
      sleep,
      now: () => 0,
      random: () => 0,
    });

    const result = await client.get(`${ORIGIN}${WIKI_PATH}/api.php?action=query`);
    expect(result.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(7000);
  });

  it('stops on 403 and does not enter unbounded retries', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return new Response('forbidden', { status: 403 });
    }) as unknown as typeof fetch;

    const client = new WikiClient({
      userAgent: 'test',
      timeoutMs: 20_000,
      maxRetries: 3,
      minIntervalMs: 0,
      jitterMs: 0,
      fetchImpl,
      sleep: async () => undefined,
      now: () => 0,
      random: () => 0,
    });

    await expect(client.get(`${ORIGIN}${WIKI_PATH}/api.php`)).rejects.toThrow(/403|forbidden|stop/i);
    expect(calls).toBe(1);
  });

  it('rejects redirects that leave the allowlisted origin/path', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('', {
        status: 302,
        headers: { location: 'https://evil.example/steal' },
      }),
    ) as unknown as typeof fetch;

    const client = new WikiClient({
      userAgent: 'test',
      timeoutMs: 20_000,
      maxRetries: 0,
      minIntervalMs: 0,
      jitterMs: 0,
      fetchImpl,
      sleep: async () => undefined,
      now: () => 0,
      random: () => 0,
    });

    await expect(
      client.get(`${ORIGIN}${WIKI_PATH}/农田`, {
        allowedOrigin: ORIGIN,
        allowedWikiPath: WIKI_PATH,
        robotsText: ROBOTS,
      }),
    ).rejects.toThrow(/redirect|origin|allowlist/i);
  });
});

describe('probeWiki', () => {
  it('records API capability, samples, and rejects disallowed URLs without live network', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/robots.txt') || url.includes('/robots.txt')) {
        return new Response(ROBOTS, { status: 200 });
      }
      if (url.includes('meta=siteinfo')) {
        return jsonResponse({
          query: { general: { generator: 'MediaWiki 1.37.0' } },
        });
      }
      if (url.includes('action=parse') && url.includes(encodeURIComponent('首页'))) {
        return jsonResponse({
          parse: {
            title: '首页',
            pageid: 1,
            revid: 100,
            text: { '*': '<div>许可 CC BY-NC-SA<div class="mw-parser-output"><p>首页</p></div>' },
          },
        });
      }
      if (url.includes('action=parse') && url.includes(encodeURIComponent('农田'))) {
        return jsonResponse({
          parse: {
            title: '农田',
            pageid: 2,
            revid: 64284,
            text: {
              '*': '<table><tr><th>产出</th><td>15+60</td></tr><tr><th>城市</th><td>应天府</td></tr></table>',
            },
          },
        });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    const report = await probeWiki(baseConfig(fetchImpl));
    expect(report.apiCapabilities.siteinfo).toBe(true);
    expect(report.apiCapabilities.parse).toBe(true);
    expect(report.apiCapabilities.mediaWikiVersion).toContain('1.37');
    expect(report.samples.length).toBeGreaterThanOrEqual(2);
    expect(report.robotsChecked).toBe(true);
    expect(report.requestCount).toBeGreaterThan(0);

    const farm = report.samples.find((s) => s.title === '农田');
    expect(farm?.revision).toBe(64284);
    expect(farm?.hasTables).toBe(true);
    expect(farm?.applicableCities).toContain('应天府');
  });

  it('surfaces MediaWiki API JSON error without inventing page data', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/robots.txt')) return new Response(ROBOTS, { status: 200 });
      if (url.includes('meta=siteinfo')) {
        return jsonResponse({
          query: { general: { generator: 'MediaWiki 1.37.0' } },
        });
      }
      if (url.includes('action=parse')) {
        return jsonResponse({
          error: { code: 'missingtitle', info: 'The page you specified does not exist.' },
        });
      }
      return new Response('no', { status: 404 });
    }) as unknown as typeof fetch;

    const report = await probeWiki({
      ...baseConfig(fetchImpl),
      seeds: [{ title: '不存在的建筑', kind: 'building' }],
      limit: 1,
    });

    expect(report.samples[0]?.allowed).toBe(false);
    expect(report.samples[0]?.rejectReason).toMatch(/missingtitle|does not exist|API/i);
    expect(report.samples[0]?.revision).toBeUndefined();
    expect(report.gaps.some((g) => /不存在的建筑|missingtitle/i.test(g))).toBe(true);
  });
});
