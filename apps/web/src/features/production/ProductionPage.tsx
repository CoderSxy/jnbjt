import { FormEvent, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

type City = {
  id: string;
  state: {
    inventory: Record<string, number>;
    workersAvailable: number;
    buildings: Array<{ typeName: string; count: number }>;
  };
};

const defaultRules = {
  recipes: [
    {
      buildingName: '农田',
      city: '应天府',
      tier: '普通',
      synthetic: true,
      sourceNote: 'synthetic demo',
      durationSeconds: 60,
      workers: 1,
      inputs: [],
      outputs: [{ resource: '粮食', amount: 15 }],
    },
  ],
  bonusOrder: ['statue', 'tech'],
  harvestIntervalSeconds: 120,
};

export function ProductionPage() {
  const [params] = useSearchParams();
  const cityId = params.get('cityId');
  const [target, setTarget] = useState('100');
  const [result, setResult] = useState<unknown>(null);

  const cityQuery = useQuery({
    queryKey: ['city', cityId],
    enabled: Boolean(cityId),
    queryFn: async () => {
      const res = await fetch(`/api/v1/cities/${cityId}`, { credentials: 'include' });
      if (!res.ok) throw new Error('city');
      return ((await res.json()) as { city: City }).city;
    },
  });

  const farmCount = useMemo(() => {
    const buildings = cityQuery.data?.state.buildings ?? [];
    return buildings.filter((b) => b.typeName === '农田').reduce((n, b) => n + b.count, 0) || 1;
  }, [cityQuery.data]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!cityQuery.data) return;
    const res = await fetch('/api/v1/production/calculate', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        input: {
          inventory: cityQuery.data.state.inventory,
          targetInventory: { 粮食: Number(target) || 0 },
          selectedRecipeKey: '农田|应天府|普通',
          availableWorkers: cityQuery.data.state.workersAvailable,
          buildingCount: farmCount,
          onlineFrequencyPerDay: 4,
        },
        rules: defaultRules,
      }),
    });
    setResult(await res.json());
  }

  return (
    <section className="panel">
      <h1>生产计算</h1>
      <p className="muted">不调用模型；未知条件会返回需补充，不会假装算完。</p>
      {!cityId && (
        <p className="muted">
          请从 <Link to="/cities">城市存档</Link> 进入。
        </p>
      )}
      {cityQuery.data && (
        <form className="stack" onSubmit={onSubmit}>
          <div className="meta">当前粮食：{cityQuery.data.state.inventory['粮食'] ?? 0}</div>
          <label>
            目标粮食
            <input value={target} onChange={(e) => setTarget(e.target.value)} />
          </label>
          <button type="submit">计算</button>
        </form>
      )}
      {result != null && (
        <pre className="recipe">{JSON.stringify(result, null, 2)}</pre>
      )}
    </section>
  );
}
