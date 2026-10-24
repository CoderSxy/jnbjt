import type { ModelCapabilities } from '@jnbjt/contracts';
import { ModelClient, probeCapabilities } from './client.js';

let cached: ModelCapabilities | null = null;

export async function getModelCapabilities(
  client = new ModelClient(),
  force = false,
): Promise<ModelCapabilities> {
  if (cached && !force) return cached;
  const controller = new AbortController();
  cached = await probeCapabilities(client, controller.signal);
  return cached;
}
