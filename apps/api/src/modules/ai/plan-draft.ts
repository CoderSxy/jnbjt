import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type {
  AssistantAnswer,
  AssistantInput,
  AssistantPlanContext,
  CitySnapshot,
  PlanDraft,
  PlanDraftPayload,
  ProductionResult,
} from '@jnbjt/contracts';
import { PlanDraftPayload as PlanDraftPayloadSchema } from '@jnbjt/contracts';
import { Value } from '@sinclair/typebox/value';
import { VersionConflictError } from '../cities/repository.js';

export function isPlanningQuestion(question: string): boolean {
  return /还缺|几轮|生产|缺口|目标|到|达到|至/.test(question) && /粮食|银两/.test(question);
}

function mapRow(row: {
  id: string;
  status: string;
  question: string;
  city_id: string;
  city_version_at_create: number;
  payload: PlanDraftPayload;
  job_id: string | null;
  created_at: string;
  applied_at: string | null;
}): PlanDraft {
  return {
    id: row.id,
    status: row.status as PlanDraft['status'],
    question: row.question,
    cityId: row.city_id,
    cityVersionAtCreate: row.city_version_at_create,
    payload: row.payload,
    jobId: row.job_id,
    createdAt: row.created_at,
    appliedAt: row.applied_at,
  };
}

export function buildPlanDraftPayload(
  input: AssistantInput,
  city: CitySnapshot,
  answer: AssistantAnswer,
): PlanDraftPayload {
  const production = answer.calculations[0] as ProductionResult | undefined;
  const blockers = [
    ...(production?.blockers ?? []),
    ...(production?.missingConditions ?? []),
  ];
  return {
    question: input.question,
    cityId: city.id,
    cityVersionAtCreate: city.version,
    facts: answer.facts.slice(0, 12),
    suggestions: answer.suggestions,
    citations: answer.citations,
    assumptions: answer.assumptions,
    missing: answer.missing,
    blockers,
    inventoryDiff: production?.gaps ?? {},
    ...(answer.planContext ? { planContext: answer.planContext } : {}),
    ...(production ? { production } : {}),
  };
}

export async function createPlanDraftFromAnswer(
  pool: Pool,
  userId: string,
  jobId: string,
  input: AssistantInput,
  city: CitySnapshot,
  answer: AssistantAnswer,
): Promise<PlanDraft | null> {
  if (!input.cityId || !isPlanningQuestion(input.question)) return null;
  const payload = buildPlanDraftPayload(input, city, answer);
  if (!Value.Check(PlanDraftPayloadSchema, payload)) {
    throw Object.assign(new Error('invalid plan draft payload'), { code: 'INTERNAL' });
  }
  const id = randomUUID();
  await pool.query(
    `INSERT INTO plan_drafts (id, user_id, city_id, job_id, status, question, city_version_at_create, payload)
     VALUES ($1,$2,$3,$4,'pending_review',$5,$6,$7::jsonb)`,
    [id, userId, city.id, jobId, input.question, city.version, JSON.stringify(payload)],
  );
  const row = await pool.query<{
    id: string;
    status: string;
    question: string;
    city_id: string;
    city_version_at_create: number;
    payload: PlanDraftPayload;
    job_id: string | null;
    created_at: string;
    applied_at: string | null;
  }>(
    `SELECT id, status, question, city_id, city_version_at_create, payload, job_id, created_at::text, applied_at::text
     FROM plan_drafts WHERE id = $1`,
    [id],
  );
  return mapRow(row.rows[0]!);
}

export async function getPlanDraft(
  pool: Pool,
  userId: string,
  draftId: string,
): Promise<(PlanDraft & { city: CitySnapshot | null }) | null> {
  const draft = await pool.query<{
    id: string;
    status: string;
    question: string;
    city_id: string;
    city_version_at_create: number;
    payload: PlanDraftPayload;
    job_id: string | null;
    created_at: string;
    applied_at: string | null;
  }>(
    `SELECT id, status, question, city_id, city_version_at_create, payload, job_id, created_at::text, applied_at::text
     FROM plan_drafts WHERE id = $1 AND user_id = $2`,
    [draftId, userId],
  );
  const row = draft.rows[0];
  if (!row) return null;
  const city = await pool.query<{
    id: string;
    city_key: string;
    display_name: string;
    version: number;
    schema_version: number;
    state: CitySnapshot['state'];
    updated_at: string;
  }>(
    `SELECT id, city_key, display_name, version, schema_version, state, updated_at::text
     FROM player_cities WHERE id = $1 AND user_id = $2`,
    [row.city_id, userId],
  );
  const citySnap = city.rows[0]
    ? {
        id: city.rows[0].id,
        cityKey: city.rows[0].city_key,
        displayName: city.rows[0].display_name,
        version: city.rows[0].version,
        schemaVersion: city.rows[0].schema_version,
        state: city.rows[0].state,
        updatedAt: city.rows[0].updated_at,
      }
    : null;
  return { ...mapRow(row), city: citySnap };
}

export async function applyPlanDraft(
  pool: Pool,
  userId: string,
  draftId: string,
  expectedVersion: number,
): Promise<CitySnapshot> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const draftRes = await client.query<{
      id: string;
      city_id: string;
      job_id: string | null;
      status: string;
      payload: PlanDraftPayload;
    }>(
      `SELECT id, city_id, job_id, status, payload FROM plan_drafts WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [draftId, userId],
    );
    const draft = draftRes.rows[0];
    if (!draft) throw Object.assign(new Error('draft not found'), { code: 'NOT_FOUND' });
    if (draft.status !== 'pending_review') {
      throw Object.assign(new Error('draft not pending'), { code: 'CONFLICT' });
    }
    if (draft.job_id) {
      const job = await client.query<{ status: string }>(
        `SELECT status FROM jobs WHERE id = $1 AND user_id = $2`,
        [draft.job_id, userId],
      );
      if (job.rows[0]?.status !== 'succeeded') {
        throw Object.assign(new Error('assistant job not succeeded'), { code: 'CONFLICT' });
      }
    }

    const production = draft.payload.production;
    if (!production || production.status !== 'ok') {
      throw Object.assign(
        new Error('计划草稿未通过精确计算校验，不能写入存档（需已审核配方与完整参数）'),
        { code: 'UNPROCESSABLE' },
      );
    }
    const ctx = draft.payload.planContext;
    if (!ctx?.recipeId || !ctx.targetInventory || !ctx.onlineFrequencyPerDay) {
      throw Object.assign(new Error('plan context incomplete'), { code: 'BAD_REQUEST' });
    }

    const current = await client.query<{
      id: string;
      city_key: string;
      display_name: string;
      version: number;
      schema_version: number;
      state: CitySnapshot['state'];
      updated_at: string;
    }>(
      `SELECT id, city_key, display_name, version, schema_version, state, updated_at::text
       FROM player_cities WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [draft.city_id, userId],
    );
    const city = current.rows[0];
    if (!city) throw Object.assign(new Error('city not found'), { code: 'NOT_FOUND' });
    if (city.version !== expectedVersion) throw new VersionConflictError();

    const nextState = structuredClone(city.state);
    const recordedAt = new Date().toISOString();
    nextState.productionPlan = {
      sourceDraftId: draft.id,
      recipeId: ctx.recipeId,
      recipeLabel: ctx.recipeLabel ?? ctx.recipeId,
      targetInventory: ctx.targetInventory,
      onlineFrequencyPerDay: ctx.onlineFrequencyPerDay,
      rounds: production.rounds,
      gaps: production.gaps,
      recordedAt,
    };
    const summary = `已确认生产规划：${ctx.recipeLabel ?? ctx.recipeId}，目标 ${JSON.stringify(ctx.targetInventory)}，约 ${String(production.rounds)} 轮（${recordedAt}）`;
    nextState.notes = nextState.notes ? `${nextState.notes}\n${summary}` : summary;

    const updated = await client.query<{ version: number; updated_at: string }>(
      `UPDATE player_cities SET state = $1::jsonb, version = version + 1, updated_at = now()
       WHERE id = $2 AND user_id = $3 AND version = $4 RETURNING version, updated_at::text`,
      [JSON.stringify(nextState), city.id, userId, expectedVersion],
    );
    if (!updated.rows[0]) throw new VersionConflictError();

    const applied = await client.query(
      `UPDATE plan_drafts SET status = 'applied', applied_at = now()
       WHERE id = $1 AND user_id = $2 AND status = 'pending_review'`,
      [draftId, userId],
    );
    if (applied.rowCount !== 1) {
      throw Object.assign(new Error('draft not pending'), { code: 'CONFLICT' });
    }

    await client.query('COMMIT');
    return {
      id: city.id,
      cityKey: city.city_key,
      displayName: city.display_name,
      schemaVersion: city.schema_version,
      version: updated.rows[0].version,
      state: nextState,
      updatedAt: updated.rows[0].updated_at,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
