import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { RecognitionDraft } from '@jnbjt/contracts';

type Review = { draft: RecognitionDraft; city: { id: string; displayName: string; version: number; state: { inventory: Record<string, number> } } | null };

export function RecognitionReview() {
  const { id } = useParams();
  const [review, setReview] = useState<Review | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/v1/recognition-drafts/${id}`, { credentials: 'include', signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`草稿读取失败 ${res.status}`);
        const body = await res.json() as Review;
        setReview(body);
        setValues(Object.fromEntries(body.draft.fields.map((f) => [f.path, f.value == null ? '' : String(f.value)])));
      }).catch((error: Error) => { if (!controller.signal.aborted) setMessage(error.message); });
    return () => controller.abort();
  }, [id]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!id || !review?.city || busy) return;
    const fields = review.draft.fields.map((field) => {
      const raw = values[field.path]?.trim() ?? '';
      return { ...field, value: raw === '' ? null : Number(raw), raw: raw || null, status: raw === '' ? 'unknown' : 'known' };
    });
    if (fields.some((f) => f.value !== null && (!Number.isSafeInteger(f.value) || f.value < 0))) {
      setMessage('数量必须是非负整数；未知请留空。'); return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/recognition-drafts/${id}/apply`, {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedVersion: review.city.version, corrections: { fields } }),
      });
      if (res.ok) {
        setReview({ ...review, draft: { ...review.draft, status: 'applied' } });
        setMessage('已应用');
      } else setMessage(res.status === 409 ? '存档已更新，请刷新核对当前数值后再应用。' : `应用失败 ${res.status}`);
    } catch { setMessage('网络错误，请重试。'); } finally { setBusy(false); }
  }

  return (
    <section className="panel">
      <h1>识别校正</h1>
      <p className="muted">确认前不会改存档。未知请留空。</p>
      {review && <>
        <p>{review.city ? `${review.city.displayName} · 当前存档版本 ${review.city.version}` : '此草稿未关联城市，无法应用。'}</p>
        <form className="stack" onSubmit={onSubmit}>
          {review.draft.fields.map((field) => <label key={field.path}>
            {field.path.replace(/^inventory\./, '')}（当前：{review.city?.state.inventory[field.path.slice(10)] ?? '未知'}）
            <input inputMode="numeric" value={values[field.path] ?? ''} onChange={(e) => setValues({ ...values, [field.path]: e.target.value })} />
            <small>原文：{field.raw ?? '未知'} · {field.evidence ?? field.status}</small>
          </label>)}
          {review.draft.fields.length === 0 && <p>没有识别到资源数量，请重新上传清晰的库存截图。</p>}
          <button type="submit" disabled={busy || !review.city || review.draft.status !== 'pending_review' || review.draft.fields.length === 0}>{busy ? '应用中…' : '确认应用'}</button>
        </form>
      </>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
