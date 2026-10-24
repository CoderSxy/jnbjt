import { FormEvent, useState } from 'react';
import { useParams } from 'react-router-dom';

export function RecognitionReview() {
  const { id } = useParams();
  const [grain, setGrain] = useState('');
  const [cityId, setCityId] = useState('');
  const [version, setVersion] = useState('1');
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!id) return;
    const res = await fetch(`/api/v1/recognition-drafts/${id}/apply`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expectedVersion: Number(version),
        corrections: {
          fields: [
            {
              path: 'inventory.粮食',
              value: grain === '' ? null : Number(grain),
              raw: grain || null,
              status: grain === '' ? 'unknown' : 'known',
            },
          ],
        },
      }),
    });
    setMessage(res.ok ? '已应用' : `失败 ${res.status}`);
    void cityId;
  }

  return (
    <section className="panel">
      <h1>识别校正</h1>
      <p className="muted">确认前不会改存档。未知请留空。</p>
      <form className="stack" onSubmit={onSubmit}>
        <label>
          城市 ID
          <input value={cityId} onChange={(e) => setCityId(e.target.value)} />
        </label>
        <label>
          存档 version
          <input value={version} onChange={(e) => setVersion(e.target.value)} />
        </label>
        <label>
          粮食（可空=未知）
          <input value={grain} onChange={(e) => setGrain(e.target.value)} />
        </label>
        <button type="submit">确认应用</button>
      </form>
      {message && <p className="muted">{message}</p>}
    </section>
  );
}
