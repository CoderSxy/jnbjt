import type { ProductionInput, ProductionResult, RecipeRef, RuleSet } from '@jnbjt/contracts';
import { detectRecipeCycle } from './recipe-graph.js';

function recipeKey(recipe: RecipeRef): string {
  return `${recipe.buildingName}|${recipe.city}|${recipe.tier}`;
}

function relatedRecipes(selected: RecipeRef, all: RecipeRef[]): RecipeRef[] {
  const byOutput = new Map<string, RecipeRef[]>();
  for (const recipe of all) {
    for (const out of recipe.outputs) {
      const list = byOutput.get(out.resource) ?? [];
      list.push(recipe);
      byOutput.set(out.resource, list);
    }
  }

  const related = new Set<RecipeRef>([selected]);
  const queue = [...selected.inputs.map((i) => i.resource)];
  const seen = new Set<string>();
  while (queue.length) {
    const resource = queue.pop()!;
    if (seen.has(resource)) continue;
    seen.add(resource);
    for (const recipe of byOutput.get(resource) ?? []) {
      if (related.has(recipe)) continue;
      related.add(recipe);
      for (const input of recipe.inputs) queue.push(input.resource);
    }
  }
  return [...related];
}

export function calculateProduction(input: ProductionInput, rules: RuleSet): ProductionResult {
  const assumptions: string[] = [];
  const missingConditions: string[] = [];
  const blockers: string[] = [];
  const gaps: Record<string, number> = {};

  const recipe = rules.recipes.find((r) => recipeKey(r) === input.selectedRecipeKey);
  if (!recipe) {
    return {
      status: 'need_more_data',
      gaps: {},
      rounds: null,
      theoreticalSeconds: null,
      calendarSecondsEstimate: null,
      assumptions,
      missingConditions: [`recipe not found: ${input.selectedRecipeKey}`],
      blockers: [],
    };
  }

  const cycle = detectRecipeCycle(relatedRecipes(recipe, rules.recipes));
  if (cycle) {
    return {
      status: 'rejected',
      gaps: {},
      rounds: null,
      theoreticalSeconds: null,
      calendarSecondsEstimate: null,
      assumptions,
      missingConditions,
      blockers: [`circular recipe chain: ${cycle.join(' -> ')}`],
    };
  }

  if (!recipe.synthetic && !recipe.sourceNote) {
    missingConditions.push('real recipe missing sourceNote');
  }

  if (recipe.durationSeconds === 'unknown') {
    missingConditions.push('duration unknown');
  }
  if (recipe.workers === 'unknown') {
    missingConditions.push('workers unknown');
  }
  for (const item of [...recipe.inputs, ...recipe.outputs]) {
    if (item.amount === 'unknown') {
      missingConditions.push(`unknown amount for ${item.resource}`);
    }
  }

  if (missingConditions.length > 0) {
    return {
      status: 'need_more_data',
      gaps: {},
      rounds: null,
      theoreticalSeconds: null,
      calendarSecondsEstimate: null,
      assumptions,
      missingConditions,
      blockers,
    };
  }

  const targets = Object.keys(input.targetInventory);
  if (!Object.values(input.targetInventory).every((v) => Number.isSafeInteger(v) && v >= 0)) missingConditions.push('target must be a safe nonnegative integer');
  if (targets.length !== 1 || !recipe.outputs.some((o) => o.resource === targets[0])) {
    missingConditions.push('choose exactly one recipe output target');
  }
  if (!Number.isInteger(input.availableWorkers) || input.availableWorkers < 0) missingConditions.push('available workers unknown');
  if (!Number.isInteger(input.buildingCount) || input.buildingCount < 1) missingConditions.push('building count unknown or no matching buildings');
  if (!Number.isFinite(input.onlineFrequencyPerDay) || input.onlineFrequencyPerDay <= 0) missingConditions.push('online frequency required');
  for (const resource of [...targets, ...recipe.inputs.map((i) => i.resource)]) {
    if (!Number.isFinite(input.inventory[resource])) missingConditions.push(`inventory unknown: ${resource}`);
  }
  if (missingConditions.length) return { status: 'need_more_data', gaps, rounds: null, theoreticalSeconds: null, calendarSecondsEstimate: null, assumptions, missingConditions, blockers };
  const primaryOut = recipe.outputs.find((o) => o.resource === targets[0]);
  if (!primaryOut || typeof primaryOut.amount !== 'number' || primaryOut.amount <= 0) {
    return {
      status: 'rejected',
      gaps: {},
      rounds: null,
      theoreticalSeconds: null,
      calendarSecondsEstimate: null,
      assumptions,
      missingConditions,
      blockers: ['zero or missing primary output'],
    };
  }

  const target = input.targetInventory[primaryOut.resource]!;
  const have = input.inventory[primaryOut.resource]!;
  const need = Math.max(0, target - have);
  gaps[primaryOut.resource] = need;

  if (need === 0) {
    assumptions.push('target already satisfied');
    return {
      status: 'ok',
      gaps,
      rounds: 0,
      theoreticalSeconds: 0,
      calendarSecondsEstimate: 0,
      assumptions,
      missingConditions,
      blockers,
    };
  }

  const perRound = primaryOut.amount * input.buildingCount;
  const rounds = Math.ceil(need / perRound);
  assumptions.push(`ceil(need/perRound)=ceil(${need}/${perRound})`);
  assumptions.push(`bonusOrder=${rules.bonusOrder.join(',') || 'none'}`);

  for (const item of recipe.inputs) {
    if (typeof item.amount !== 'number') continue;
    const required = item.amount * rounds * input.buildingCount;
    const available = input.inventory[item.resource]!;
    const gap = Math.max(0, required - available);
    gaps[item.resource] = gap;
    if (gap > 0) blockers.push(`input shortfall ${item.resource}: ${gap}`);
  }

  if (typeof recipe.workers === 'number' && recipe.workers > 0) {
    const neededWorkers = recipe.workers * input.buildingCount;
    if (input.availableWorkers < neededWorkers) {
      blockers.push(`workers shortfall: need ${neededWorkers}, have ${input.availableWorkers}`);
    }
  }

  const duration = recipe.durationSeconds as number;
  const theoreticalSeconds = rounds * duration;
  const harvest = rules.harvestIntervalSeconds;
  const calendarFromHarvest = rounds * Math.max(duration, harvest);
  const daySeconds = 86400;
  const onlineGap = daySeconds / input.onlineFrequencyPerDay;
  const calendarSecondsEstimate = Math.max(
    calendarFromHarvest,
    rounds * Math.max(duration, onlineGap),
  );
  assumptions.push(`onlineFrequencyPerDay=${input.onlineFrequencyPerDay}`);

  if (blockers.length > 0) {
    return {
      status: 'need_more_data',
      gaps,
      rounds,
      theoreticalSeconds,
      calendarSecondsEstimate,
      assumptions,
      missingConditions,
      blockers,
    };
  }

  return {
    status: 'ok',
    gaps,
    rounds,
    theoreticalSeconds,
    calendarSecondsEstimate,
    assumptions,
    missingConditions,
    blockers,
  };
}
