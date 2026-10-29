import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AnswerSources } from './AnswerSources';

type PlanDraftView = {
  id: string;
  status: string;
  payload: {
    inventoryDiff: Record<string, number>;
    blockers: string[];
    missing: string[];
    assumptions: string[];
    suggestions: string[];
    production?: { status: string; rounds: number | null; gaps: Record<string, number> };
    planContext?: { recipeLabel?: string; targetInventory?: Record<string, number> };
  };
  city: { id: string; version: number; displayName: string } | null;
};

export function AssistantPage() {
  const [cityId, setCityId] = useState('');
  const cities = useQuery({queryKey: ['cities'], queryFn: async () => {
    const response = await fetch('/api/v1/cities', {credentials: 'include'});
    if (!response.ok) throw new Error('城市读取失败');
    return ((await response.json()) as {cities: Array<{id: string; displayName: string; cityKey: string}>}).cities;
  }});
  const [question, setQuestion] = useState('应天府农田普通档粮食到30，每天上线4次');
  const [jobId, setJobId] = useState<string | null>(null);
  const [planDraft, setPlanDraft] = useState<PlanDraftView | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);

  async function loadPlanDraft(id: string) {
    const res = await fetch(`/api/v1/plan-drafts/${id}`, { credentials: 'include' });
    if (!res.ok) return;
    const body = (await res.json()) as { draft: PlanDraftView };
    setPlanDraft(body.draft);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setApplyMsg(null);
    setResult(null);
    setPlanDraft(null);
    const res = await fetch('/api/v1/assistant/runs', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question, ...(cityId ? {cityId} : {}), key: `ask-${Date.now()}` }),
    });
    if (!res.ok) {
      setError('提交失败（需登录）');
      return;
    }
    const body = (await res.json()) as { job: { id: string } };
    setJobId(body.job.id);
    for (let i = 0; i < 20; i += 1) {
      await new Promise((r) => setTimeout(r, 300));
      const poll = await fetch(`/api/v1/jobs/${body.job.id}`, { credentials: 'include' });
      const jobBody = (await poll.json()) as {
        job: { status: string; result?: { planDraftId?: string | null; answer?: unknown } };
      };
      if (jobBody.job.status === 'succeeded' || jobBody.job.status === 'failed') {
        setResult(jobBody.job);
        const draftId = jobBody.job.result?.planDraftId;
        if (draftId) await loadPlanDraft(draftId);
        return;
      }
    }
    setError('等待超时，请稍后查询任务');
  }

  async function onApplyPlan() {
    if (!planDraft?.city || planDraft.status !== 'pending_review') return;
    setApplyMsg(null);
    const res = await fetch(`/api/v1/plan-drafts/${planDraft.id}/apply`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedVersion: planDraft.city.version }),
    });
    const body = (await res.json()) as { city?: { version: number }; error?: { message: string } };
    if (!res.ok) {
      setApplyMsg(body.error?.message ?? '应用失败');
      return;
    }
    setApplyMsg(`已写入存档，新版本 ${body.city!.version}`);
    await loadPlanDraft(planDraft.id);
  }

  const answer = (result as { result?: { answer?: {
        citations?: Array<{
          snapshotId: string;
          entityName: string;
          sourceUrl: string | null;
          snippet: string;
        }>;
        facts?: string[];
        missing?: string[];
        calculations?: unknown[];
        suggestions?: string[];
        assumptions?: string[];
      } } } | null)?.result?.answer;

  return (
    <section className="panel">
      <h1>AI 助手</h1>
      <p className="muted">检索与确定性计算在后端受控工具中执行；计划草稿需您确认后才会写入城市存档。</p>
      <form className="stack" onSubmit={onSubmit}>
        <label>城市存档<select value={cityId} onChange={(e) => setCityId(e.target.value)}><option value="">仅查资料；生产规划须选城市</option>{cities.data?.map((city) => <option key={city.id} value={city.id}>{city.displayName}（{city.cityKey}）</option>)}</select></label>
        <p className="muted">规划类问题请写明目标总库存与上线次数，例如：应天府农田普通档粮食到30，每天上线4次。</p>
        <label>
          问题
          <input value={question} onChange={(e) => setQuestion(e.target.value)} />
        </label>
        <button type="submit">提问</button>
      </form>
      {jobId && <p className="meta">任务 {jobId}</p>}
      {error && <p className="muted">{error}</p>}
      {answer && (
        <>
          <h2>事实</h2>
          <ul>
            {(answer.facts ?? []).map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <h2>生产计算</h2>
          {(answer.calculations ?? []).map((calculation, i) => <pre className="recipe" key={i}>{JSON.stringify(calculation, null, 2)}</pre>)}
          <h2>建议</h2><ul>{(answer.suggestions ?? []).map((s) => <li key={s}>{s}</li>)}</ul>
          <h2>假设</h2><ul>{(answer.assumptions ?? []).map((s) => <li key={s}>{s}</li>)}</ul>
          <h2>来源</h2>
          <AnswerSources citations={answer.citations ?? []} />
          {(answer.missing ?? []).length > 0 && (
            <p className="muted">缺失：{answer.missing!.join('；')}</p>
          )}
        </>
      )}
      {planDraft && (
        <div className="stack">
          <h2>计划草稿（未确认前不会改存档）</h2>
          <p className="meta">状态：{planDraft.status} · 城市 {planDraft.city?.displayName ?? '未知'} v{planDraft.city?.version ?? '?'}</p>
          {planDraft.payload.planContext?.recipeLabel && (
            <p>配方：{planDraft.payload.planContext.recipeLabel} · 目标 {JSON.stringify(planDraft.payload.planContext.targetInventory)}</p>
          )}
          <p>缺口差异：{JSON.stringify(planDraft.payload.inventoryDiff)}</p>
          {planDraft.payload.production && (
            <p>轮数：{String(planDraft.payload.production.rounds)} · 计算状态：{planDraft.payload.production.status}</p>
          )}
          {planDraft.payload.blockers.length > 0 && (
            <p className="muted">阻塞：{planDraft.payload.blockers.join('；')}</p>
          )}
          {planDraft.status === 'pending_review' && planDraft.city && (
            <button type="button" onClick={onApplyPlan}>确认应用到存档</button>
          )}
          {applyMsg && <p className="muted">{applyMsg}</p>}
        </div>
      )}
    </section>
  );
}
