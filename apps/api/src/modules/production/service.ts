import type { Pool } from 'pg';
import type { CitySnapshot, RecipeRef, ProductionResult, ResourceAmount } from '@jnbjt/contracts';
import { calculateProduction } from '@jnbjt/domain';
import { getCity } from '../cities/repository.js';
import { isRecipeRefExactCalculationReady } from '../knowledge/recipe-review.js';

const cityNames: Record<string, string> = { yingtian: '应天府', suzhou: '苏州', hangzhou: '杭州', songjiang: '松江', yangzhou: '扬州', jiaxing: '嘉兴', huzhou: '湖州', zhenjiang: '镇江' };
export function cityVariant(city: CitySnapshot): string { return cityNames[city.cityKey] ?? city.cityKey; }
export type RecipeOption = RecipeRef & { id: string; name: string; snapshotId: string; sourceUrl: string };
export function missingProduction(message: string): ProductionResult {
  return {status: 'need_more_data', gaps: {}, rounds: null, theoreticalSeconds: null, calendarSecondsEstimate: null, assumptions: [], missingConditions: [message], blockers: []};
}
function amounts(items: ResourceAmount[]): RecipeRef['outputs'] {
  return items.map((item) => {
    const q = item.quantity;
    let amount: number | 'unknown' = 'unknown';
    if (q?.kind === 'number' && typeof q.value === 'number' && Number.isFinite(q.value) && q.value > 0) amount = q.value;
    return {resource: item.resourceName, amount};
  });
}
export async function eligibleRecipes(pool: Pool, city: CitySnapshot): Promise<RecipeOption[]> {
  const result = await pool.query(`SELECT r.*, b.name AS building_name, v.city, s.id AS source_snapshot, p.canonical_url
    FROM production_recipes r JOIN building_variants v ON v.id = r.variant_id
    JOIN building_types b ON b.id = v.building_type_id
    JOIN knowledge_versions k ON k.id = b.knowledge_version_id AND k.is_active
    JOIN knowledge_imports i ON i.id = k.import_id AND i.status = 'published'
    JOIN source_snapshots s ON s.id = r.snapshot_id JOIN source_pages p ON p.id = s.source_page_id
    WHERE v.city = $1 AND r.confirmation IN ('reviewed', 'published') ORDER BY b.name, r.tier, r.id`, [cityVariant(city)]);
  return result.rows
    .map((r) => ({
      id: r.id,
      name: `${r.building_name} · ${r.city} · ${r.tier ?? '未知档位'}`,
      buildingName: r.building_name,
      city: r.city,
      tier: r.tier ?? 'unknown',
      sourceNote: `snapshot:${r.source_snapshot} ${r.canonical_url}`,
      snapshotId: r.source_snapshot,
      sourceUrl: r.canonical_url,
      durationSeconds: r.duration_unknown || !(r.duration_seconds > 0) ? 'unknown' : r.duration_seconds,
      workers: r.workers_unknown || r.workers === null ? 'unknown' : r.workers,
      inputs: amounts(r.inputs),
      outputs: amounts(r.outputs),
    }))
    .filter((recipe) => isRecipeRefExactCalculationReady(recipe));
}
export async function calculateSavedProduction(pool: Pool, userId: string, request: {cityId: string; recipeId: string; targetInventory: Record<string, number>; onlineFrequencyPerDay: number}): Promise<ProductionResult | null> {
  const city = await getCity(pool, userId, request.cityId);
  if (!city) return null;
  const recipe = (await eligibleRecipes(pool, city)).find((r) => r.id === request.recipeId);
  if (!recipe) return missingProduction('该城市没有此已审核、有来源的有效配方；请补充已发布并审核的资料。');
  const buildingCount = city.state.buildings.filter((b) => b.typeName === recipe.buildingName).reduce((n, b) => n + b.count, 0);
  const result = calculateProduction({inventory: city.state.inventory, targetInventory: request.targetInventory, selectedRecipeKey: `${recipe.buildingName}|${recipe.city}|${recipe.tier}`, availableWorkers: city.state.workersAvailable, buildingCount, onlineFrequencyPerDay: request.onlineFrequencyPerDay}, {recipes: [recipe], bonusOrder: [], harvestIntervalSeconds: 1});
  result.assumptions.push(`来源 ${recipe.sourceNote}`, `城市 ${cityVariant(city)} v${city.version}；每次上线立即收获并重新生产；未应用未核实加成`);
  return result;
}
