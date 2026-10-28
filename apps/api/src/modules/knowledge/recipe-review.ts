import type { Pool } from 'pg';

export type DraftRecipeRow = {
  id: string;
  buildingName: string;
  city: string;
  tier: string | null;
  confirmation: string;
  durationSeconds: number | null;
  durationUnknown: boolean;
  workers: number | null;
  workersUnknown: boolean;
  inputs: unknown;
  outputs: unknown;
  snapshotId: string | null;
  exactCalculationReady: boolean;
  unknownReasons: string[];
};

export type RecipeReviewSelector = {
  recipeId?: string;
  buildingName?: string;
  tier?: string | null;
  durationSeconds?: number;
};

export type ApplyRecipeReviewInput = {
  city: string;
  confirmation: 'reviewed' | 'published';
  selectors: RecipeReviewSelector[];
  allowIncomplete?: boolean;
};

export type ApplyRecipeReviewReport = {
  updated: number;
  skipped: number;
  matchedIds: string[];
  errors: string[];
};

type RecipeRow = {
  id: string;
  building_name: string;
  city: string;
  tier: string | null;
  confirmation: string;
  duration_seconds: number | null;
  duration_unknown: boolean;
  workers: number | null;
  workers_unknown: boolean;
  inputs: Array<{ resourceName: string; quantity: { kind: string; value?: number } }>;
  outputs: Array<{ resourceName: string; quantity: { kind: string; value?: number } }>;
  snapshot_id: string | null;
};

function assessExactCalculationReady(row: RecipeRow): { ready: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!row.snapshot_id) reasons.push('缺少来源快照');
  if (row.duration_unknown || row.duration_seconds === null || !(row.duration_seconds > 0)) {
    reasons.push('耗时未知或无效');
  }
  if (row.workers_unknown || row.workers === null || row.workers < 0) {
    reasons.push('工人数未知或无效');
  }
  for (const item of [...row.inputs, ...row.outputs]) {
    const q = item.quantity;
    if (!q || q.kind !== 'number' || typeof q.value !== 'number' || !(q.value > 0)) {
      reasons.push(`数量未确认为正整数：${item.resourceName}`);
    }
  }
  return { ready: reasons.length === 0, reasons };
}

export function isRecipeRefExactCalculationReady(ref: {
  durationSeconds: number | 'unknown';
  workers: number | 'unknown';
  inputs: Array<{ resource: string; amount: number | 'unknown' }>;
  outputs: Array<{ resource: string; amount: number | 'unknown' }>;
  sourceNote?: string;
}): boolean {
  const reasons: string[] = [];
  if (!ref.sourceNote) reasons.push('missing source');
  if (ref.durationSeconds === 'unknown') reasons.push('duration');
  if (ref.workers === 'unknown') reasons.push('workers');
  for (const item of [...ref.inputs, ...ref.outputs]) {
    if (item.amount === 'unknown') reasons.push(item.resource);
  }
  return reasons.length === 0;
}

function mapDraftRow(row: RecipeRow): DraftRecipeRow {
  const { ready, reasons } = assessExactCalculationReady(row);
  return {
    id: row.id,
    buildingName: row.building_name,
    city: row.city,
    tier: row.tier,
    confirmation: row.confirmation,
    durationSeconds: row.duration_seconds,
    durationUnknown: row.duration_unknown,
    workers: row.workers,
    workersUnknown: row.workers_unknown,
    inputs: row.inputs,
    outputs: row.outputs,
    snapshotId: row.snapshot_id,
    exactCalculationReady: ready,
    unknownReasons: reasons,
  };
}

const ACTIVE_DRAFT_SQL = `
  SELECT r.id, b.name AS building_name, v.city, r.tier, r.confirmation,
         r.duration_seconds, r.duration_unknown, r.workers, r.workers_unknown,
         r.inputs, r.outputs, r.snapshot_id
  FROM production_recipes r
  JOIN building_variants v ON v.id = r.variant_id
  JOIN building_types b ON b.id = v.building_type_id
  JOIN knowledge_versions k ON k.id = b.knowledge_version_id AND k.is_active
  JOIN knowledge_imports i ON i.id = k.import_id AND i.status = 'published'
  WHERE v.city = $1 AND r.confirmation = 'draft'
  ORDER BY b.name, r.tier NULLS LAST, r.duration_seconds NULLS LAST, r.id
`;

export async function listDraftProductionRecipes(pool: Pool, city: string): Promise<DraftRecipeRow[]> {
  const result = await pool.query<RecipeRow>(ACTIVE_DRAFT_SQL, [city]);
  return result.rows.map(mapDraftRow);
}

function selectorMatches(row: RecipeRow, selector: RecipeReviewSelector): boolean {
  if (selector.recipeId) return row.id === selector.recipeId;
  if (!selector.buildingName) return false;
  if (row.building_name !== selector.buildingName) return false;
  if (selector.tier !== undefined && (row.tier ?? null) !== (selector.tier ?? null)) return false;
  if (selector.durationSeconds !== undefined && row.duration_seconds !== selector.durationSeconds) {
    return false;
  }
  return true;
}

export async function applyRecipeReview(
  pool: Pool,
  input: ApplyRecipeReviewInput,
): Promise<ApplyRecipeReviewReport> {
  const report: ApplyRecipeReviewReport = {
    updated: 0,
    skipped: 0,
    matchedIds: [],
    errors: [],
  };
  if (input.selectors.length === 0) {
    report.errors.push('至少指定一条 recipeId 或 buildingName 选择器');
    return report;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const drafts = await client.query<RecipeRow>(ACTIVE_DRAFT_SQL, [input.city]);
    const toUpdate = new Map<string, RecipeRow>();

    for (const selector of input.selectors) {
      const matches = drafts.rows.filter((row) => selectorMatches(row, selector));
      if (matches.length === 0) {
        report.errors.push(`未匹配到 draft 配方：${JSON.stringify(selector)}`);
        continue;
      }
      if (matches.length > 1 && !selector.recipeId) {
        report.errors.push(
          `选择器不唯一（${matches.length} 条），请指定 recipeId 或 durationSeconds：${JSON.stringify(selector)}`,
        );
        continue;
      }
      for (const row of matches) {
        const { ready, reasons } = assessExactCalculationReady(row);
        if (!ready && !input.allowIncomplete) {
          report.skipped += 1;
          report.errors.push(
            `跳过未完整配方 ${row.building_name}·${row.tier ?? '未知'} (${row.id})：${reasons.join('；')}`,
          );
          continue;
        }
        toUpdate.set(row.id, row);
      }
    }

    for (const id of toUpdate.keys()) {
      const result = await client.query(
        `UPDATE production_recipes SET confirmation = $2 WHERE id = $1 AND confirmation = 'draft'`,
        [id, input.confirmation],
      );
      if ((result.rowCount ?? 0) > 0) {
        report.updated += 1;
        report.matchedIds.push(id);
      }
    }

    await client.query('COMMIT');
    return report;
  } catch (error) {
    await client.query('ROLLBACK');
    report.errors.push(error instanceof Error ? error.message : String(error));
    return report;
  } finally {
    client.release();
  }
}

/** Batch 3+ assistant may call reviewed recipe listing; not implemented here. */
export const RECIPE_REVIEW_CONFIRMATION_VALUES = ['reviewed', 'published'] as const;
