import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  const [params, setParams] = useSearchParams();
  const cityId = params.get('cityId') ?? '';
  const [cities, setCities] = useState<Array<{ id: string; displayName: string }>>([]);
  const [loadedCityId, setLoadedCityId] = useState<string | null>(null);
  const [expectedVersion, setExpectedVersion] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const [history, setHistory] = useState(() => createHistory(initialLayout));
  const layout = history.present;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const selected = layout.buildings.find((b) => b.id === selectedId) ?? null;
  const isNarrow = useMemo(() => window.matchMedia('(max-width: 640px)').matches, []);
  const ready = Boolean(cityId && loadedCityId === cityId);
  const canEdit = ready && !saving;

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/v1/cities', { credentials: 'include', signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error('请先登录并创建城市存档');
        const body = await res.json();
        setCities(body.cities);
      })
      .catch((error) => { if (!controller.signal.aborted) setMessage(error.message); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoadedCityId(null);
    setSelectedId(null);
    setHistory(createHistory(structuredClone(initialLayout)));
    setMessage(null);
    if (!cityId) return;
    fetch(`/api/v1/cities/${cityId}/layout`, { credentials: 'include', signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error('无法读取城市布局，请检查登录和城市权限');
        const body = await res.json() as { layout: { version: number; layout: Layout } | null };
        if (!active) return;
        setHistory(createHistory(body.layout?.layout ?? structuredClone(initialLayout)));
        setExpectedVersion(body.layout?.version ?? null);
        setLoadedCityId(cityId);
      })
      .catch((error) => { if (active) setMessage(error.message); });
    return () => { active = false; controller.abort(); };
  }, [cityId, reload]);


  function update(next: Layout) {
    if (canEdit) setHistory((h) => pushHistory(h, next));
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
    if (!canEdit) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/cities/${cityId}/layout`, {
        method: 'PUT', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedVersion, layout }),
      });
      if (res.status === 409) {
        setMessage('版本冲突（409）：另一页面已保存；请先导出当前修改，再重新读取布局');
        return;
      }
      if (!res.ok) throw new Error(`保存失败 ${res.status}`);
      const body = await res.json() as { layout: { version: number } };
      setExpectedVersion(body.layout.version);
      setMessage('已保存');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败');
    } finally { setSaving(false); }
  }

  const cityPicker = (
    <label>
      城市存档
      <select aria-label="城市存档" value={cityId} disabled={saving}
        onChange={(event) => setParams(event.target.value ? { cityId: event.target.value } : {})}>
        <option value="">请选择城市</option>
        {cities.map((city) => <option key={city.id} value={city.id}>{city.displayName}</option>)}
      </select>
    </label>
  );

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
        {cityPicker}
        {message && <p role="status">{message}</p>}
        <p data-testid="building-count">建筑数：{ready ? layout.buildings.length : 0}</p>
        <p className="muted">手机端先提供浏览与检查；复杂编辑请用桌面。</p>
        <pre className="recipe">{JSON.stringify(layout.buildings, null, 2)}</pre>
      </section>
    );
  }

  return (
    <section className="panel editor">
      <h1>地图编辑</h1>
      {cityPicker}
      <p data-testid="building-count">建筑数：{ready ? layout.buildings.length : 0}</p>
      <p className="muted">整数网格；自定义底图已标记。显示坐标仅用于绘制。</p>
      <div className="editor-toolbar">
        <button type="button" disabled={!canEdit || !history.past.length} onClick={() => setHistory((h) => undo(h))}>
          撤销
        </button>
        <button type="button" disabled={!canEdit || !history.future.length} onClick={() => setHistory((h) => redo(h))}>
          重做
        </button>
        <button type="button" disabled={!canEdit} onClick={() => void save()}>
          保存
        </button>
        <button type="button" disabled={!ready} onClick={exportJson}>
          导出 JSON
        </button>
        <button type="button" disabled={!cityId || saving} onClick={() => setReload((n) => n + 1)}>重新读取布局</button>
      </div>
      {message && <p className="muted" role="status">{message}</p>}
      <fieldset className="editor-grid" disabled={!canEdit}>
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
                  draggable={canEdit && !b.locked}
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
      </fieldset>
    </section>
  );
}
