import type { SourceUrlCheck } from './types.js';

export type Allowlist = {
  origin: string;
  wikiPath: string;
};

type RobotsRule = {
  userAgent: string;
  disallows: string[];
  allows: string[];
};

function normalizePathPrefix(wikiPath: string): string {
  if (!wikiPath.startsWith('/')) return `/${wikiPath}`;
  return wikiPath.endsWith('/') ? wikiPath.slice(0, -1) : wikiPath;
}

/** Convert a robots Disallow/Allow pattern to a RegExp (supports *). */
function robotsPatternToRegExp(pattern: string): RegExp {
  let source = '';
  for (const ch of pattern) {
    if (ch === '*') source += '.*';
    else if ('\\.[]{}()+-^$|?'.includes(ch)) source += `\\${ch}`;
    else source += ch;
  }
  return new RegExp(`^${source}`);
}

export function parseRobotsDisallows(robotsText: string, userAgent = '*'): string[] {
  const groups = parseRobotsGroups(robotsText);
  const matched =
    groups.find((g) => g.userAgent.toLowerCase() === userAgent.toLowerCase()) ??
    groups.find((g) => g.userAgent === '*');
  return matched?.disallows ?? [];
}

function parseRobotsGroups(robotsText: string): RobotsRule[] {
  const lines = robotsText.split(/\r?\n/);
  const groups: RobotsRule[] = [];
  let current: RobotsRule | null = null;

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === 'user-agent') {
      current = { userAgent: value, disallows: [], allows: [] };
      groups.push(current);
      continue;
    }
    if (!current) continue;
    if (key === 'disallow') {
      if (value.length > 0) current.disallows.push(value);
    } else if (key === 'allow') {
      if (value.length > 0) current.allows.push(value);
    }
  }
  return groups;
}

function robotsAllowsPath(robotsText: string, pathWithQuery: string, userAgent = '*'): boolean {
  const groups = parseRobotsGroups(robotsText);
  const matched =
    groups.find((g) => g.userAgent.toLowerCase() === userAgent.toLowerCase()) ??
    groups.find((g) => g.userAgent === '*');
  if (!matched) return true;

  let bestAllow = -1;
  let bestDisallow = -1;

  for (const pattern of matched.allows) {
    if (robotsPatternToRegExp(pattern).test(pathWithQuery)) {
      bestAllow = Math.max(bestAllow, pattern.length);
    }
  }
  for (const pattern of matched.disallows) {
    if (robotsPatternToRegExp(pattern).test(pathWithQuery)) {
      bestDisallow = Math.max(bestDisallow, pattern.length);
    }
  }

  if (bestDisallow < 0) return true;
  if (bestAllow < 0) return false;
  return bestAllow >= bestDisallow;
}

/**
 * Check whether a candidate URL is allowed for Wiki probing/import.
 * Domain/path allowlist must come from fixed ProbeConfig — never accept arbitrary hosts.
 */
export function checkSourceUrl(
  url: URL,
  robotsText: string,
  allowed?: Allowlist,
): SourceUrlCheck {
  if (!allowed) {
    return { allowed: false, reason: 'missing allowlist origin/wikiPath' };
  }

  const expectedOrigin = new URL(allowed.origin).origin;
  if (url.origin !== expectedOrigin) {
    return { allowed: false, reason: `origin not in allowlist: ${url.origin}` };
  }

  const wikiPath = normalizePathPrefix(allowed.wikiPath);
  if (url.pathname !== wikiPath && !url.pathname.startsWith(`${wikiPath}/`)) {
    return { allowed: false, reason: `path outside wikiPath ${wikiPath}` };
  }

  const pathWithQuery = `${url.pathname}${url.search}`;
  if (!robotsAllowsPath(robotsText, pathWithQuery)) {
    return { allowed: false, reason: `robots disallow: ${pathWithQuery}` };
  }

  return { allowed: true, reason: 'ok' };
}
