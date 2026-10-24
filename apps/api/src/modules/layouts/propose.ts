import type { LayoutRuleSet } from '@jnbjt/contracts';
import { proposeLayout, type LayoutSearchInput } from '@jnbjt/domain';

export function proposeLayoutJob(input: LayoutSearchInput, rules: LayoutRuleSet) {
  return proposeLayout(input, rules);
}
