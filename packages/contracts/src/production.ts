import { Type, type Static } from '@sinclair/typebox';

export const RecipeRef = Type.Object({
  buildingName: Type.String(),
  city: Type.String(),
  tier: Type.String(),
  /** Synthetic fixtures must set true; real rules require source. */
  synthetic: Type.Optional(Type.Boolean()),
  sourceNote: Type.Optional(Type.String()),
  durationSeconds: Type.Union([Type.Integer({ minimum: 1 }), Type.Literal('unknown')]),
  workers: Type.Union([Type.Integer({ minimum: 0 }), Type.Literal('unknown')]),
  inputs: Type.Array(
    Type.Object({
      resource: Type.String(),
      amount: Type.Union([Type.Number({ exclusiveMinimum: 0 }), Type.Literal('unknown')]),
    }),
  ),
  outputs: Type.Array(
    Type.Object({
      resource: Type.String(),
      amount: Type.Union([Type.Number({ exclusiveMinimum: 0 }), Type.Literal('unknown')]),
    }),
  ),
});

export const RuleSet = Type.Object({
  recipes: Type.Array(RecipeRef),
  bonusOrder: Type.Array(Type.String()),
  harvestIntervalSeconds: Type.Integer({ minimum: 1 }),
});

export const ProductionInput = Type.Object({
  inventory: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
  targetInventory: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
  selectedRecipeKey: Type.String(),
  availableWorkers: Type.Integer({ minimum: 0 }),
  buildingCount: Type.Integer({ minimum: 1 }),
  onlineFrequencyPerDay: Type.Number({ exclusiveMinimum: 0 }),
});

export const ProductionResult = Type.Object({
  status: Type.Union([
    Type.Literal('ok'),
    Type.Literal('need_more_data'),
    Type.Literal('rejected'),
  ]),
  gaps: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
  rounds: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  theoreticalSeconds: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  calendarSecondsEstimate: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  assumptions: Type.Array(Type.String()),
  missingConditions: Type.Array(Type.String()),
  blockers: Type.Array(Type.String()),
});

export type RecipeRef = Static<typeof RecipeRef>;
export type RuleSet = Static<typeof RuleSet>;
export type ProductionInput = Static<typeof ProductionInput>;
export type ProductionResult = Static<typeof ProductionResult>;
