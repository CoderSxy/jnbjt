import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { CitySnapshot, CityState } from '@jnbjt/contracts';

type CityRow = {
  id: string;
  city_key: string;
  display_name: string;
  version: number;
  schema_version: number;
  state: CityState;
  updated_at: string;
};

function mapCity(row: CityRow): CitySnapshot {
  return {
    id: row.id,
    cityKey: row.city_key,
    displayName: row.display_name,
    version: row.version,
    schemaVersion: row.schema_version,
    state: row.state,
    updatedAt: row.updated_at,
  };
}

export async function listCities(pool: Pool, userId: string): Promise<CitySnapshot[]> {
  const result = await pool.query<CityRow>(
    `SELECT id, city_key, display_name, version, schema_version, state, updated_at::text
     FROM player_cities WHERE user_id = $1 ORDER BY updated_at DESC`,
    [userId],
  );
  return result.rows.map(mapCity);
}

export async function getCity(
  pool: Pool,
  userId: string,
  cityId: string,
): Promise<CitySnapshot | null> {
  const result = await pool.query<CityRow>(
    `SELECT id, city_key, display_name, version, schema_version, state, updated_at::text
     FROM player_cities WHERE id = $1 AND user_id = $2`,
    [cityId, userId],
  );
  return result.rows[0] ? mapCity(result.rows[0]) : null;
}

export async function createCity(
  pool: Pool,
  userId: string,
  cityKey: string,
  displayName: string,
  state: CityState,
): Promise<CitySnapshot> {
  const id = randomUUID();
  const result = await pool.query<CityRow>(
    `INSERT INTO player_cities (id, user_id, city_key, display_name, version, state, schema_version)
     VALUES ($1, $2, $3, $4, 1, $5::jsonb, 1)
     RETURNING id, city_key, display_name, version, schema_version, state, updated_at::text`,
    [id, userId, cityKey, displayName, JSON.stringify(state)],
  );
  return mapCity(result.rows[0]!);
}

export class VersionConflictError extends Error {
  constructor() {
    super('version conflict');
    this.name = 'VersionConflictError';
  }
}

export async function saveCity(
  pool: Pool,
  userId: string,
  cityId: string,
  expectedVersion: number,
  state: CityState,
): Promise<CitySnapshot> {
  const result = await pool.query<CityRow>(
    `UPDATE player_cities
     SET state = $1::jsonb, version = version + 1, updated_at = now()
     WHERE id = $2 AND user_id = $3 AND version = $4
     RETURNING id, city_key, display_name, version, schema_version, state, updated_at::text`,
    [JSON.stringify(state), cityId, userId, expectedVersion],
  );
  if (!result.rows[0]) {
    const exists = await pool.query(
      `SELECT version FROM player_cities WHERE id = $1 AND user_id = $2`,
      [cityId, userId],
    );
    if ((exists.rowCount ?? 0) === 0) {
      const err = new Error('not found');
      err.name = 'NotFoundError';
      throw err;
    }
    throw new VersionConflictError();
  }
  return mapCity(result.rows[0]);
}
