import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

type MeUser = {
  id: string;
  username: string;
  displayName?: string;
  phone?: string;
};

export function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'sms' | 'login' | 'register'>('sms');
  const [me, setMe] = useState<MeUser | null>(null);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regDisplayName, setRegDisplayName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [bindPhone, setBindPhone] = useState('');
  const [bindCode, setBindCode] = useState('');
  const [sent, setSent] = useState(false);
  const [bindSent, setBindSent] = useState(false);
  const [debugCode, setDebugCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/auth/me', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => setMe(body?.user ?? null))
      .catch(() => setMe(null));
  }, [msg]);

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
    const body = (await res.json()) as { error?: { message: string } };
    if (!res.ok) {
      setError(body.error?.message ?? '登录失败');
      return;
    }
    navigate('/cities');
  }

  async function onRegister(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const res = await fetch('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        username: regUsername,
        password: regPassword,
        ...(regDisplayName.trim() ? { displayName: regDisplayName.trim() } : {}),
      }),
    });
    const body = (await res.json()) as { error?: { message: string } };
    if (!res.ok) {
      setError(body.error?.message ?? '注册失败');
      return;
    }
    navigate('/cities');
  }

  async function onSetPassword(event: FormEvent) {
    event.preventDefault();
    setMsg(null);
    const res = await fetch('/api/v1/auth/set-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ password: newPassword }),
    });
    const body = (await res.json()) as { error?: { message: string } };
    if (!res.ok) {
      setMsg(body.error?.message ?? '设置失败');
      return;
    }
    setMsg('密码已设置');
    setNewPassword('');
  }

  async function onSendBindCode(event: FormEvent) {
    event.preventDefault();
    const res = await fetch('/api/v1/auth/sms/send-code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ phone: bindPhone, purpose: 'login' }),
    });
    if (res.ok) setBindSent(true);
    else setMsg('发送验证码失败');
  }

  async function onBindPhone(event: FormEvent) {
    event.preventDefault();
    const res = await fetch('/api/v1/auth/bind-phone', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ phone: bindPhone, code: bindCode }),
    });
    const body = (await res.json()) as { error?: { message: string }; phone?: string };
    if (!res.ok) {
      setMsg(body.error?.message ?? '绑定失败');
      return;
    }
    setMsg(`已绑定手机 ${body.phone ?? ''}`);
  }

  if (me) {
    return (
      <section className="panel">
        <h1>账号</h1>
        <p className="muted">已登录：{me.displayName ?? me.username}{me.phone ? ` · ${me.phone}` : ''}</p>
        <form className="stack" onSubmit={onSetPassword}>
          <h2>设置登录密码</h2>
          <p className="muted">短信用户可在此设置密码，之后可用「密码登录」。</p>
          <label>
            新密码
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </label>
          <button type="submit">保存密码</button>
        </form>
        {!me.phone && (
          <>
            <form className="stack" onSubmit={onSendBindCode}>
              <h2>绑定手机号</h2>
              <label>
                手机号
                <input value={bindPhone} onChange={(e) => setBindPhone(e.target.value)} />
              </label>
              <button type="submit">发送验证码</button>
            </form>
            <form className="stack" onSubmit={onBindPhone}>
              <label>
                验证码
                <input value={bindCode} onChange={(e) => setBindCode(e.target.value)} />
              </label>
              <button type="submit" disabled={!bindSent}>
                确认绑定
              </button>
            </form>
          </>
        )}
        {msg && <p className="muted">{msg}</p>}
        <p>
          <button type="button" onClick={() => navigate('/cities')}>
            进入存档
          </button>
        </p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h1>登录 / 注册</h1>
      <p className="muted">规划工具独立账号（非游戏登录）。</p>
      <p className="meta">
        <button type="button" onClick={() => setMode('sms')} disabled={mode === 'sms'}>
          短信
        </button>{' '}
        <button type="button" onClick={() => setMode('login')} disabled={mode === 'login'}>
          密码登录
        </button>{' '}
        <button type="button" onClick={() => setMode('register')} disabled={mode === 'register'}>
          注册
        </button>
      </p>
      {mode === 'sms' && (
        <>
          <form className="stack" onSubmit={onSendCode}>
            <label>
              手机号
              <input value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
            </label>
            <button type="submit" disabled={!phone.trim()}>
              {sent ? '重新发送验证码' : '发送验证码'}
            </button>
          </form>
          {debugCode && <p className="muted">开发模式验证码：{debugCode}</p>}
          <form className="stack" onSubmit={onVerify}>
            <label>
              验证码
              <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" />
            </label>
            <label>
              昵称（首次可选）
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </label>
            <button type="submit" disabled={!sent || code.length < 4}>
              登录 / 注册
            </button>
          </form>
        </>
      )}
      {mode === 'login' && (
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
          <button type="submit">登录</button>
        </form>
      )}
      {mode === 'register' && (
        <form className="stack" onSubmit={onRegister}>
          <label>
            用户名
            <input value={regUsername} onChange={(e) => setRegUsername(e.target.value)} autoComplete="username" />
          </label>
          <label>
            密码（至少 8 位）
            <input
              type="password"
              value={regPassword}
              onChange={(e) => setRegPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label>
            昵称（可选）
            <input value={regDisplayName} onChange={(e) => setRegDisplayName(e.target.value)} />
          </label>
          <button type="submit">注册并登录</button>
        </form>
      )}
      {error && <p className="muted">{error}</p>}
    </section>
  );
}
