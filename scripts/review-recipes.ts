#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import {
  applyRecipeReview,
  listDraftProductionRecipes,
  type RecipeReviewSelector,
} from '../apps/api/src/modules/knowledge/recipe-review.js';

function loadEnv(): void {
  const path = resolve(process.cwd(), '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (process.env[m[1]!] === undefined) process.env[m[1]!] = m[2];
  }
}

function parseArgs(argv: string[]): {
  city: string;
  list: boolean;
  manifest: string | null;
  confirm: 'reviewed' | 'published' | null;
  allowIncomplete: boolean;
  selectors: RecipeReviewSelector[];
} {
  let city = '应天府';
  let list = false;
  let manifest: string | null = null;
  let confirm: 'reviewed' | 'published' | null = null;
  let allowIncomplete = false;
  const selectors: RecipeReviewSelector[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--list') list = true;
    else if (arg === '--city' && argv[i + 1]) city = argv[++i]!;
    else if (arg === '--manifest' && argv[i + 1]) manifest = resolve(argv[++i]!);
    else if (arg === '--confirm' && argv[i + 1]) {
      const v = argv[++i]!;
      if (v === 'reviewed' || v === 'published') confirm = v;
      else throw new Error('--confirm must be reviewed or published');
    } else if (arg === '--allow-incomplete') allowIncomplete = true;
    else if (arg === '--id' && argv[i + 1]) selectors.push({ recipeId: argv[++i]! });
  }

  return { city, list, manifest, confirm, allowIncomplete, selectors };
}

type ManifestFile = {
  city?: string;
  confirmation?: 'reviewed' | 'published';
  allowIncomplete?: boolean;
  recipes: RecipeReviewSelector[];
};

async function main(): Promise<void> {
  loadEnv();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL required');

  const args = parseArgs(process.argv.slice(2));
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 3 });

  try {
    if (args.list) {
      const recipes = await listDraftProductionRecipes(pool, args.city);
      console.log(JSON.stringify({ city: args.city, recipes }, null, 2));
      return;
    }

    let city = args.city;
    let confirmation = args.confirm;
    let allowIncomplete = args.allowIncomplete;
    let selectors = args.selectors;

    if (args.manifest) {
      const manifest = JSON.parse(readFileSync(args.manifest, 'utf8')) as ManifestFile;
      city = manifest.city ?? city;
      confirmation = manifest.confirmation ?? confirmation ?? 'reviewed';
      allowIncomplete = manifest.allowIncomplete ?? allowIncomplete;
      selectors = manifest.recipes ?? [];
    }

    if (!confirmation) {
      throw new Error('指定 --confirm reviewed|published 或 --manifest');
    }
    if (selectors.length === 0) {
      throw new Error('指定 --id … 或 --manifest');
    }

    const report = await applyRecipeReview(pool, {
      city,
      confirmation,
      selectors,
      allowIncomplete,
    });
    console.log(JSON.stringify({ city, confirmation, report }, null, 2));
    if (report.updated === 0 && report.errors.length > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
