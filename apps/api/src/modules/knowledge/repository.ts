import type { Pool } from 'pg';
import type { KnowledgeHit, KnowledgeQuery } from '@jnbjt/contracts';

export async function searchKnowledge(
  pool: Pool,
  query: KnowledgeQuery,
): Promise<KnowledgeHit[]> {
  const limit = Math.max(1, Math.min(50, Number.isFinite(query.limit) ? Math.trunc(query.limit!) : 20));
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
    SELECT bt.id AS entity_id, bt.name, bv.city,
           COALESCE(kc.body, bt.name) AS snippet,
           COALESCE(pr.confirmation, 'draft') AS confirmation,
           sp.canonical_url AS source_url,
           kv.created_at::text AS updated_at,
           COALESCE(pr.snapshot_id, kc.snapshot_id) AS snapshot_id
    FROM building_types bt
    JOIN knowledge_versions kv ON kv.id = bt.knowledge_version_id AND kv.is_active = true
    JOIN building_variants bv ON bv.building_type_id = bt.id
    LEFT JOIN LATERAL (
      SELECT string_agg(body, E'\\n' ORDER BY heading, id) AS body,
             min(snapshot_id) AS snapshot_id
      FROM knowledge_chunks c
      WHERE c.knowledge_version_id = kv.id AND c.entity_name = bt.name
        AND c.city IS NOT DISTINCT FROM bv.city
    ) kc ON true
    LEFT JOIN LATERAL (
      SELECT CASE WHEN bool_and(confirmation IN ('reviewed', 'published'))
                  THEN 'reviewed' ELSE 'draft' END AS confirmation,
             min(snapshot_id) AS snapshot_id
      FROM production_recipes WHERE variant_id = bv.id
    ) pr ON true
    LEFT JOIN source_snapshots ss ON ss.id = COALESCE(pr.snapshot_id, kc.snapshot_id)
    LEFT JOIN source_pages sp ON sp.id = ss.source_page_id
    WHERE ($2::text IS NULL OR bv.city = $2)
      AND (bt.name ILIKE '%' || $1 || '%'
           OR COALESCE(kc.body, '') ILIKE '%' || $1 || '%'
           OR similarity(bt.name, $1) > 0.2
           OR EXISTS (
             SELECT 1 FROM entity_aliases ea
             WHERE ea.building_type_id = bt.id AND ea.alias = $1
               AND (ea.city IS NULL OR ea.city IS NOT DISTINCT FROM bv.city)
           ))
    ORDER BY CASE WHEN bt.name = $1 THEN 0
                  WHEN EXISTS (
                    SELECT 1 FROM entity_aliases ea
                    WHERE ea.building_type_id = bt.id AND ea.alias = $1
                      AND (ea.city IS NULL OR ea.city IS NOT DISTINCT FROM bv.city)
                  ) THEN 1 ELSE 2 END,
             bt.name, bv.city NULLS LAST
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
