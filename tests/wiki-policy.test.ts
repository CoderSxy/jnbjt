import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkSourceUrl } from '@jnbjt/knowledge-import';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'wiki');
const robotsText = readFileSync(join(fixtures, 'robots.txt'), 'utf8');
const allowed = {
  origin: 'https://wiki.biligame.com',
  wikiPath: '/jiangnan',
};

describe('checkSourceUrl', () => {
  it('rejects robots-disallowed index.php query URLs', () => {
    const url = new URL('https://wiki.biligame.com/jiangnan/index.php?title=农田');
    const result = checkSourceUrl(url, robotsText, allowed);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/robots|index\.php/i);
  });

  it('rejects robots-disallowed oldid URLs', () => {
    const url = new URL('https://wiki.biligame.com/jiangnan/农田?oldid=64284');
    const result = checkSourceUrl(url, robotsText, allowed);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/robots|oldid/i);
  });

  it('rejects domains outside the fixed allowlist', () => {
    const url = new URL('https://evil.example/jiangnan/农田');
    const result = checkSourceUrl(url, robotsText, allowed);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/origin|domain|allowlist|域名/i);
  });

  it('rejects paths outside the fixed wiki path', () => {
    const url = new URL('https://wiki.biligame.com/othergame/农田');
    const result = checkSourceUrl(url, robotsText, allowed);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/path|wikiPath|路径/i);
  });

  it('allows canonical article URLs under the wiki path', () => {
    const url = new URL('https://wiki.biligame.com/jiangnan/农田');
    const result = checkSourceUrl(url, robotsText, allowed);
    expect(result).toEqual({ allowed: true, reason: 'ok' });
  });

  it('allows MediaWiki api.php under the wiki path when robots do not disallow it', () => {
    const url = new URL(
      'https://wiki.biligame.com/jiangnan/api.php?action=query&meta=siteinfo&format=json',
    );
    const result = checkSourceUrl(url, robotsText, allowed);
    expect(result.allowed).toBe(true);
  });
});
