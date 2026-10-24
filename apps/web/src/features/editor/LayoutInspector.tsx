type Building = {
  id: string;
  typeName: string;
  x: number;
  y: number;
  rotation: number;
  locked: boolean;
};

type Props = {
  selected: Building | null;
  customBasemap: boolean;
  onRotate: () => void;
  onToggleLock: () => void;
};

export function LayoutInspector({ selected, customBasemap, onRotate, onToggleLock }: Props) {
  return (
    <aside className="inspector">
      <h3>检查</h3>
      {customBasemap && <p className="muted">自定义练习底图（非官方精确地图）</p>}
      {!selected && <p className="muted">未选择建筑</p>}
      {selected && (
        <>
          <p>
            {selected.typeName} @ ({selected.x},{selected.y}) rot {selected.rotation}
          </p>
          <button type="button" onClick={onRotate} disabled={selected.locked}>
            旋转 90°
          </button>
          <button type="button" onClick={onToggleLock}>
            {selected.locked ? '解锁' : '锁定'}
          </button>
        </>
      )}
    </aside>
  );
}
