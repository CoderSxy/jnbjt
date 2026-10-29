import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildKnowledgeBundleFromWikiSnapshotDir,
  loadWikiSnapshotBundle,
} from '@jnbjt/knowledge-import';

const sampleBundle = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'wiki',
  'bundles',
  'sample',
);

describe('loadWikiSnapshotBundle', () => {
  it('loads manifest + pages and parses building drafts', () => {
    const result = loadWikiSnapshotBundle(sampleBundle);
    expect(result.validation.errors).toEqual([]);
    expect(result.manifest.producer).toBe('jnbjt-fixture');
    expect(result.drafts.map((d) => d.name).sort()).toEqual(['农田', '餐馆']);
    expect(result.validation.summary.pageCount).toBe(2);
    expect(result.validation.summary.recipeCount).toBeGreaterThan(0);
    expect(result.htmlBySnapshotId.snap_农田).toContain('mw-parser-output');
  });

  it('rejects bundles with wrong formatVersion', () => {
    expect(() => loadWikiSnapshotBundle('/nonexistent')).toThrow(/missing manifest/);
  });

  it('buildKnowledgeBundleFromWikiSnapshotDir matches manual fixture import hash', () => {
    const { bundle, load } = buildKnowledgeBundleFromWikiSnapshotDir(sampleBundle);
    expect(load.validation.errors).toEqual([]);
    expect(bundle.drafts.length).toBe(2);
    expect(bundle.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('loadWikiSnapshotBundle validation', () => {
  it('records errors for disallowed source origins', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'jnbjt-bundle-'));
    cpSync(sampleBundle, tmp, { recursive: true });
    const metaPath = join(tmp, 'pages', '农田.meta.json');
    writeFileSync(
      metaPath,
      JSON.stringify({
        title: '农田',
        sourceUrl: 'https://evil.example/jiangnan/农田',
        fetchedAt: '2026-10-24T08:00:00.000Z',
        revision: 1,
      }),
      'utf8',
    );
    const result = loadWikiSnapshotBundle(tmp);
    expect(result.validation.errors.some((e) => e.includes('sourceUrl rejected'))).toBe(true);
    expect(() => buildKnowledgeBundleFromWikiSnapshotDir(tmp)).toThrow();
  });
});
