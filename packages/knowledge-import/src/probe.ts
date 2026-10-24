import { WikiClient } from './client.js';
import { checkSourceUrl } from './policy.js';
import type {
  FieldCoverage,
  ProbeConfig,
  ProbeReport,
  ProbeSeed,
  SamplePageReport,
} from './types.js';

function apiUrl(origin: string, wikiPath: string, params: Record<string, string>): string {
  const url = new URL(`${wikiPath.replace(/\/$/, '')}/api.php`, origin);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function pageUrl(origin: string, wikiPath: string, title: string): string {
  const path = `${wikiPath.replace(/\/$/, '')}/${encodeURIComponent(title).replace(/%2F/gi, '/')}`;
  return new URL(path, origin).toString();
}

function extractCities(html: string): string[] {
  const cities = ['应天府', '苏州', '杭州', '扬州', '松江', '嘉兴', '湖州', '镇江'];
  return cities.filter((c) => html.includes(c));
}

function analyzeHtml(
  html: string,
  kind: ProbeSeed['kind'],
): {
  fieldCoverage: FieldCoverage[];
  missingFields: string[];
  hasTables: boolean;
  applicableCities: string[];
} {
  const hasTables = /<table[\s>]/i.test(html);
  const checks: FieldCoverage[] = [
    {
      field: 'tables',
      present: kind === 'home' ? true : hasTables,
      ...(hasTables || kind === 'home'
        ? {}
        : { notes: 'no <table> in parse HTML' }),
    },
    {
      field: 'production_expression',
      present:
        kind === 'building' || kind === 'category'
          ? /\d+\s*\+\s*\d+/.test(html) || /产出|产量|耗时|时间|生产/.test(html)
          : true,
    },
    {
      field: 'city_branch',
      present: kind === 'building' || kind === 'city' ? /应天府|苏州|杭州|扬州/.test(html) : true,
    },
  ];
  // License text usually lives in site chrome, not action=parse body.
  checks.push({
    field: 'license_notice_in_parse_html',
    present: /CC\s*BY-NC-SA|知识共享|署名/.test(html),
    notes: 'expected often absent in parse HTML; track site declaration separately',
  });
  const missingFields = checks
    .filter((c) => !c.present && c.field !== 'license_notice_in_parse_html')
    .map((c) => c.field);
  return {
    fieldCoverage: checks,
    missingFields,
    hasTables,
    applicableCities: extractCities(html),
  };
}

async function fetchRobots(
  client: WikiClient,
  origin: string,
  wikiPath: string,
): Promise<{ text: string; summary: string }> {
  const robotsUrl = new URL('/robots.txt', origin).toString();
  // robots.txt lives at site root — check origin only, not wikiPath.
  const result = await client.get(robotsUrl);
  if (result.status !== 200) {
    return {
      text: 'User-agent: *\nDisallow: /\n',
      summary: `robots.txt HTTP ${result.status}; default deny`,
    };
  }
  const disallowCount = (result.bodyText.match(/^Disallow:/gim) ?? []).length;
  return {
    text: result.bodyText,
    summary: `HTTP 200; ${disallowCount} Disallow rules; wikiPath=${wikiPath}`,
  };
}

async function probeSiteinfo(
  client: WikiClient,
  config: ProbeConfig,
  robotsText: string,
): Promise<{ ok: boolean; version?: string; error?: string }> {
  const url = apiUrl(config.origin, config.wikiPath, {
    action: 'query',
    meta: 'siteinfo',
    format: 'json',
  });
  const check = checkSourceUrl(new URL(url), robotsText, {
    origin: config.origin,
    wikiPath: config.wikiPath,
  });
  if (!check.allowed) return { ok: false, error: check.reason };

  const result = await client.get(url, {
    allowedOrigin: config.origin,
    allowedWikiPath: config.wikiPath,
    robotsText,
  });
  if (result.status !== 200) return { ok: false, error: `siteinfo HTTP ${result.status}` };

  let json: unknown;
  try {
    json = JSON.parse(result.bodyText);
  } catch {
    return { ok: false, error: 'siteinfo non-JSON' };
  }
  const record = json as {
    error?: { code?: string; info?: string };
    query?: { general?: { generator?: string } };
  };
  if (record.error) {
    return { ok: false, error: `API ${record.error.code}: ${record.error.info}` };
  }
  const version = record.query?.general?.generator;
  return version ? { ok: true, version } : { ok: true };
}

async function probeParse(
  client: WikiClient,
  config: ProbeConfig,
  robotsText: string,
  seed: ProbeSeed,
): Promise<SamplePageReport> {
  const canonical = pageUrl(config.origin, config.wikiPath, seed.title);
  const urlCheck = checkSourceUrl(new URL(canonical), robotsText, {
    origin: config.origin,
    wikiPath: config.wikiPath,
  });
  if (!urlCheck.allowed) {
    return {
      url: canonical,
      title: seed.title,
      kind: seed.kind,
      allowed: false,
      rejectReason: urlCheck.reason,
      fieldCoverage: [],
      missingFields: [],
      applicableCities: [],
    };
  }

  const api = apiUrl(config.origin, config.wikiPath, {
    action: 'parse',
    page: seed.title,
    prop: 'text|revid|displaytitle',
    format: 'json',
  });
  const apiCheck = checkSourceUrl(new URL(api), robotsText, {
    origin: config.origin,
    wikiPath: config.wikiPath,
  });
  if (!apiCheck.allowed) {
    return {
      url: canonical,
      title: seed.title,
      kind: seed.kind,
      allowed: false,
      rejectReason: apiCheck.reason,
      fieldCoverage: [],
      missingFields: [],
      applicableCities: [],
    };
  }

  const result = await client.get(api, {
    allowedOrigin: config.origin,
    allowedWikiPath: config.wikiPath,
    robotsText,
  });

  if (result.status !== 200) {
    return {
      url: canonical,
      title: seed.title,
      kind: seed.kind,
      allowed: false,
      rejectReason: `parse HTTP ${result.status}`,
      fieldCoverage: [],
      missingFields: [],
      applicableCities: [],
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(result.bodyText);
  } catch {
    return {
      url: canonical,
      title: seed.title,
      kind: seed.kind,
      allowed: false,
      rejectReason: 'parse response not JSON',
      fieldCoverage: [],
      missingFields: [],
      applicableCities: [],
    };
  }

  const record = json as {
    error?: { code?: string; info?: string };
    parse?: {
      title?: string;
      pageid?: number;
      revid?: number;
      text?: { '*': string };
    };
  };

  if (record.error) {
    return {
      url: canonical,
      title: seed.title,
      kind: seed.kind,
      allowed: false,
      rejectReason: `API ${record.error.code}: ${record.error.info}`,
      fieldCoverage: [],
      missingFields: [],
      applicableCities: [],
    };
  }

  const html = record.parse?.text?.['*'] ?? '';
  const analysis = analyzeHtml(html, seed.kind);
  const sample: SamplePageReport = {
    url: canonical,
    title: record.parse?.title ?? seed.title,
    kind: seed.kind,
    allowed: true,
    contentLength: html.length,
    hasTables: analysis.hasTables,
    fieldCoverage: analysis.fieldCoverage,
    missingFields: analysis.missingFields,
    applicableCities: analysis.applicableCities,
  };
  if (record.parse?.pageid != null) sample.pageId = record.parse.pageid;
  if (record.parse?.revid != null) sample.revision = record.parse.revid;
  return sample;
}

export async function probeWiki(config: ProbeConfig): Promise<ProbeReport> {
  if (config.limit < 1) {
    throw new Error('ProbeConfig.limit must be >= 1');
  }

  const client = new WikiClient({
    userAgent: config.userAgent,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    minIntervalMs: config.minIntervalMs,
    jitterMs: config.jitterMs,
    ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
    ...(config.sleep ? { sleep: config.sleep } : {}),
    ...(config.now ? { now: config.now } : {}),
  });

  const robots = await fetchRobots(client, config.origin, config.wikiPath);
  const siteinfo = await probeSiteinfo(client, config, robots.text);

  const samples: SamplePageReport[] = [];
  const rejected: Array<{ url: string; reason: string }> = [];
  const gaps: string[] = [];
  const apiErrors: string[] = [];
  let parseOk = false;

  if (!siteinfo.ok && siteinfo.error) {
    apiErrors.push(siteinfo.error);
    gaps.push(`siteinfo unavailable: ${siteinfo.error}`);
  }

  const seeds = config.seeds.slice(0, config.limit);
  for (const seed of seeds) {
    try {
      const sample = await probeParse(client, config, robots.text, seed);
      samples.push(sample);
      if (sample.allowed && sample.revision != null) parseOk = true;
      if (!sample.allowed) {
        rejected.push({ url: sample.url, reason: sample.rejectReason ?? 'rejected' });
        gaps.push(`${seed.title}: ${sample.rejectReason ?? 'rejected'}`);
      } else if (sample.missingFields.length > 0) {
        gaps.push(`${seed.title} missing fields: ${sample.missingFields.join(', ')}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const url = pageUrl(config.origin, config.wikiPath, seed.title);
      samples.push({
        url,
        title: seed.title,
        kind: seed.kind,
        allowed: false,
        rejectReason: message,
        fieldCoverage: [],
        missingFields: [],
        applicableCities: [],
      });
      rejected.push({ url, reason: message });
      gaps.push(`${seed.title}: ${message}`);
      if (/403|stop source/i.test(message)) break;
    }
  }

  const licenseNotes = [
    'Wiki homepage declares CC BY-NC-SA (link points to 3.0); special notes and game asset rights may differ.',
    'Probe is personal non-commercial research; retain title, source URL, revision, and license on import.',
    'API availability ≠ permission to bulk scrape or redistribute — respect robots and site rules at runtime.',
  ];

  return {
    generatedAt: new Date(config.now?.() ?? Date.now()).toISOString(),
    origin: config.origin,
    wikiPath: config.wikiPath,
    robotsChecked: true,
    robotsSummary: robots.summary,
    licenseNotes,
    apiCapabilities: {
      siteinfo: Boolean(siteinfo.ok),
      parse: parseOk,
      ...(siteinfo.version ? { mediaWikiVersion: siteinfo.version } : {}),
      errors: apiErrors,
    },
    samples,
    rejected,
    gaps,
    requestCount: client.getRequestCount(),
  };
}
