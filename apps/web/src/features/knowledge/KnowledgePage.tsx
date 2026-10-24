import { useQuery } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

type Hit = {
  entityId: string;
  name: string;
  city: string | null;
  snippet: string;
  confirmation: string;
  sourceUrl: string | null;
  updatedAt: string | null;
  snapshotId: string | null;
};

type BuildingDetail = {
  id: string;
  name: string;
  created_at: string;
  variants: Array<{
    variantId: string;
    city: string | null;
    recipes: Array<{
      id: string;
      tier: string | null;
      durationSeconds: number | null;
      durationUnknown: boolean;
      workers: number | null;
      workersUnknown: boolean;
      inputs: unknown;
      outputs: unknown;
      confirmation: string;
      manualOverride: boolean;
      snapshotId: string | null;
    }>;
  }>;
};

async function search(q: string): Promise<Hit[]> {
  const res = await fetch(`/api/v1/knowledge/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error('search failed');
  const body = (await res.json()) as { hits: Hit[] };
  return body.hits;
}

async function loadBuilding(id: string): Promise<BuildingDetail> {
  const res = await fetch(`/api/v1/buildings/${id}`);
  if (!res.ok) throw new Error('not found');
  const body = (await res.json()) as { building: BuildingDetail };
  return body.building;
}

export function KnowledgePage() {
  const { id } = useParams();
  const [q, setQ] = useState('农田');
  const [submitted, setSubmitted] = useState('农田');

  const hitsQuery = useQuery({
    queryKey: ['knowledge-search', submitted],
    queryFn: () => search(submitted),
    enabled: submitted.length > 0,
  });

  const detailQuery = useQuery({
    queryKey: ['building', id],
    queryFn: () => loadBuilding(id!),
    enabled: Boolean(id),
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(q.trim());
  }

  return (
    <section className="panel">
      <h1>资料检索</h1>
      <p className="muted">展示来源、许可相关快照、更新时间与确认状态。未知数值不会显示为 0。</p>
      <form className="search-row" onSubmit={onSubmit}>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="建筑名 / 别名"
          aria-label="检索词"
        />
        <button type="submit">搜索</button>
      </form>

      {hitsQuery.isLoading && <p className="muted">检索中…</p>}
      {hitsQuery.isError && <p className="muted">检索失败，请确认 API 已启动并已导入知识。</p>}
      {hitsQuery.data && (
        <ul className="hit-list">
          {hitsQuery.data.map((hit) => (
            <li key={`${hit.entityId}-${hit.city ?? ''}`}>
              <Link to={`/buildings/${hit.entityId}`}>{hit.name}</Link>
              <div className="meta">
                城市：{hit.city ?? '未区分'} · 状态：{hit.confirmation}
                {hit.updatedAt ? ` · 更新：${hit.updatedAt}` : ''}
                {hit.snapshotId ? ` · 快照：${hit.snapshotId}` : ''}
              </div>
              <div className="meta">
                来源：
                {hit.sourceUrl ? (
                  <a href={hit.sourceUrl} target="_blank" rel="noreferrer">
                    {hit.sourceUrl}
                  </a>
                ) : (
                  '—'
                )}
              </div>
              <div className="muted">{hit.snippet}</div>
            </li>
          ))}
        </ul>
      )}

      {id && detailQuery.data && (
        <div className="detail">
          <h2>{detailQuery.data.name}</h2>
          <p className="meta">知识更新：{detailQuery.data.created_at}</p>
          {detailQuery.data.variants?.map((variant) => (
            <div key={variant.variantId} className="recipe">
              <strong>城市：{variant.city ?? '未区分'}</strong>
              {(variant.recipes ?? []).map((recipe) => (
                <div key={recipe.id} className="meta">
                  档位 {recipe.tier ?? '未知'} · 耗时{' '}
                  {recipe.durationUnknown ? '未知' : `${recipe.durationSeconds}s`} · 工人{' '}
                  {recipe.workersUnknown ? '未知' : recipe.workers} ·{' '}
                  {recipe.confirmation}
                  {recipe.manualOverride ? '（人工覆盖）' : ''} · snapshot{' '}
                  {recipe.snapshotId ?? '—'}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
