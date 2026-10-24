import * as cheerio from 'cheerio';
import type {
  ParsedBuildingDraft,
  ProductionRecipeDraft,
  ResourceAmount,
  SourceSnapshot,
} from '@jnbjt/contracts';
import { parseDurationSeconds, parseQuantity, parseWorkers } from './parse-quantity.js';

/** Cheerio DOM node from .toArray() / .get(0); kept loose across cheerio versions. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DomNode = any;

const NAV_SELECTORS = ['.navbox', '[role="navigation"]', '.toc', '#toc'];
const CITY_NAMES = ['应天府', '苏州', '杭州', '扬州', '松江', '嘉兴', '湖州', '镇江'];

function stripNavigation($: cheerio.CheerioAPI): void {
  for (const sel of NAV_SELECTORS) $(sel).remove();
}

function cellText($: cheerio.CheerioAPI, cell: DomNode): string {
  const clone = $(cell).clone();
  clone.find('img').each((_i: number, img: DomNode) => {
    const $img = $(img);
    const label = $img.attr('alt') || $img.attr('title') || '';
    if (label) $img.replaceWith(` ${label} `);
    else $img.remove();
  });
  return clone.text().replace(/\s+/g, ' ').trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resourceFromCell($: cheerio.CheerioAPI, cell: DomNode): ResourceAmount | null {
  const $cell = $(cell);
  const img = $cell.find('img').first();
  const unitName = img.attr('alt') || img.attr('title') || null;
  let text = cellText($, cell);
  if (unitName) {
    text = text.replace(new RegExp(`^${escapeRegExp(unitName)}\\s*`), '').trim();
  }
  if (!text && !unitName) return null;
  return {
    resourceName: unitName ?? 'unknown',
    quantity: parseQuantity(text || 'unknown', unitName ?? 'unknown'),
    evidence: cellText($, cell),
  };
}

type GridCell = { el: DomNode; text: string };

/** Build a rectangular grid honouring rowspan/colspan by repeating cell refs. */
function expandTable($: cheerio.CheerioAPI, table: DomNode): GridCell[][] {
  const trs = $(table).find('tr').toArray();
  const grid: Array<Array<GridCell | undefined>> = [];
  const occupancy: boolean[][] = [];

  const ensure = (r: number, c: number) => {
    while (grid.length <= r) {
      grid.push([]);
      occupancy.push([]);
    }
    while (grid[r]!.length <= c) {
      grid[r]!.push(undefined);
      occupancy[r]!.push(false);
    }
  };

  for (let r = 0; r < trs.length; r += 1) {
    const cells = $(trs[r]!).children('th,td').toArray();
    let c = 0;
    for (const el of cells) {
      ensure(r, c);
      while (occupancy[r]![c]) {
        c += 1;
        ensure(r, c);
      }
      const rowspan = Math.max(1, Number($(el).attr('rowspan') ?? 1) || 1);
      const colspan = Math.max(1, Number($(el).attr('colspan') ?? 1) || 1);
      const cell: GridCell = { el, text: cellText($, el) };
      for (let dr = 0; dr < rowspan; dr += 1) {
        for (let dc = 0; dc < colspan; dc += 1) {
          ensure(r + dr, c + dc);
          grid[r + dr]![c + dc] = cell;
          occupancy[r + dr]![c + dc] = true;
        }
      }
      c += colspan;
    }
  }

  return grid.map((row) => row.filter((x): x is GridCell => x != null));
}

function indexOfHeader(headers: string[], candidates: string[]): number {
  return headers.findIndex((h) => candidates.some((c) => h.includes(c)));
}

function parseProductionTable(
  $: cheerio.CheerioAPI,
  table: DomNode,
  city: string | null | 'unknown',
): ProductionRecipeDraft[] {
  const matrix = expandTable($, table);
  if (matrix.length < 2) return [];
  const headers = matrix[0]!.map((c) => c.text);
  if (headers.some((h) => /导航|目录|首页|建筑一览/.test(h))) return [];
  if (matrix[0]!.some((c) => $(c.el).closest('.navbox,[role="navigation"]').length > 0)) {
    return [];
  }

  const tierIdx = indexOfHeader(headers, ['档位', '模式']);
  const durationIdx = indexOfHeader(headers, ['耗时', '时间']);
  const workersIdx = indexOfHeader(headers, ['工人']);
  const inputIdx = indexOfHeader(headers, ['投入', '消耗']);
  const outputIdx = indexOfHeader(headers, ['产出', '产量']);

  if (durationIdx < 0 && outputIdx < 0 && inputIdx < 0) return [];

  const recipes: ProductionRecipeDraft[] = [];
  for (let r = 1; r < matrix.length; r += 1) {
    const row = matrix[r]!;
    const rawCells: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (row[i]) rawCells[h || `col${i}`] = row[i]!.text;
    });

    const outputs: ResourceAmount[] = [];
    if (outputIdx >= 0) {
      const seen = new Set<DomNode>();
      for (let i = outputIdx; i < row.length; i += 1) {
        const cell = row[i];
        if (!cell || seen.has(cell.el)) continue;
        const header = headers[i] ?? '';
        if (i !== outputIdx && /工人|耗时|投入|档位/.test(header)) break;
        seen.add(cell.el);
        const amt = resourceFromCell($, cell.el);
        if (amt) outputs.push(amt);
      }
    }

    const inputs: ResourceAmount[] = [];
    if (inputIdx >= 0 && row[inputIdx]) {
      const amt = resourceFromCell($, row[inputIdx]!.el);
      if (amt) inputs.push(amt);
    }

    const tier =
      tierIdx >= 0 && row[tierIdx] ? row[tierIdx]!.text || 'unknown' : 'unknown';
    const durationRaw = durationIdx >= 0 && row[durationIdx] ? row[durationIdx]!.text : '';
    const workersRaw = workersIdx >= 0 && row[workersIdx] ? row[workersIdx]!.text : '';

    recipes.push({
      city,
      tier: tier || 'unknown',
      durationSeconds: parseDurationSeconds(durationRaw),
      workers: parseWorkers(workersRaw),
      inputs,
      outputs,
      rawCells,
      confirmation: 'draft',
    });
  }
  return recipes;
}

function sectionCity(text: string): string | 'unknown' {
  return CITY_NAMES.find((c) => text.includes(c)) ?? 'unknown';
}

export function parseBuilding(snapshot: SourceSnapshot): ParsedBuildingDraft {
  const $ = cheerio.load(snapshot.html);
  stripNavigation($);

  const variants: ParsedBuildingDraft['variants'] = [];
  const fieldSources: Record<string, string> = {
    name: snapshot.snapshotId,
  };

  const headings = $('h2').toArray();
  if (headings.length === 0) {
    const recipes: ProductionRecipeDraft[] = [];
    for (const table of $('table').toArray()) {
      recipes.push(...parseProductionTable($, table, 'unknown'));
    }
    variants.push({ city: 'unknown', recipes });
  } else {
    for (const heading of headings) {
      const city = sectionCity($(heading).text());
      const recipes: ProductionRecipeDraft[] = [];
      let el = $(heading).next();
      while (el.length && !el.is('h2')) {
        if (el.is('table')) {
          const node = el.get(0);
          if (node) recipes.push(...parseProductionTable($, node, city));
        } else {
          el.find('table').each((_i: number, table: DomNode) => {
            recipes.push(...parseProductionTable($, table, city));
          });
        }
        el = el.next();
      }
      if (recipes.length > 0) {
        variants.push({ city, recipes });
        fieldSources[`variant.${city}`] = snapshot.snapshotId;
      }
    }
  }

  return {
    name: snapshot.title,
    snapshotId: snapshot.snapshotId,
    sourceUrl: snapshot.sourceUrl,
    revision: snapshot.revision,
    variants,
    aliases: [],
    notes: [],
    fieldSources,
  };
}
