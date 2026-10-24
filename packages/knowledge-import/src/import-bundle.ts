import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { KnowledgeBundle, ParsedBuildingDraft } from '@jnbjt/contracts';

export type ImportReport = {
  importId: string;
  status: 'staged' | 'rejected' | 'published';
  created: number;
  updated: number;
  skipped: number;
  preservedManualOverrides: number;
  activatedVersionId?: string;
  previousActiveVersionId?: string | null;
  errors: string[];
};

function qtyFields(duration: number | null | 'unknown'): {
  duration_seconds: number | null;
  duration_unknown: boolean;
} {
  if (duration === 'unknown' || duration === null) {
    return { duration_seconds: null, duration_unknown: true };
  }
  return { duration_seconds: duration, duration_unknown: false };
}

function workerFields(workers: number | null | 'unknown'): {
  workers: number | null;
  workers_unknown: boolean;
} {
  if (workers === 'unknown' || workers === null) {
    return { workers: null, workers_unknown: true };
  }
  return { workers, workers_unknown: false };
}

async function upsertSnapshot(
  client: PoolClient,
  draft: ParsedBuildingDraft,
  html: string,
): Promise<string> {
  const pageId = `page_${createHash('sha256').update(draft.sourceUrl).digest('hex').slice(0, 16)}`;
  await client.query(
    `INSERT INTO source_pages (id, canonical_url, title, license)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (canonical_url) DO UPDATE SET title = EXCLUDED.title`,
    [pageId, draft.sourceUrl, draft.name, 'CC BY-NC-SA 3.0'],
  );
  const contentHash = createHash('sha256').update(html).digest('hex');
  const snapshotId = draft.snapshotId;
  await client.query(
    `INSERT INTO source_snapshots (id, source_page_id, revision, content_hash, html, fetched_at, parser_version, robots_allowed)
     VALUES ($1, $2, $3, $4, $5, now(), $6, true)
     ON CONFLICT (id) DO NOTHING`,
    [snapshotId, pageId, draft.revision === 'unknown' ? null : draft.revision, contentHash, html, '1.0.0'],
  );
  return snapshotId;
}

export async function importKnowledgeBundle(
  pool: Pool,
  bundle: KnowledgeBundle,
  options: {
    publish?: boolean;
    htmlBySnapshotId?: Record<string, string>;
  } = {},
): Promise<ImportReport> {
  const client = await pool.connect();
  const report: ImportReport = {
    importId: randomUUID(),
    status: 'staged',
    created: 0,
    updated: 0,
    skipped: 0,
    preservedManualOverrides: 0,
    errors: [],
  };

  try {
    await client.query('BEGIN');

    const existing = await client.query<{ id: string }>(
      `SELECT id FROM knowledge_imports WHERE content_hash = $1 AND status = 'published' LIMIT 1`,
      [bundle.contentHash],
    );
    if (existing.rowCount && options.publish) {
      report.skipped = bundle.drafts.length;
      report.status = 'published';
      await client.query('ROLLBACK');
      report.importId = existing.rows[0]!.id;
      return report;
    }

    await client.query(
      `INSERT INTO knowledge_imports (id, bundle_id, content_hash, status, report)
       VALUES ($1, $2, $3, 'staged', $4::jsonb)`,
      [report.importId, bundle.bundleId, bundle.contentHash, JSON.stringify({ drafts: bundle.drafts.length })],
    );

    if (!options.publish) {
      await client.query('COMMIT');
      return report;
    }

    const prev = await client.query<{ id: string }>(
      `SELECT id FROM knowledge_versions WHERE is_active = true LIMIT 1`,
    );
    const previousActiveVersionId = prev.rows[0]?.id ?? null;

    const versionId = randomUUID();
    await client.query(
      `INSERT INTO knowledge_versions (id, import_id, label, is_active)
       VALUES ($1, $2, $3, false)`,
      [versionId, report.importId, `v-${bundle.bundleId}`],
    );

    for (const draft of bundle.drafts) {
      const html = options.htmlBySnapshotId?.[draft.snapshotId] ?? '';
      await upsertSnapshot(client, draft, html);

      const buildingId = randomUUID();
      await client.query(
        `INSERT INTO building_types (id, name, knowledge_version_id) VALUES ($1, $2, $3)`,
        [buildingId, draft.name, versionId],
      );
      report.created += 1;

      for (const variant of draft.variants) {
        const variantId = randomUUID();
        await client.query(
          `INSERT INTO building_variants (id, building_type_id, city) VALUES ($1, $2, $3)`,
          [variantId, buildingId, variant.city === 'unknown' ? null : variant.city],
        );
        for (const recipe of variant.recipes) {
          // Preserve manual overrides from previous active version when same name+city+tier
          if (previousActiveVersionId) {
            const override = await client.query(
              `SELECT pr.id FROM production_recipes pr
               JOIN building_variants bv ON bv.id = pr.variant_id
               JOIN building_types bt ON bt.id = bv.building_type_id
               WHERE bt.knowledge_version_id = $1 AND bt.name = $2
                 AND COALESCE(bv.city, '') = COALESCE($3, '')
                 AND COALESCE(pr.tier, '') = COALESCE($4, '')
                 AND pr.manual_override = true
               LIMIT 1`,
              [
                previousActiveVersionId,
                draft.name,
                variant.city === 'unknown' ? null : variant.city,
                recipe.tier === 'unknown' ? null : recipe.tier,
              ],
            );
            if ((override.rowCount ?? 0) > 0) {
              report.preservedManualOverrides += 1;
              // Copy override recipe forward instead of imported draft values
              const old = await client.query(
                `SELECT * FROM production_recipes WHERE id = $1`,
                [override.rows[0]!.id],
              );
              const row = old.rows[0]!;
              await client.query(
                `INSERT INTO production_recipes (
                   id, variant_id, tier, duration_seconds, duration_unknown, workers, workers_unknown,
                   inputs, outputs, raw_cells, confirmation, manual_override, snapshot_id
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,true,$12)`,
                [
                  randomUUID(),
                  variantId,
                  row.tier,
                  row.duration_seconds,
                  row.duration_unknown,
                  row.workers,
                  row.workers_unknown,
                  JSON.stringify(row.inputs),
                  JSON.stringify(row.outputs),
                  JSON.stringify(row.raw_cells),
                  row.confirmation,
                  row.snapshot_id,
                ],
              );
              continue;
            }
          }

          const d = qtyFields(recipe.durationSeconds);
          const w = workerFields(recipe.workers);
          await client.query(
            `INSERT INTO production_recipes (
               id, variant_id, tier, duration_seconds, duration_unknown, workers, workers_unknown,
               inputs, outputs, raw_cells, confirmation, manual_override, snapshot_id
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,'draft',false,$11)`,
            [
              randomUUID(),
              variantId,
              recipe.tier === 'unknown' ? null : recipe.tier,
              d.duration_seconds,
              d.duration_unknown,
              w.workers,
              w.workers_unknown,
              JSON.stringify(recipe.inputs),
              JSON.stringify(recipe.outputs),
              JSON.stringify(recipe.rawCells),
              draft.snapshotId,
            ],
          );
        }
      }
    }

    for (const chunk of bundle.chunks) {
      await client.query(
        `INSERT INTO knowledge_chunks (id, knowledge_version_id, entity_name, city, heading, body, snapshot_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          randomUUID(),
          versionId,
          chunk.entityName,
          chunk.city === 'unknown' ? null : chunk.city,
          chunk.heading,
          chunk.body,
          chunk.snapshotId,
        ],
      );
    }

    // Activate only after full success
    await client.query(`UPDATE knowledge_versions SET is_active = false WHERE is_active = true`);
    await client.query(`UPDATE knowledge_versions SET is_active = true WHERE id = $1`, [versionId]);
    await client.query(`UPDATE knowledge_imports SET status = 'published' WHERE id = $1`, [report.importId]);

    report.status = 'published';
    report.activatedVersionId = versionId;
    report.previousActiveVersionId = previousActiveVersionId;
    await client.query('COMMIT');
    return report;
  } catch (error) {
    await client.query('ROLLBACK');
    report.status = 'rejected';
    report.errors.push(error instanceof Error ? error.message : String(error));
    return report;
  } finally {
    client.release();
  }
}
