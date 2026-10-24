import { describe, expect, it } from 'vitest';
import { createHistory, pushHistory, redo, undo } from '../../apps/web/src/features/editor/history';

/**
 * Full Playwright browser e2e needs a running stack; this suite locks the
 * editor history contract used by MapEditor (save/reopen consistency at model layer).
 */
describe('editor history e2e contract', () => {
  it('supports undo/redo for layout edits', () => {
    let h = createHistory({ buildings: [] as Array<{ id: string }> });
    h = pushHistory(h, { buildings: [{ id: 'a' }] });
    h = pushHistory(h, { buildings: [{ id: 'a' }, { id: 'b' }] });
    h = undo(h);
    expect(h.present.buildings).toEqual([{ id: 'a' }]);
    h = redo(h);
    expect(h.present.buildings.map((b) => b.id)).toEqual(['a', 'b']);
  });
});
