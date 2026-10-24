import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';

export function UploadPage() {
  const [notice, setNotice] = useState(
    '仅 JPEG/PNG/WebP，≤10MiB。启用识别时图片会发往配置的模型服务。HEIC 请先转换。',
  );
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = (event.currentTarget.elements.namedItem('file') as HTMLInputElement).files?.[0];
    if (!file) return;
    const buf = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    buf.forEach((b) => {
      binary += String.fromCharCode(b);
    });
    const dataBase64 = btoa(binary);
    const res = await fetch('/api/v1/uploads', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: file.name, mime: file.type, dataBase64 }),
    });
    const body = await res.json();
    if (!res.ok) {
      setNotice(body?.error?.message ?? '上传失败');
      return;
    }
    setNotice(body.notice ?? '已上传');
    setUploadId(body.upload.id);

    const cities = await fetch('/api/v1/cities', { credentials: 'include' });
    const cityId = cities.ok
      ? ((await cities.json()) as { cities: Array<{ id: string }> }).cities[0]?.id
      : undefined;
    const job = await fetch('/api/v1/recognition-jobs', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ uploadId: body.upload.id, cityId, key: `rec-${Date.now()}` }),
    });
    if (job.ok) {
      const draft = (await job.json()) as { draft: { id: string } };
      setDraftId(draft.draft.id);
    }
  }

  return (
    <section className="panel">
      <h1>截图导入</h1>
      <p className="muted">{notice}</p>
      <form className="stack" onSubmit={onSubmit}>
        <input name="file" type="file" accept="image/png,image/jpeg,image/webp" />
        <button type="submit">上传并识别草稿</button>
      </form>
      {uploadId && <p className="meta">upload {uploadId}</p>}
      {draftId && (
        <p className="meta">
          <Link to={`/imports/review/${draftId}`}>去校正草稿 {draftId}</Link>
        </p>
      )}
    </section>
  );
}
