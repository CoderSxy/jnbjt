import type { Pool } from 'pg';
import type { CitySnapshot, RecognitionCorrections } from '@jnbjt/contracts';
import { getCity, saveCity, VersionConflictError } from '../cities/repository.js';

export async function applyRecognition(
  pool: Pool,
  userId: string,
  draftId: string,
  expectedVersion: number,
  corrections: RecognitionCorrections,
): Promise<CitySnapshot> {
  const draft = await pool.query<{
    id: string;
    city_id: string | null;
    status: string;
    fields: unknown;
  }>(`SELECT id, city_id, status, fields FROM recognition_drafts WHERE id = $1 AND user_id = $2`, [
    draftId,
    userId,
  ]);
  const row = draft.rows[0];
  if (!row) throw Object.assign(new Error('draft not found'), { code: 'NOT_FOUND' });
  if (row.status !== 'pending_review') {
    throw Object.assign(new Error('draft not pending'), { code: 'CONFLICT' });
  }
  if (!row.city_id) throw Object.assign(new Error('draft missing city'), { code: 'BAD_REQUEST' });

  const city = await getCity(pool, userId, row.city_id);
  if (!city) throw Object.assign(new Error('city not found'), { code: 'NOT_FOUND' });

  const nextState = structuredClone(city.state);
  for (const field of corrections.fields) {
    if (field.status === 'unknown' || field.value == null) continue;
    if (field.path.startsWith('inventory.')) {
      const key = field.path.slice('inventory.'.length);
      const num = typeof field.value === 'number' ? field.value : Number(field.value);
      if (!Number.isFinite(num)) continue;
      nextState.inventory[key] = num;
    }
  }

  try {
    const saved = await saveCity(pool, userId, row.city_id, expectedVersion, nextState);
    await pool.query(
      `UPDATE recognition_drafts SET status = 'applied', fields = $2::jsonb, applied_at = now() WHERE id = $1`,
      [draftId, JSON.stringify(corrections.fields)],
    );
    return saved;
  } catch (error) {
    if (error instanceof VersionConflictError) throw error;
    throw error;
  }
}
