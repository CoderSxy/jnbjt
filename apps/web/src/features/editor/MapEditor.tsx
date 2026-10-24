import { useMemo, useState } from 'react';
import { Stage, Layer, Rect, Text } from 'react-konva';
import { BuildingPalette } from './BuildingPalette';
import { LayoutInspector } from './LayoutInspector';
import { createHistory, pushHistory, redo, undo } from './history';

type Building = {
  id: string;
  typeName: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: 0 | 90 | 180 | 270;
  locked: boolean;
};

type Layout = {
  schemaVersion: number;
  knowledgeVersion: null;
  width: number;
  height: number;
  buildable: Array<{ x: number; y: number; w: number; h: number }>;
  blocked: Array<{ x: number; y: number; w: number; h: number }>;
  roads: Array<{ x: number; y: number; w: number; h: number }>;
  buildings: Building[];
  customBasemap: boolean;
  notes?: string;
};

const CELL = 28;

const initialLayout: Layout = {
  schemaVersion: 1,
  knowledgeVersion: null,
  width: 12,
  height: 10,
  buildable: [{ x: 0, y: 0, w: 12, h: 10 }],
  blocked: [],
  roads: [{ x: 0, y: 5, w: 12, h: 1 }],
  buildings: [],
  customBasemap: true,
  notes: '自定义练习地图',
};

function footprint(b: Building) {
  const size =
    b.rotation === 90 || b.rotation === 270 ? { w: b.h, h: b.w } : { w: b.w, h: b.h };
  return { ...size, x: b.x, y: b.y };
}

export function MapEditor() {
  const [history, setHistory] = useState(() => createHistory(initialLayout));
  const layout = history.present;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const selected = layout.buildings.find((b) => b.id === selectedId) ?? null;
  const isNarrow = useMemo(() => window.matchMedia('(max-width: 640px)').matches, []);

  function update(next: Layout) {
    setHistory((h) => pushHistory(h, next));
  }

  function addBuilding(typeName: string, w: number, h: number) {
    const id = `${typeName}_${Date.now()}`;
    update({
      ...layout,
      buildings: [
        ...layout.buildings,
        { id, typeName, x: 1, y: 1, w, h, rotation: 0, locked: false },
      ],
    });
    setSelectedId(id);
  }

  async function save() {
    setMessage(null);
    const cities = await fetch('/api/v1/cities', { credentials: 'include' });
    if (!cities.ok) {
      setMessage('请先登录并创建城市存档');
      return;
    }
    const list = (await cities.json()) as { cities: Array<{ id: string }> };
    const cityId = list.cities[0]?.id;
    if (!cityId) {
      setMessage('没有城市存档');
      return;
    }
    const current = await fetch(`/api/v1/cities/${cityId}/layout`, { credentials: 'include' });
    const currentBody = (await current.json()) as { layout: { version: number } | null };
    const res = await fetch(`/api/v1/cities/${cityId}/layout`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expectedVersion: currentBody.layout?.version ?? null,
        layout,
      }),
    });
    setMessage(res.ok ? '已保存' : `保存失败 ${res.status}`);
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(layout, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'layout.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  if (isNarrow) {
    return (
      <section className="panel">
        <h1>地图</h1>
        <p className="muted">手机端先提供浏览与检查；复杂编辑请用桌面。</p>
        <pre className="recipe">{JSON.stringify(layout.buildings, null, 2)}</pre>
      </section>
    );
  }

  return (
    <section className="panel editor">
      <h1>地图编辑</h1>
      <p className="muted">整数网格；自定义底图已标记。显示坐标仅用于绘制。</p>
      <div className="editor-toolbar">
        <button type="button" onClick={() => setHistory((h) => undo(h))}>
          撤销
        </button>
        <button type="button" onClick={() => setHistory((h) => redo(h))}>
          重做
        </button>
        <button type="button" onClick={() => void save()}>
          保存
        </button>
        <button type="button" onClick={exportJson}>
          导出 JSON
        </button>
      </div>
      {message && <p className="muted">{message}</p>}
      <div className="editor-grid">
        <BuildingPalette
          items={[
            { typeName: '农田', w: 2, h: 1 },
            { typeName: '餐馆', w: 2, h: 2 },
            { typeName: '雕像', w: 1, h: 1 },
          ]}
          onAdd={addBuilding}
        />
        <Stage width={layout.width * CELL} height={layout.height * CELL} className="stage">
          <Layer>
            <Rect width={layout.width * CELL} height={layout.height * CELL} fill="#e8e0d0" />
            {layout.roads.map((r, i) => (
              <Rect
                key={`road-${i}`}
                x={r.x * CELL}
                y={r.y * CELL}
                width={r.w * CELL}
                height={r.h * CELL}
                fill="#c4b59a"
              />
            ))}
            {layout.buildings.map((b) => {
              const f = footprint(b);
              return (
                <Rect
                  key={b.id}
                  x={f.x * CELL}
                  y={f.y * CELL}
                  width={f.w * CELL}
                  height={f.h * CELL}
                  fill={selectedId === b.id ? '#2f5d50' : '#6b8f71'}
                  stroke="#1c1915"
                  draggable={!b.locked}
                  onClick={() => setSelectedId(b.id)}
                  onDragEnd={(e) => {
                    const x = Math.round(e.target.x() / CELL);
                    const y = Math.round(e.target.y() / CELL);
                    e.target.position({ x: x * CELL, y: y * CELL });
                    update({
                      ...layout,
                      buildings: layout.buildings.map((item) =>
                        item.id === b.id ? { ...item, x, y } : item,
                      ),
                    });
                  }}
                />
              );
            })}
            <Text text="自定义练习地图" x={8} y={8} fontSize={12} fill="#5a5246" />
          </Layer>
        </Stage>
        <LayoutInspector
          selected={selected}
          customBasemap={layout.customBasemap}
          onRotate={() => {
            if (!selected || selected.locked) return;
            const nextRot = ((selected.rotation + 90) % 360) as 0 | 90 | 180 | 270;
            update({
              ...layout,
              buildings: layout.buildings.map((b) =>
                b.id === selected.id ? { ...b, rotation: nextRot } : b,
              ),
            });
          }}
          onToggleLock={() => {
            if (!selected) return;
            update({
              ...layout,
              buildings: layout.buildings.map((b) =>
                b.id === selected.id ? { ...b, locked: !b.locked } : b,
              ),
            });
          }}
        />
      </div>
    </section>
  );
}
