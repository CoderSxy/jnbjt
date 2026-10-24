import { describe, expect, it, vi } from 'vitest';
import { ModelClient, ModelClientError } from '../apps/api/src/modules/ai/client.js';

describe('ModelClient', () => {
  it('retries timeout and JSON errors with a capped limit', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls < 3) {
        return new Response('not-json', { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"ok":true}' } }],
          model: 'test-model',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const client = new ModelClient({
      baseUrl: 'https://model.example/v1',
      apiKey: 'secret',
      modelId: 'test-model',
      fetchImpl,
      maxRetries: 2,
      sleep: async () => undefined,
    });

    const res = await client.requestModel(
      {
        purpose: 'json',
        messages: [{ role: 'user', content: 'hi' }],
        responseFormat: 'json',
      },
      new AbortController().signal,
    );
    expect(res.json).toEqual({ ok: true });
    expect(calls).toBe(3);
  });

  it('does not retry forever on non-retryable errors', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return new Response('nope', { status: 401 });
    }) as unknown as typeof fetch;

    const client = new ModelClient({
      baseUrl: 'https://model.example/v1',
      apiKey: 'secret',
      fetchImpl,
      maxRetries: 5,
      sleep: async () => undefined,
    });

    await expect(
      client.requestModel(
        { purpose: 'text', messages: [{ role: 'user', content: 'x' }] },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(ModelClientError);
    expect(calls).toBe(1);
  });

  it('reports unconfigured without claiming embedding', async () => {
    const client = new ModelClient({ baseUrl: undefined, apiKey: undefined });
    expect(client.isConfigured()).toBe(false);
  });
});
