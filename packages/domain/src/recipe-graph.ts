import type { RecipeRef } from '@jnbjt/contracts';

export function detectRecipeCycle(recipes: RecipeRef[]): string[] | null {
  const produces = new Map<string, Set<string>>();
  for (const recipe of recipes) {
    for (const out of recipe.outputs) {
      if (typeof out.amount !== 'number') continue;
      const set = produces.get(out.resource) ?? new Set<string>();
      for (const input of recipe.inputs) {
        if (typeof input.amount === 'number') set.add(input.resource);
      }
      produces.set(out.resource, set);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  function dfs(node: string): string[] | null {
    if (visiting.has(node)) {
      const idx = stack.indexOf(node);
      return stack.slice(idx).concat(node);
    }
    if (visited.has(node)) return null;
    visiting.add(node);
    stack.push(node);
    for (const next of produces.get(node) ?? []) {
      const cycle = dfs(next);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
    return null;
  }

  for (const key of produces.keys()) {
    const cycle = dfs(key);
    if (cycle) return cycle;
  }
  return null;
}
