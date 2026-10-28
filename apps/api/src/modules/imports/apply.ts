import type { Pool } from 'pg';
import { RecognitionCorrections, type CitySnapshot, type CityState } from '@jnbjt/contracts';
import { Value } from '@sinclair/typebox/value';
import { VersionConflictError } from '../cities/repository.js';

export async function applyRecognition(
  pool: Pool,
  userId: string,
  draftId: string,
  expectedVersion: number,
  corrections: RecognitionCorrections,
): Promise<CitySnapshot> {
  if (!Value.Check(RecognitionCorrections, corrections)) {
    throw Object.assign(new Error('invalid corrections'), { code: 'BAD_REQUEST' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const draft = await client.query<{
      id: string;
      city_id: string | null;
      job_id: string | null;
      status: string;
    }>(`SELECT id, city_id, job_id, status FROM recognition_drafts WHERE id = $1 AND user_id = $2 FOR UPDATE`, [draftId, userId]);
    const row = draft.rows[0];
    if (!row) throw Object.assign(new Error('draft not found'), { code: 'NOT_FOUND' });
    if (row.status !== 'pending_review') {
      throw Object.assign(new Error('draft not pending'), { code: 'CONFLICT' });
    }
    if (row.job_id) {
      // A succeeded job is immutable to cancellation. Read without a job row lock:
      // cancellation locks the job before deleting this draft, so locking it here
      // after locking the draft would reverse that lock order.
      const job = await client.query<{ status: string }>(
        'SELECT status FROM jobs WHERE id = $1 AND user_id = $2',
        [row.job_id, userId],
      );
      if (job.rows[0]?.status !== 'succeeded') {
        throw Object.assign(new Error('recognition job not succeeded'), { code: 'CONFLICT' });
      }
    }
    if (!row.city_id) throw Object.assign(new Error('draft missing city'), { code: 'BAD_REQUEST' });

    // Lock before reading state so a concurrent city save cannot be overwritten.
    const current = await client.query<{
      id: string;
      city_key: string;
      display_name: string;
      version: number;
      schema_version: number;
      state: CityState;
      updated_at: string;
    }>(`SELECT id, city_key, display_name, version, schema_version, state, updated_at::text
        FROM player_cities WHERE id = $1 AND user_id = $2 FOR UPDATE`, [row.city_id, userId]);
    const city = current.rows[0];
    if (!city) throw Object.assign(new Error('city not found'), { code: 'NOT_FOUND' });
    if (city.version !== expectedVersion) throw new VersionConflictError();

    const nextState = structuredClone(city.state);
    for (const field of corrections.fields) {
      if (!/^inventory\.[^.\s]{1,64}$/u.test(field.path)) {
        throw Object.assign(new Error('invalid inventory path'), { code: 'BAD_REQUEST' });
      }
      if (field.status === 'unknown' || field.value == null) continue;
      const key = field.path.slice('inventory.'.length);
      const num = typeof field.value === 'number' ? field.value : Number(field.value);
      if ((typeof field.value === 'string' && field.value.trim() === '') || !Number.isSafeInteger(num) || num < 0) {
        throw Object.assign(new Error('inventory value must be a nonnegative safe integer'), { code: 'BAD_REQUEST' });
      }
      Object.defineProperty(nextState.inventory, key, {
        value: num, enumerable: true, writable: true, configurable: true,
      });
    }

    const updated = await client.query<{ version: number; updated_at: string }>(
      `UPDATE player_cities SET state = $1::jsonb, version = version + 1, updated_at = now()
       WHERE id = $2 AND user_id = $3 AND version = $4 RETURNING version, updated_at::text`,
      [JSON.stringify(nextState), city.id, userId, expectedVersion],
    );
    if (!updated.rows[0]) throw new VersionConflictError();
    const applied = await client.query(
      `UPDATE recognition_drafts SET status = 'applied', fields = $2::jsonb, applied_at = now()
       WHERE id = $1 AND user_id = $3 AND status = 'pending_review'`,
      [draftId, JSON.stringify(corrections.fields), userId],
    );
    if (applied.rowCount !== 1) throw Object.assign(new Error('draft not pending'), { code: 'CONFLICT' });
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
