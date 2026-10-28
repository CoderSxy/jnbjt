/** Normalize mainland China mobile to E.164 (+86…) or reject. */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim().replace(/[\s-]/g, '');
  if (/^1\d{10}$/.test(trimmed)) return `+86${trimmed}`;
  if (/^\+861\d{10}$/.test(trimmed)) return trimmed;
  if (/^00861\d{10}$/.test(trimmed)) return `+86${trimmed.slice(4)}`;
  return null;
}

export function maskPhone(phone: string): string {
  if (phone.startsWith('+86') && phone.length >= 14) {
    return `${phone.slice(0, 6)}****${phone.slice(-4)}`;
  }
  return phone.replace(/\d(?=\d{4})/g, '*');
}
