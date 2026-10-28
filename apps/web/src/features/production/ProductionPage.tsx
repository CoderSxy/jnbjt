import { FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

type City = {id: string; displayName: string; cityKey: string; state: {inventory: Record<string, number>}};
type Recipe = {id: string; name: string; outputs: Array<{resource: string}>; sourceNote: string};
export function ProductionPage() {
  const [params] = useSearchParams();
  const cityId = params.get('cityId');
  const [recipeId, setRecipeId] = useState('');
  const [resource, setResource] = useState('');
  const [target, setTarget] = useState('');
  const [frequency, setFrequency] = useState('');
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState('');
  const cityQuery = useQuery({queryKey: ['city', cityId], enabled: Boolean(cityId), queryFn: async () => {
    const res = await fetch(`/api/v1/cities/${cityId}`, {credentials: 'include'});
    if (!res.ok) throw new Error('城市读取失败');
    return ((await res.json()) as {city: City}).city;
  }});
  const recipes = useQuery({queryKey: ['production-recipes', cityId], enabled: Boolean(cityId), queryFn: async () => {
    const res = await fetch(`/api/v1/cities/${cityId}/production-recipes`, {credentials: 'include'});
    if (!res.ok) throw new Error('配方读取失败');
    return ((await res.json()) as {recipes: Recipe[]}).recipes;
  }});
  const recipe = recipes.data?.find((r) => r.id === recipeId);
  async function onSubmit(event: FormEvent) {
    event.preventDefault(); setError(''); setResult(null);
    try {
      const res = await fetch('/api/v1/production/calculate', {method: 'POST', credentials: 'include', headers: {'content-type': 'application/json'}, body: JSON.stringify({cityId, recipeId, targetInventory: {[resource]: Number(target)}, onlineFrequencyPerDay: Number(frequency)})});
      if (!res.ok) throw new Error('计算失败，请检查城市权限和输入');
      setResult(await res.json());
    } catch (e) {setError(e instanceof Error ? e.message : '请求失败');}
  }
  return <section className="panel">
    <h1>生产计算</h1>
    <p className="muted">按所选城市存档与已审核来源计算；每次上线立即收获并重新生产，未知条件会提示补充。</p>
    {!cityId && <p>请从 <Link to="/cities">城市存档</Link> 进入。</p>}
    {(cityQuery.isError || recipes.isError) && <p role="alert">城市或配方读取失败，请登录后重试。</p>}
    {cityQuery.data && <><p>当前城市：{cityQuery.data.displayName}（{cityQuery.data.cityKey}）</p>
    {recipes.data?.length === 0 && <p>当前城市没有已审核且有来源的有效配方。请先补充已发布并审核的资料；草稿不会用于计算。</p>}
    <form className="stack" onSubmit={onSubmit}>
      <label>生产配方<select required value={recipeId} onChange={(e) => {setRecipeId(e.target.value); setResource(''); setResult(null);}}><option value="">请选择已审核配方</option>{recipes.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      <label>目标资源<select required value={resource} onChange={(e) => {setResource(e.target.value); setResult(null);}}><option value="">请选择资源</option>{recipe?.outputs.map((o) => <option key={o.resource}>{o.resource}</option>)}</select></label>
      {resource && <p>当前库存：{cityQuery.data.state.inventory[resource] ?? '未知，请补充存档'}</p>}
      <label>目标总库存<input type="number" min="0" step="1" required value={target} onChange={(e) => setTarget(e.target.value)} /></label>
      <label>每天上线次数<input type="number" min="0.01" step="any" required value={frequency} onChange={(e) => setFrequency(e.target.value)} /></label>
      {recipe && <p className="meta">来源：{recipe.sourceNote}</p>}
      <button disabled={!recipe || !resource} type="submit">计算</button>
    </form></>}
    {error && <p role="alert">{error}</p>}
    {result != null && <pre className="recipe">{JSON.stringify(result, null, 2)}</pre>}
  </section>;
}
