import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

type City = {
  id: string;
  cityKey: string;
  displayName: string;
  version: number;
  state: {
    prefectLevel: number;
    inventory: Record<string, number>;
    workersAvailable: number;
    buildings: Array<{ typeName: string; level: number; count: number }>;
    unlockedAreas: string[];
  };
};

async function fetchCities(): Promise<City[]> {
  const res = await fetch('/api/v1/cities', { credentials: 'include' });
  if (res.status === 401) throw new Error('unauthorized');
  if (!res.ok) throw new Error('failed');
  return ((await res.json()) as { cities: City[] }).cities;
}

export function CitiesPage() {
  const qc = useQueryClient();
  const cities = useQuery({ queryKey: ['cities'], queryFn: fetchCities });
  const [grain, setGrain] = useState('20');
  const [selected, setSelected] = useState<City | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/v1/cities', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cityKey: 'yingtian',
          displayName: '应天府',
          state: {
            prefectLevel: 1,
            unlockedAreas: [],
            inventory: { 粮食: Number(grain) || 0 },
            buildings: [{ typeName: '农田', level: 1, count: 1 }],
            workersAvailable: 2,
          },
        }),
      });
      if (!res.ok) throw new Error('create failed');
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cities'] }),
  });

  async function saveSelected(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setMessage(null);
    const res = await fetch(`/api/v1/cities/${selected.id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expectedVersion: selected.version,
        state: {
          ...selected.state,
          inventory: { ...selected.state.inventory, 粮食: Number(grain) || 0 },
        },
      }),
    });
    if (res.status === 409) {
      setMessage('版本冲突（409）：请刷新后重试');
      return;
    }
    if (!res.ok) {
      setMessage('保存失败');
      return;
    }
    const body = (await res.json()) as { city: City };
    setSelected(body.city);
    setMessage(`已保存 version=${body.city.version}`);
    qc.invalidateQueries({ queryKey: ['cities'] });
  }

  if (cities.isError) {
    return (
      <section className="panel">
        <h1>城市存档</h1>
        <p className="muted">
          需要登录。请先 <Link to="/login">登录</Link>。
        </p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h1>城市存档</h1>
      <p className="muted">手动录入库存与建筑；保存使用乐观锁。</p>
      <button type="button" onClick={() => create.mutate()} disabled={create.isPending}>
        新建应天府存档
      </button>
      <ul className="hit-list">
        {(cities.data ?? []).map((city) => (
          <li key={city.id}>
            <button type="button" className="linkish" onClick={() => { setSelected(city); setGrain(city.state.inventory['粮食'] == null ? '' : String(city.state.inventory['粮食'])); setMessage(null); }}>
              {city.displayName}
            </button>
            <div className="meta">
              version {city.version} · 粮食 {city.state.inventory['粮食'] ?? 0}
            </div>
          </li>
        ))}
      </ul>
      {selected && (
        <form className="stack" onSubmit={saveSelected}>
          <h2>编辑 {selected.displayName}</h2>
          <label>
            粮食库存
            <input type="number" min="0" step="1" required value={grain} onChange={(e) => setGrain(e.target.value)} />
          </label>
          <button type="submit">保存</button>
          {message && <p className="muted">{message}</p>}
          <p className="meta">
            <Link to={`/production?cityId=${selected.id}`}>去生产计算</Link> · <Link to={`/editor?cityId=${selected.id}`}>编辑地图</Link>
          </p>
        </form>
      )}
    </section>
  );
}
