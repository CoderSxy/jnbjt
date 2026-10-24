import type { QuantityExpr } from '@jnbjt/contracts';

export function parseQuantity(rawInput: string, unit: string | null | 'unknown'): QuantityExpr {
  const raw = rawInput.replace(/\u00a0/g, ' ').trim();
  if (!raw || raw === '—' || raw === '-' || raw === '?' || /^未知|unknown$/i.test(raw)) {
    return { kind: 'unknown', raw: raw || 'unknown', unit: unit ?? 'unknown' };
  }

  const sumMatch = raw.match(/^(\d+(?:\.\d+)?)\s*\+\s*(\d+(?:\.\d+)?)$/);
  if (sumMatch) {
    const a = Number(sumMatch[1]);
    const b = Number(sumMatch[2]);
    return { kind: 'sum', parts: [a, b], raw, unit: unit ?? null };
  }

  const numMatch = raw.match(/^(\d+(?:\.\d+)?)$/);
  if (numMatch) {
    return { kind: 'number', value: Number(numMatch[1]), raw, unit: unit ?? null };
  }

  return { kind: 'raw', raw, unit: unit ?? null };
}

export function parseDurationSeconds(rawInput: string): number | null | 'unknown' {
  const raw = rawInput.trim();
  if (!raw || raw === '—' || /^未知|unknown$/i.test(raw)) return 'unknown';
  const sec = raw.match(/^(\d+(?:\.\d+)?)\s*秒$/);
  if (sec) return Math.round(Number(sec[1]));
  const min = raw.match(/^(\d+(?:\.\d+)?)\s*分(?:钟)?$/);
  if (min) return Math.round(Number(min[1]) * 60);
  return 'unknown';
}

export function parseWorkers(rawInput: string): number | null | 'unknown' {
  const raw = rawInput.trim();
  if (!raw) return 'unknown';
  if (/^未知|unknown|\?$/i.test(raw)) return 'unknown';
  if (/^\d+$/.test(raw)) return Number(raw);
  return 'unknown';
}
