import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'sms' | 'password'>('sms');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false);
  const [debugCode, setDebugCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSendCode(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setDebugCode(null);
    const res = await fetch('/api/v1/auth/sms/send-code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ phone, purpose: 'login' }),
    });
    const body = (await res.json()) as { debugCode?: string; error?: { message: string } };
    if (!res.ok) {
      setError(body.error?.message ?? '发送失败');
      return;
    }
    setSent(true);
    if (body.debugCode) setDebugCode(body.debugCode);
  }

  async function onVerify(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const res = await fetch('/api/v1/auth/sms/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        phone,
        code,
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
      }),
    });
    if (!res.ok) {
      const body = (await res.json()) as { error?: { message: string } };
      setError(body.error?.message ?? '验证失败');
      return;
    }
    navigate('/cities');
  }

  async function onPasswordLogin(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      setError('登录失败');
      return;
    }
    navigate('/cities');
  }

  return (
    <section className="panel">
      <h1>登录</h1>
      <p className="muted">规划工具独立账号（非游戏登录）。推荐手机号验证码；管理员仍可用密码。</p>
      <p className="meta">
        <button type="button" onClick={() => setMode('sms')} disabled={mode === 'sms'}>
          短信登录
        </button>{' '}
        <button type="button" onClick={() => setMode('password')} disabled={mode === 'password'}>
          密码登录
        </button>
      </p>
      {mode === 'sms' ? (
        <>
          <form className="stack" onSubmit={onSendCode}>
            <label>
              手机号
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="11 位中国大陆手机号"
                autoComplete="tel"
              />
            </label>
            <button type="submit" disabled={!phone.trim()}>
              {sent ? '重新发送验证码' : '发送验证码'}
            </button>
          </form>
          {debugCode && (
            <p className="muted">开发模式验证码：{debugCode}（生产环境不会返回）</p>
          )}
          <form className="stack" onSubmit={onVerify}>
            <label>
              验证码
              <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" />
            </label>
            <label>
              昵称（首次注册可选）
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </label>
            {error && <p className="muted">{error}</p>}
            <button type="submit" disabled={!sent || code.length < 4}>
              登录 / 注册
            </button>
          </form>
        </>
      ) : (
        <form className="stack" onSubmit={onPasswordLogin}>
          <label>
            用户名
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          </label>
          <label>
            密码
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          {error && <p className="muted">{error}</p>}
          <button type="submit">登录</button>
        </form>
      )}
    </section>
  );
}
