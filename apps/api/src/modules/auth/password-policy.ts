export type CredentialValidation = { ok: true } | { ok: false; message: string };

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;
const RESERVED_PREFIX = 'sms_';

export function validateUsername(username: string): CredentialValidation {
  const trimmed = username.trim();
  if (!USERNAME_RE.test(trimmed)) {
    return { ok: false, message: '用户名需 3–32 位，仅字母、数字、下划线' };
  }
  if (trimmed.toLowerCase().startsWith(RESERVED_PREFIX)) {
    return { ok: false, message: '该用户名前缀保留给系统使用' };
  }
  return { ok: true };
}

export function normalizeUsername(username: string): string {
  return username.trim();
}

export function validatePassword(password: string): CredentialValidation {
  if (password.length < 8) {
    return { ok: false, message: '密码至少 8 个字符' };
  }
  if (password.length > 128) {
    return { ok: false, message: '密码过长' };
  }
  return { ok: true };
}

export function validatePasswordPolicy(username: string, password: string): CredentialValidation {
  const u = validateUsername(username);
  if (!u.ok) return u;
  const p = validatePassword(password);
  if (!p.ok) return p;
  if (password.toLowerCase() === normalizeUsername(username).toLowerCase()) {
    return { ok: false, message: '密码不能与用户名相同' };
  }
  return { ok: true };
}
