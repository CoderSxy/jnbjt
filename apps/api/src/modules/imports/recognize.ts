import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { RecognitionContext, RecognitionDraft } from '@jnbjt/contracts';
import type { ModelClient } from '../ai/client.js';

export async function recognizeScreenshot(
  pool: Pool,
  userId: string,
  uploadId: string,
  context: RecognitionContext,
  _signal: AbortSignal,
  model?: ModelClient,
): Promise<RecognitionDraft> {
  const upload = await pool.query<{ id: string }>(
    `SELECT id FROM uploads WHERE id = $1 AND user_id = $2`,
    [uploadId, userId],
  );
  if (!upload.rows[0]) {
    throw Object.assign(new Error('upload not found'), { code: 'NOT_FOUND' });
  }

  // Without a vision model, leave fields unknown rather than inventing values.
  const fields =
    model?.isConfigured()
      ? [
          {
            path: 'inventory.粮食',
            value: null,
            raw: null,
            status: 'needs_review' as const,
            evidence: 'vision model available but requires calibrated prompt; left for review',
          },
        ]
      : [
          {
            path: 'inventory.粮食',
            value: null,
            raw: null,
            status: 'unknown' as const,
            evidence: 'model vision unavailable',
          },
        ];

  const id = randomUUID();
  await pool.query(
    `INSERT INTO recognition_drafts (id, user_id, upload_id, city_id, status, fields)
     VALUES ($1,$2,$3,$4,'pending_review',$5::jsonb)`,
    [id, userId, uploadId, context.cityId ?? null, JSON.stringify(fields)],
  );

  return {
    id,
    uploadId,
    cityId: context.cityId ?? null,
    fields,
    status: 'pending_review',
  };
}
