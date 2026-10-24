import type { Pool } from 'pg';
import type { KnowledgeHit, KnowledgeQuery } from '@jnbjt/contracts';

export async function searchKnowledge(
  pool: Pool,
  query: KnowledgeQuery,
): Promise<KnowledgeHit[]> {
  const limit = query.limit ?? 20;
  const q = query.q.trim();
  if (!q) return [];

  const city = query.city ?? null;
  const rows = await pool.query<{
    entity_id: string;
    name: string;
    city: string | null;
    snippet: string;
    confirmation: string;
    source_url: string | null;
    updated_at: string | null;
    snapshot_id: string | null;
  }>(
    `
    WITH active AS (
      SELECT id FROM knowledge_versions WHERE is_active = true LIMIT 1
    )
    SELECT * FROM (
      SELECT
        bt.id AS entity_id,
        bt.name,
        bv.city,
        COALESCE(kc.body, bt.name) AS snippet,
        COALESCE(pr.confirmation, 'published') AS confirmation,
        sp.canonical_url AS source_url,
        kv.created_at::text AS updated_at,
        pr.snapshot_id::text AS snapshot_id,
        0 AS rank_bucket
      FROM building_types bt
      JOIN knowledge_versions kv ON kv.id = bt.knowledge_version_id
      JOIN active a ON a.id = kv.id
      LEFT JOIN building_variants bv ON bv.building_type_id = bt.id
      LEFT JOIN production_recipes pr ON pr.variant_id = bv.id
      LEFT JOIN source_snapshots ss ON ss.id = pr.snapshot_id
      LEFT JOIN source_pages sp ON sp.id = ss.source_page_id
      LEFT JOIN knowledge_chunks kc ON kc.building_type_id = bt.id
      WHERE bt.name = $1
        AND ($2::text IS NULL OR bv.city = $2)

      UNION ALL

      SELECT
        bt.id, bt.name, bv.city,
        COALESCE(ea.alias, bt.name) AS snippet,
        'published', sp.canonical_url, kv.created_at::text, pr.snapshot_id::text,
        1
      FROM entity_aliases ea
      JOIN building_types bt ON bt.id = ea.building_type_id
      JOIN knowledge_versions kv ON kv.id = bt.knowledge_version_id
      JOIN active a ON a.id = kv.id
      LEFT JOIN building_variants bv ON bv.building_type_id = bt.id
      LEFT JOIN production_recipes pr ON pr.variant_id = bv.id
      LEFT JOIN source_snapshots ss ON ss.id = pr.snapshot_id
      LEFT JOIN source_pages sp ON sp.id = ss.source_page_id
      WHERE ea.alias = $1
        AND ($2::text IS NULL OR bv.city = $2 OR ea.city = $2)

      UNION ALL

      SELECT
        bt.id, bt.name, bv.city,
        COALESCE(kc.body, bt.name),
        'published', sp.canonical_url, kv.created_at::text, pr.snapshot_id::text,
        2
      FROM building_types bt
      JOIN knowledge_versions kv ON kv.id = bt.knowledge_version_id
      JOIN active a ON a.id = kv.id
      LEFT JOIN building_variants bv ON bv.building_type_id = bt.id
      LEFT JOIN production_recipes pr ON pr.variant_id = bv.id
      LEFT JOIN source_snapshots ss ON ss.id = pr.snapshot_id
      LEFT JOIN source_pages sp ON sp.id = ss.source_page_id
      LEFT JOIN knowledge_chunks kc ON kc.entity_name = bt.name AND kc.knowledge_version_id = kv.id
      WHERE (
          bt.name LIKE '%' || $1 || '%'
          OR COALESCE(kc.body, '') LIKE '%' || $1 || '%'
          OR similarity(bt.name, $1) > 0.2
        )
        AND ($2::text IS NULL OR bv.city = $2)
    ) ranked
    ORDER BY rank_bucket ASC, name ASC
    LIMIT $3
    `,
    [q, city, limit],
  );

  const seen = new Set<string>();
  const hits: KnowledgeHit[] = [];
  for (const row of rows.rows) {
    const key = `${row.entity_id}:${row.city ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({
      entityId: row.entity_id,
      name: row.name,
      city: row.city ?? null,
      snippet: row.snippet.slice(0, 240),
      confirmation: row.confirmation,
      sourceUrl: row.source_url,
      updatedAt: row.updated_at,
      snapshotId: row.snapshot_id,
    });
  }
  return hits;
}

export async function getBuildingById(pool: Pool, id: string) {
  const result = await pool.query(
    `
    SELECT bt.id, bt.name, kv.created_at, kv.id AS knowledge_version_id,
           json_agg(DISTINCT jsonb_build_object(
             'variantId', bv.id,
             'city', bv.city,
             'recipes', (
               SELECT coalesce(json_agg(jsonb_build_object(
                 'id', pr.id,
                 'tier', pr.tier,
                 'durationSeconds', pr.duration_seconds,
                 'durationUnknown', pr.duration_unknown,
                 'workers', pr.workers,
                 'workersUnknown', pr.workers_unknown,
                 'inputs', pr.inputs,
                 'outputs', pr.outputs,
                 'confirmation', pr.confirmation,
                 'manualOverride', pr.manual_override,
                 'snapshotId', pr.snapshot_id
               )), '[]'::json)
               FROM production_recipes pr WHERE pr.variant_id = bv.id
             )
           )) AS variants
    FROM building_types bt
    JOIN knowledge_versions kv ON kv.id = bt.knowledge_version_id AND kv.is_active = true
    LEFT JOIN building_variants bv ON bv.building_type_id = bt.id
    WHERE bt.id = $1
    GROUP BY bt.id, bt.name, kv.created_at, kv.id
    `,
    [id],
  );
  return result.rows[0] ?? null;
}
