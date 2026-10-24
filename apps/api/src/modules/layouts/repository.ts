import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Layout } from '@jnbjt/contracts';

export class VersionConflictError extends Error {
  constructor() {
    super('version conflict');
    this.name = 'VersionConflictError';
  }
}

export async function getLayout(
  pool: Pool,
  userId: string,
  cityId: string,
): Promise<{ id: string; version: number; layout: Layout } | null> {
  const result = await pool.query<{ id: string; version: number; layout: Layout }>(
    `SELECT id, version, layout FROM layouts WHERE user_id = $1 AND city_id = $2`,
    [userId, cityId],
  );
  return result.rows[0] ?? null;
}

export async function saveLayout(
  pool: Pool,
  userId: string,
  cityId: string,
  expectedVersion: number | null,
  layout: Layout,
): Promise<{ id: string; version: number; layout: Layout }> {
  const existing = await getLayout(pool, userId, cityId);
  if (!existing) {
    const id = randomUUID();
    const inserted = await pool.query<{ id: string; version: number; layout: Layout }>(
      `INSERT INTO layouts (id, user_id, city_id, version, layout)
       VALUES ($1,$2,$3,1,$4::jsonb)
       RETURNING id, version, layout`,
      [id, userId, cityId, JSON.stringify(layout)],
    );
    return inserted.rows[0]!;
  }

  if (expectedVersion == null || existing.version !== expectedVersion) {
    throw new VersionConflictError();
  }

  // Locked buildings cannot move
  const prevById = new Map(existing.layout.buildings.map((b) => [b.id, b]));
  for (const building of layout.buildings) {
    const prev = prevById.get(building.id);
    if (prev?.locked && (prev.x !== building.x || prev.y !== building.y || prev.rotation !== building.rotation)) {
      const err = new Error('locked building moved');
      err.name = 'LockedBuildingError';
      throw err;
    }
  }

  const updated = await pool.query<{ id: string; version: number; layout: Layout }>(
    `UPDATE layouts
     SET layout = $1::jsonb, version = version + 1, updated_at = now()
     WHERE id = $2 AND user_id = $3 AND version = $4
     RETURNING id, version, layout`,
    [JSON.stringify(layout), existing.id, userId, expectedVersion],
  );
  if (!updated.rows[0]) throw new VersionConflictError();
  return updated.rows[0];
}
