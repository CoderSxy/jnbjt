import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Job } from '@jnbjt/contracts';

export function UploadPage() {
  const [notice, setNotice] = useState('仅 JPEG/PNG/WebP，≤10MiB、≤2000万像素。启用识别时图片会发往配置的模型服务。HEIC 请先转换。');
  const [draftId, setDraftId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cities, setCities] = useState<Array<{ id: string; displayName: string }>>([]);
  const [cityId, setCityId] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/v1/cities', { credentials: 'include', signal: controller.signal }).then(async (res) => {
      if (!res.ok) return;
      const body = await res.json();
      setCities(body.cities);
      setCityId(body.cities[0]?.id ?? '');
    }).catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!jobId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const res = await fetch(`/api/v1/jobs/${jobId}`, { credentials: 'include', signal: controller.signal });
        if (!res.ok) throw new Error('任务读取失败');
        const { job } = await res.json() as { job: Job };
        if (job.status === 'succeeded') {
          const data = job.result as { draft?: { id: string } } | undefined;
          if (!data?.draft) throw new Error('任务没有返回草稿');
          setDraftId(data.draft.id); setNotice('草稿已就绪，请核对原文和识别数值。'); setBusy(false); return;
        }
        if (['failed', 'cancelled'].includes(job.status)) {
          setNotice(job.status === 'cancelled' ? '识别已取消' : '识别失败，请稍后重试或检查视觉模型配置。'); setBusy(false); return;
        }
        setNotice('正在排队或识别，请稍候…');
        timer = setTimeout(() => void poll(), 750);
      } catch (error) {
        if (!controller.signal.aborted) { setNotice(error instanceof Error ? error.message : '任务失败'); setBusy(false); }
      }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [jobId]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = (event.currentTarget.elements.namedItem('file') as HTMLInputElement).files?.[0];
    if (!file || busy) return;
    if (file.size > 10 * 1024 * 1024) { setNotice('图片不能超过10MiB'); return; }
    setBusy(true); setDraftId(null); setJobId(null);
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = () => reject(new Error('图片读取失败'));
        reader.readAsDataURL(file);
      });
      const res = await fetch('/api/v1/uploads', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ filename: file.name, mime: file.type, dataBase64 }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? '上传失败');
      const response = await fetch('/api/v1/recognition-jobs', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uploadId: body.upload.id, ...(cityId ? { cityId } : {}), key: crypto.randomUUID() }) });
      const queued = await response.json();
      if (!response.ok) throw new Error(queued?.error?.message ?? '识别任务提交失败');
      setJobId(queued.job.id);
    } catch (error) { setNotice(error instanceof Error ? error.message : '上传失败'); setBusy(false); }
  }

  return (
    <section className="panel">
      <h1>截图导入</h1>
      <p className="muted" role="status">{notice}</p>
      <form className="stack" onSubmit={onSubmit}>
        <label>关联城市<select value={cityId} onChange={(e) => setCityId(e.target.value)} disabled={busy}><option value="">仅创建草稿</option>{cities.map((city) => <option key={city.id} value={city.id}>{city.displayName}</option>)}</select></label>
        <input name="file" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} required />
        <button type="submit" disabled={busy}>{busy ? '处理中…' : '上传并识别草稿'}</button>
      </form>
      {draftId && <p className="meta"><Link to={`/imports/review/${draftId}`}>去校正草稿</Link></p>}
    </section>
  );
}
