import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { assertCsrf, requireUser } from '../../plugins/auth.js';
import { storeUpload, validateImageBuffer } from '../../plugins/uploads.js';
import { VersionConflictError } from '../cities/repository.js';
import { enqueueJob, QueueLimitError } from '../jobs/repository.js';
import { applyRecognition } from './apply.js';

export async function registerImportRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/uploads', { bodyLimit: 14 * 1024 * 1024 }, async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    if (!assertCsrf(request, reply)) return;

    const body = request.body as {
      filename?: string;
      mime?: string;
      dataBase64?: string;
    };
    if (!body.dataBase64) {
      return reply.code(400).send({
        error: { code: 'BAD_REQUEST', message: 'dataBase64 required' },
        notice: '上传图片将发往已配置的模型服务（若启用视觉识别）。HEIC 请先转为 JPEG/PNG/WebP。',
      });
    }

    let image;
    try {
      const buf = Buffer.from(body.dataBase64, 'base64');
      image = await validateImageBuffer(buf, body.mime ?? body.filename);
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'BAD_IMAGE';
      return reply.code(400).send({
        error: { code, message: error instanceof Error ? error.message : String(error) },
        notice: 'HEIC 请先转换；仅 JPEG/PNG/WebP，≤10MiB。',
      });
    }

    const existing = await app.db.query<{ id: string }>(
      `SELECT id FROM uploads WHERE user_id = $1 AND content_hash = $2`,
      [user.id, image.contentHash],
    );
    if (existing.rows[0]) {
      return {
        upload: { id: existing.rows[0].id, deduplicated: true },
        notice: '相同截图不重复累加存储',
      };
    }

    const storagePath = await storeUpload(user.id, image);
    const id = randomUUID();
    await app.db.query(
      `INSERT INTO uploads (id, user_id, content_hash, mime, byte_size, width, height, storage_path)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        user.id,
        image.contentHash,
        image.mime,
        image.buffer.byteLength,
        image.width,
        image.height,
        storagePath,
      ],
    );
    return {
      upload: { id, deduplicated: false, mime: image.mime, width: image.width, height: image.height },
      notice: '图片仅私有保存；启用识别时会发送到配置的模型服务。',
    };
  });

  app.get('/api/v1/uploads/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const row = await app.db.query(
      `SELECT id, mime, byte_size, width, height, created_at FROM uploads WHERE id = $1 AND user_id = $2`,
      [id, user.id],
    );
    if (!row.rows[0]) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'upload not found' } });
    }
    return { upload: row.rows[0] };
  });

  app.post('/api/v1/recognition-jobs', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    if (!assertCsrf(request, reply)) return;
    const body = request.body as { uploadId?: string; cityId?: string; key?: string };
    if (!body.uploadId || !body.key) {
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'uploadId and key required' } });
    }
    const upload = await app.db.query('SELECT id FROM uploads WHERE id=$1 AND user_id=$2', [body.uploadId, user.id]);
    if (!upload.rows[0]) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'upload not found' } });
    if (body.cityId) {
      const city = await app.db.query('SELECT id FROM player_cities WHERE id=$1 AND user_id=$2', [body.cityId, user.id]);
      if (!city.rows[0]) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'city not found' } });
    }
    try {
      const job = await enqueueJob(app.db, user.id, body.key, {
        kind: 'recognition',
        uploadId: body.uploadId,
        ...(body.cityId ? { cityId: body.cityId } : {}),
      });
      return reply.code(202).send({ job });
    } catch (error) {
      if (error instanceof QueueLimitError) {
        return reply.code(429).send({ error: { code: 'QUEUE_LIMIT', message: error.message } });
      }
      throw error;
    }
  });

  app.get('/api/v1/recognition-drafts/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const result = await app.db.query('SELECT id, upload_id AS "uploadId", city_id AS "cityId", fields, status FROM recognition_drafts WHERE id=$1 AND user_id=$2', [id, user.id]);
    if (!result.rows[0]) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'draft not found' } });
    const draft = result.rows[0];
    const city = draft.cityId ? await app.db.query('SELECT id, display_name AS "displayName", version, state FROM player_cities WHERE id=$1 AND user_id=$2', [draft.cityId, user.id]) : null;
    return { draft, city: city?.rows[0] ?? null };
  });

  app.post('/api/v1/recognition-drafts/:id/apply', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    if (!assertCsrf(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = request.body as {
      expectedVersion?: number;
      corrections?: { fields: Array<{ path: string; value: string | number | null; raw: string | null; status: 'known' | 'unknown' | 'needs_review' }> };
    };
    if (body.expectedVersion == null || !body.corrections) {
      return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'expectedVersion and corrections required' } });
    }
    try {
      const city = await applyRecognition(
        app.db,
        user.id,
        id,
        body.expectedVersion,
        body.corrections,
      );
      return { city };
    } catch (error) {
      if (error instanceof VersionConflictError) {
        return reply.code(409).send({ error: { code: 'VERSION_CONFLICT', message: 'version conflict' } });
      }
      const code = (error as { code?: string }).code;
      if (code === 'NOT_FOUND') {
        return reply.code(404).send({ error: { code, message: (error as Error).message } });
      }
      if (code === 'CONFLICT' || code === 'BAD_REQUEST') {
        return reply.code(400).send({ error: { code, message: (error as Error).message } });
      }
      throw error;
    }
  });
}
