import type { ModelCapabilities, ModelRequest, ModelResponse } from '@jnbjt/contracts';

export type ModelClientConfig = {
  baseUrl?: string;
  apiKey?: string;
  modelId?: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export class ModelClientError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ModelClientError';
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class ModelClient {
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly baseUrl: string | undefined;
  private readonly apiKey: string | undefined;
  private readonly modelId: string;

  constructor(private readonly config: ModelClientConfig = {}) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.maxRetries = config.maxRetries ?? 2;
    this.sleep = config.sleep ?? defaultSleep;
    this.baseUrl = config.baseUrl ?? process.env.MODEL_BASE_URL ?? undefined;
    this.apiKey = config.apiKey ?? process.env.MODEL_API_KEY ?? undefined;
    this.modelId = config.modelId ?? process.env.MODEL_ID ?? 'unconfigured';
  }

  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.apiKey);
  }

  async requestModel(input: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    if (!this.isConfigured()) {
      throw new ModelClientError('model gateway not configured', false);
    }

    let attempt = 0;
    while (true) {
      try {
        return await this.once(input, signal);
      } catch (error) {
        const retryable =
          error instanceof ModelClientError
            ? error.retryable
            : /timeout|JSON|5\d\d|network/i.test(String(error));
        if (!retryable || attempt >= this.maxRetries || signal.aborted) {
          throw error;
        }
        attempt += 1;
        await this.sleep(200 * 2 ** (attempt - 1));
      }
    }
  }

  private async once(input: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    const timeoutMs = input.timeoutMs ?? 20_000;
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal.addEventListener('abort', onAbort);
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const body: Record<string, unknown> = {
        model: this.modelId,
        messages: input.messages,
      };
      if (input.responseFormat === 'json' || input.purpose === 'json') {
        body.response_format = { type: 'json_object' };
      }
      if (input.images?.length) {
        // Attach as multimodal content on last user message when vision is requested
        const messages = input.messages.map((m) => ({ ...m }));
        const lastUser = [...messages].reverse().find((m) => m.role === 'user');
        if (lastUser) {
          lastUser.content = JSON.stringify({
            text: lastUser.content,
            images: input.images.map(() => '[image omitted from logs]'),
          });
        }
        body.messages = messages;
        body._images = input.images;
      }

      const res = await this.fetchImpl(`${this.baseUrl!.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.modelId,
          messages: input.messages,
          ...(input.responseFormat === 'json' || input.purpose === 'json'
            ? { response_format: { type: 'json_object' } }
            : {}),
        }),
      });

      if (res.status >= 500 || res.status === 429) {
        throw new ModelClientError(`model HTTP ${res.status}`, true);
      }
      if (!res.ok) {
        throw new ModelClientError(`model HTTP ${res.status}`, false);
      }

      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw new ModelClientError('model response JSON error', true);
      }

      const record = json as {
        choices?: Array<{ message?: { content?: string } }>;
        model?: string;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = record.choices?.[0]?.message?.content ?? '';
      if (!text) throw new ModelClientError('empty model content', true);

      const response: ModelResponse = {
        text,
        modelId: record.model ?? this.modelId,
      };
      if (input.responseFormat === 'json' || input.purpose === 'json') {
        try {
          response.json = JSON.parse(text);
        } catch {
          throw new ModelClientError('model JSON parse error', true);
        }
      }
      if (record.usage) {
        response.usage = {
          ...(record.usage.prompt_tokens != null
            ? { promptTokens: record.usage.prompt_tokens }
            : {}),
          ...(record.usage.completion_tokens != null
            ? { completionTokens: record.usage.completion_tokens }
            : {}),
        };
      }
      return response;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ModelClientError('model timeout', true);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  }
}

export async function probeCapabilities(
  client: ModelClient,
  signal: AbortSignal,
): Promise<ModelCapabilities> {
  if (!client.isConfigured()) {
    return {
      text: false,
      vision: false,
      embedding: false,
      modelId: null,
      probedAt: new Date().toISOString(),
      unavailableReason: 'MODEL_BASE_URL/MODEL_API_KEY not set',
    };
  }

  try {
    const text = await client.requestModel(
      {
        purpose: 'text',
        messages: [{ role: 'user', content: 'Reply with the single word: pong' }],
        timeoutMs: 8_000,
      },
      signal,
    );
    return {
      text: /pong/i.test(text.text),
      vision: false, // require separate vision probe; do not claim
      embedding: false,
      modelId: text.modelId,
      probedAt: new Date().toISOString(),
      unavailableReason: null,
    };
  } catch (error) {
    return {
      text: false,
      vision: false,
      embedding: false,
      modelId: null,
      probedAt: new Date().toISOString(),
      unavailableReason: error instanceof Error ? error.message : String(error),
    };
  }
}
