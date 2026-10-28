import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { ModelClient } from '../apps/api/src/modules/ai/client.js';
import { recognizeScreenshot } from '../apps/api/src/modules/imports/recognize.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

describe('vision pipeline', () => {
  it('sends an OpenAI image_url content part with the original text', async () => {
    let sent: any;
    const model = new ModelClient({ baseUrl: 'https://model.invalid/v1', apiKey: 'test', maxRetries: 0,
      fetchImpl: (async (_url, init) => {
        sent = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"fields":[]}' } }] }));
      }) as typeof fetch,
    });
    await model.requestModel({ purpose: 'vision', messages: [{ role: 'user', content: 'Read screenshot' }], images: ['data:image/png;base64,AA=='] }, new AbortController().signal);
    expect(sent.messages[0].content).toEqual([{ type: 'text', text: 'Read screenshot' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }]);
    expect(sent).not.toHaveProperty('_images');
  });

  it('reads private bytes and validates recognized resource quantities before saving', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vision-'));
    const file = join(dir, 'private.png');
    await writeFile(file, png);
    const writes: any[] = [];
    const pool = { query: async (sql: string, params: any[]) => {
      if (sql.includes('FROM uploads')) return { rows: [{ id: 'upload', storage_path: file, mime: 'image/png' }] };
      if (sql.includes('INSERT INTO recognition_drafts')) { writes.push(params); return { rows: [{ id: params[0], fields: JSON.parse(params[4]), status: 'pending_review' }] }; }
      return { rows: [] };
    }} as unknown as Pool;
    let request: any;
    const model = { isConfigured: () => true, requestModel: async (input: any) => {
      request = input;
      return { json: { fields: [
        { path: 'inventory.粮食', value: 42, raw: '42', status: 'known', evidence: '粮食图标右侧' },
        { path: 'inventory.木头', value: -1, raw: '-1', status: 'known' },
        { path: 'inventory.布', value: null, raw: '?', status: 'unknown' },
        { path: 'cityId', value: 7, raw: '7', status: 'known' },
      ] } };
    }} as unknown as ModelClient;
    try {
      const draft = await recognizeScreenshot(pool, randomUUID(), 'upload', {}, new AbortController().signal, model);
      expect(request.images).toEqual([`data:image/png;base64,${png.toString('base64')}`]);
      expect(draft.fields).toHaveLength(3);
      expect(draft.fields[0]).toMatchObject({ value: 42, raw: '42', evidence: '粮食图标右侧' });
      expect(draft.fields[1]).toMatchObject({ value: null, status: 'needs_review' });
      expect(draft.fields[2]).toMatchObject({ value: null, status: 'unknown' });
      expect(writes).toHaveLength(1);
    } finally { await rm(dir, { recursive: true }); }
  });

  it('does not persist a draft after cancellation during recognition', async () => {
    const controller = new AbortController();
    let saved = false;
    const pool = { query: async (sql: string) => {
      if (sql.includes('FROM uploads')) { controller.abort(); return { rows: [{ id: 'u' }] }; }
      saved = true; return { rows: [] };
    }} as unknown as Pool;
    await expect(recognizeScreenshot(pool, 'owner', 'u', {}, controller.signal)).rejects.toThrow(/abort|cancel/i);
    expect(saved).toBe(false);
  });
});

it('probes visual content before reporting vision capability', async () => {
  const { probeCapabilities } = await import('../apps/api/src/modules/ai/client.js');
  const client = { isConfigured: () => true, requestModel: async (input: any) => ({ text: input.purpose === 'vision' ? 'black' : 'pong', modelId: 'controlled' }) } as ModelClient;
  expect((await probeCapabilities(client, new AbortController().signal)).vision).toBe(true);
});

it('locks the owned running job before persisting and checks abort before commit', async () => {
  const events: string[] = [];
  const controller = new AbortController();
  const client = {
    query: async (sql: string, params?: any[]) => {
      events.push(sql);
      if (sql.includes('FOR UPDATE')) return { rows: [{ status: 'running' }] };
      if (sql.includes('INSERT INTO recognition_drafts')) {
        controller.abort();
        return { rows: [{ id: params?.[0], fields: [], status: 'pending_review' }] };
      }
      return { rows: [] };
    }, release: () => events.push('release'),
  };
  const pool = { connect: async () => client, query: async (sql: string) => {
    if (sql.includes('FROM uploads')) return { rows: [{ id: 'upload' }] };
    return client.query(sql);
  }} as unknown as Pool;
  await expect(recognizeScreenshot(pool, 'owner', 'upload', {}, controller.signal, undefined, 'job')).rejects.toThrow(/abort/i);
  expect(events[0]).toBe('BEGIN');
  expect(events[1]).toMatch(/FROM jobs.*FOR UPDATE/s);
  expect(events).toContain('ROLLBACK');
  expect(events).not.toContain('COMMIT');
});
