import { FormEvent, useState } from 'react';
import { AnswerSources } from './AnswerSources';

export function AssistantPage() {
  const [question, setQuestion] = useState('应天府农田普通档产出是多少？');
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setResult(null);
    const res = await fetch('/api/v1/assistant/runs', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question, key: `ask-${Date.now()}` }),
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
      const jobBody = (await poll.json()) as { job: { status: string; result?: unknown } };
      if (jobBody.job.status === 'succeeded' || jobBody.job.status === 'failed') {
        setResult(jobBody.job);
        return;
      }
    }
    setError('等待超时，请稍后查询任务');
  }

  const answer = (result as { result?: { citations?: unknown[] } } | null)?.result as
    | {
        citations?: Array<{
          snapshotId: string;
          entityName: string;
          sourceUrl: string | null;
          snippet: string;
        }>;
        facts?: string[];
        missing?: string[];
      }
    | undefined;

  return (
    <section className="panel">
      <h1>AI 助手</h1>
      <p className="muted">引用必须来自检索；计算来自确定性结果；模型离线时仍可查资料。</p>
      <form className="stack" onSubmit={onSubmit}>
        <label>
          问题
          <input value={question} onChange={(e) => setQuestion(e.target.value)} />
        </label>
        <button type="submit">提问</button>
      </form>
      {jobId && <p className="meta">job {jobId}</p>}
      {error && <p className="muted">{error}</p>}
      {answer && (
        <>
          <h2>事实</h2>
          <ul>
            {(answer.facts ?? []).map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <h2>来源</h2>
          <AnswerSources citations={answer.citations ?? []} />
          {(answer.missing ?? []).length > 0 && (
            <p className="muted">缺失：{answer.missing!.join('；')}</p>
          )}
        </>
      )}
    </section>
  );
}
