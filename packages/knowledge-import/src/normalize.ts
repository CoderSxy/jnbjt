import type { ParsedBuildingDraft, ProductionRecipeDraft } from '@jnbjt/contracts';

/** Ensure drafts never coerce unknown/null quantities to 0. */
export function normalizeBuildingDraft(draft: ParsedBuildingDraft): ParsedBuildingDraft {
  return {
    ...draft,
    name: draft.name.trim(),
    variants: draft.variants.map((v) => ({
      city: v.city,
      recipes: v.recipes.map(normalizeRecipe),
    })),
  };
}

function normalizeRecipe(recipe: ProductionRecipeDraft): ProductionRecipeDraft {
  return {
    ...recipe,
    durationSeconds: recipe.durationSeconds === 0 ? 0 : recipe.durationSeconds,
    workers: recipe.workers === 0 ? 0 : recipe.workers,
    inputs: recipe.inputs.map((item) => ({
      ...item,
      quantity: { ...item.quantity },
    })),
    outputs: recipe.outputs.map((item) => ({
      ...item,
      quantity: { ...item.quantity },
    })),
  };
}

export function assertNoZeroFilledUnknowns(draft: ParsedBuildingDraft): void {
  for (const variant of draft.variants) {
    for (const recipe of variant.recipes) {
      for (const item of [...recipe.inputs, ...recipe.outputs]) {
        if (item.quantity.kind === 'unknown' && item.quantity.value === 0) {
          throw new Error(`unknown quantity coerced to 0 for ${draft.name}`);
        }
      }
    }
  }
}
