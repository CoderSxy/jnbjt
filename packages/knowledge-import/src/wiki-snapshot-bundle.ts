import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { KnowledgeBundle, ParsedBuildingDraft, SourceSnapshot } from '@jnbjt/contracts';
import { buildKnowledgeBundle } from './bundle.js';
import { parseBuilding } from './parse-building.js';
import { checkSourceUrl } from './policy.js';

/** External / offline Wiki collection output consumed by `import:bundle --bundle`. */
export const WIKI_SNAPSHOT_BUNDLE_FORMAT_VERSION = '1';

export type WikiSnapshotPageMeta = {
  title: string;
  sourceUrl: string;
  fetchedAt: string;
  revision?: number | null;
  pageId?: number;
  robotsAllowed?: boolean;
  fixtureKind?: string;
  notes?: string;
};

export type WikiSnapshotManifestPage = {
  title: string;
  /** File base name under `pages/` (without extension). Defaults to `title`. */
  baseName?: string;
};

export type WikiSnapshotManifest = {
  formatVersion: typeof WIKI_SNAPSHOT_BUNDLE_FORMAT_VERSION;
  bundleKind: 'wiki-snapshot';
  producedAt: string;
  producer: string;
  origin: string;
  wikiPath: string;
  license: string;
  pages: WikiSnapshotManifestPage[];
};

export type WikiSnapshotBundleValidation = {
  errors: string[];
  warnings: string[];
  summary: {
    pageCount: number;
    buildingCount: number;
    recipeCount: number;
    unknownFieldCount: number;
  };
};

export type WikiSnapshotBundleLoadResult = {
  manifest: WikiSnapshotManifest;
  snapshots: SourceSnapshot[];
  drafts: ParsedBuildingDraft[];
  htmlBySnapshotId: Record<string, string>;
  validation: WikiSnapshotBundleValidation;
};

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function assertManifest(raw: unknown): WikiSnapshotManifest {
  if (!raw || typeof raw !== 'object') {
    throw new Error('manifest.json must be a JSON object');
  }
  const m = raw as Record<string, unknown>;
  if (m.formatVersion !== WIKI_SNAPSHOT_BUNDLE_FORMAT_VERSION) {
    throw new Error(
      `unsupported formatVersion: ${String(m.formatVersion)} (expected ${WIKI_SNAPSHOT_BUNDLE_FORMAT_VERSION})`,
    );
  }
  if (m.bundleKind !== 'wiki-snapshot') {
    throw new Error(`unsupported bundleKind: ${String(m.bundleKind)} (expected wiki-snapshot)`);
  }
  for (const key of ['producedAt', 'producer', 'origin', 'wikiPath', 'license'] as const) {
    if (typeof m[key] !== 'string' || !m[key]) {
      throw new Error(`manifest.${key} is required`);
    }
  }
  if (!Array.isArray(m.pages) || m.pages.length === 0) {
    throw new Error('manifest.pages must be a non-empty array');
  }
  return m as unknown as WikiSnapshotManifest;
}

function countUnknownFields(drafts: ParsedBuildingDraft[]): number {
  let n = 0;
  for (const draft of drafts) {
    for (const variant of draft.variants) {
      for (const recipe of variant.recipes) {
        if (recipe.durationSeconds === 'unknown' || recipe.durationSeconds === null) n += 1;
        if (recipe.workers === 'unknown' || recipe.workers === null) n += 1;
        if (recipe.tier === 'unknown' || recipe.tier === null) n += 1;
        for (const row of [...recipe.inputs, ...recipe.outputs]) {
          if (row.quantity.kind === 'unknown') n += 1;
        }
      }
    }
  }
  return n;
}

function loadRobotsText(bundleDir: string): { text: string; fromBundle: boolean } {
  const bundled = join(bundleDir, 'robots.txt');
  if (existsSync(bundled)) {
    return { text: readFileSync(bundled, 'utf8'), fromBundle: true };
  }
  return { text: '', fromBundle: false };
}

export function loadWikiSnapshotBundle(bundleDir: string): WikiSnapshotBundleLoadResult {
  const root = resolve(bundleDir);
  const manifestPath = join(root, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`missing manifest.json in ${root}`);
  }

  const manifest = assertManifest(readJsonFile(manifestPath));
  const { text: robotsText, fromBundle: hasRobotsSnapshot } = loadRobotsText(root);
  const allowlist = { origin: manifest.origin, wikiPath: manifest.wikiPath };

  const errors: string[] = [];
  const warnings: string[] = [];
  if (!hasRobotsSnapshot) {
    warnings.push(
      'bundle 根目录缺少 robots.txt 快照；仅校验来源域/路径 allowlist，未复验 robots 规则',
    );
  }

  const snapshots: SourceSnapshot[] = [];
  const drafts: ParsedBuildingDraft[] = [];
  const htmlBySnapshotId: Record<string, string> = {};

  for (const entry of manifest.pages) {
    const baseName = entry.baseName ?? entry.title;
    const htmlPath = join(root, 'pages', `${baseName}.html`);
    const metaPath = join(root, 'pages', `${baseName}.meta.json`);

    if (!existsSync(htmlPath)) {
      errors.push(`missing HTML: pages/${baseName}.html`);
      continue;
    }
    if (!existsSync(metaPath)) {
      errors.push(`missing meta: pages/${baseName}.meta.json`);
      continue;
    }

    const html = readFileSync(htmlPath, 'utf8');
    const meta = readJsonFile<WikiSnapshotPageMeta>(metaPath);

    if (meta.title !== entry.title) {
      warnings.push(
        `pages/${baseName}.meta.json title "${meta.title}" differs from manifest "${entry.title}"`,
      );
    }
    if (!meta.sourceUrl || !meta.fetchedAt) {
      errors.push(`pages/${baseName}.meta.json requires sourceUrl and fetchedAt`);
      continue;
    }
    if (meta.robotsAllowed === false) {
      errors.push(`pages/${baseName} marked robotsAllowed=false; refuse import`);
      continue;
    }

    let sourceCheck = checkSourceUrl(new URL(meta.sourceUrl), robotsText, allowlist);
    if (!sourceCheck.allowed && !hasRobotsSnapshot && sourceCheck.reason.startsWith('robots')) {
      sourceCheck = checkSourceUrl(new URL(meta.sourceUrl), 'User-agent: *\nAllow: /', allowlist);
      warnings.push(
        `pages/${baseName} robots 未快照，已跳过 robots 复验（仍要求 allowlist 来源）`,
      );
    }
    if (!sourceCheck.allowed) {
      errors.push(`pages/${baseName} sourceUrl rejected: ${sourceCheck.reason}`);
      continue;
    }

    const snapshot: SourceSnapshot = {
      snapshotId: `snap_${entry.title}`,
      title: entry.title,
      sourceUrl: meta.sourceUrl,
      revision: meta.revision ?? null,
      html,
      fetchedAt: meta.fetchedAt,
    };
    snapshots.push(snapshot);
    htmlBySnapshotId[snapshot.snapshotId] = html;
    drafts.push(parseBuilding(snapshot));
  }

  const recipeCount = drafts.reduce(
    (acc, d) => acc + d.variants.reduce((a, v) => a + v.recipes.length, 0),
    0,
  );

  const validation: WikiSnapshotBundleValidation = {
    errors,
    warnings,
    summary: {
      pageCount: snapshots.length,
      buildingCount: drafts.length,
      recipeCount,
      unknownFieldCount: countUnknownFields(drafts),
    },
  };

  return { manifest, snapshots, drafts, htmlBySnapshotId, validation };
}

export function buildKnowledgeBundleFromWikiSnapshotDir(bundleDir: string): {
  bundle: KnowledgeBundle;
  load: WikiSnapshotBundleLoadResult;
} {
  const load = loadWikiSnapshotBundle(bundleDir);
  if (load.validation.errors.length > 0) {
    throw new Error(load.validation.errors.join('; '));
  }
  const bundle = buildKnowledgeBundle(load.drafts);
  return { bundle, load };
}

/** Load legacy `--fixture` paths (single page dir or .html path). */
export function loadWikiFixtures(fixturePaths: string[]): {
  drafts: ParsedBuildingDraft[];
  htmlBySnapshotId: Record<string, string>;
} {
  const drafts: ParsedBuildingDraft[] = [];
  const htmlBySnapshotId: Record<string, string> = {};

  for (const fixture of fixturePaths) {
    const htmlPath = fixture.endsWith('.html') ? fixture : `${fixture}.html`;
    const metaPath = htmlPath.replace(/\.html$/, '.meta.json');
    const html = readFileSync(htmlPath, 'utf8');
    const meta = readJsonFile<WikiSnapshotPageMeta>(metaPath);
    const title = meta.title;
    const snapshot: SourceSnapshot = {
      snapshotId: `snap_${title}`,
      title,
      sourceUrl: meta.sourceUrl,
      revision: meta.revision ?? null,
      html,
      fetchedAt: meta.fetchedAt,
    };
    htmlBySnapshotId[snapshot.snapshotId] = html;
    drafts.push(parseBuilding(snapshot));
  }

  return { drafts, htmlBySnapshotId };
}
