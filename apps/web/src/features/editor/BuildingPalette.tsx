type Props = {
  items: Array<{ typeName: string; w: number; h: number }>;
  onAdd: (typeName: string, w: number, h: number) => void;
};

export function BuildingPalette({ items, onAdd }: Props) {
  return (
    <div className="palette">
      <h3>建筑</h3>
      {items.map((item) => (
        <button
          key={item.typeName}
          type="button"
          onClick={() => onAdd(item.typeName, item.w, item.h)}
        >
          {item.typeName} ({item.w}×{item.h})
        </button>
      ))}
    </div>
  );
}
