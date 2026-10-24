type Citation = {
  snapshotId: string;
  entityName: string;
  sourceUrl: string | null;
  snippet: string;
};

export function AnswerSources({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return <p className="muted">无可用引用</p>;
  return (
    <ul className="hit-list">
      {citations.map((c) => (
        <li key={c.snapshotId}>
          <strong>{c.entityName}</strong>
          <div className="meta">snapshot {c.snapshotId}</div>
          <div className="muted">{c.snippet}</div>
          {c.sourceUrl && (
            <a href={c.sourceUrl} target="_blank" rel="noreferrer">
              来源
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
