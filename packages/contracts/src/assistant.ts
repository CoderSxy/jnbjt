import { Type, type Static } from '@sinclair/typebox';
import { ProductionResult } from './production.js';

export const AssistantInput = Type.Object({
  question: Type.String({ minLength: 1 }),
  cityId: Type.Optional(Type.String()),
});

export const AssistantCitation = Type.Object({
  snapshotId: Type.String(),
  entityName: Type.String(),
  sourceUrl: Type.Union([Type.String(), Type.Null()]),
  snippet: Type.String(),
});

export const AssistantPlanContext = Type.Object({
  recipeId: Type.Optional(Type.String()),
  recipeLabel: Type.Optional(Type.String()),
  targetInventory: Type.Optional(Type.Record(Type.String(), Type.Integer({ minimum: 0 }))),
  onlineFrequencyPerDay: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
});

export const AssistantAnswer = Type.Object({
  facts: Type.Array(Type.String()),
  calculations: Type.Array(Type.Unknown()),
  suggestions: Type.Array(Type.String()),
  citations: Type.Array(AssistantCitation),
  assumptions: Type.Array(Type.String()),
  missing: Type.Array(Type.String()),
  unsupported: Type.Array(Type.String()),
  planContext: Type.Optional(AssistantPlanContext),
});

export const PlanDraftStatus = Type.Union([
  Type.Literal('pending_review'),
  Type.Literal('applied'),
  Type.Literal('rejected'),
]);

export const PlanDraftPayload = Type.Object({
  question: Type.String(),
  cityId: Type.String(),
  cityVersionAtCreate: Type.Integer({ minimum: 1 }),
  facts: Type.Array(Type.String()),
  suggestions: Type.Array(Type.String()),
  citations: Type.Array(AssistantCitation),
  assumptions: Type.Array(Type.String()),
  missing: Type.Array(Type.String()),
  blockers: Type.Array(Type.String()),
  inventoryDiff: Type.Record(Type.String(), Type.Integer()),
  planContext: Type.Optional(AssistantPlanContext),
  production: Type.Optional(ProductionResult),
});

export const PlanDraft = Type.Object({
  id: Type.String(),
  status: PlanDraftStatus,
  question: Type.String(),
  cityId: Type.String(),
  cityVersionAtCreate: Type.Integer(),
  payload: PlanDraftPayload,
  jobId: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  appliedAt: Type.Union([Type.String(), Type.Null()]),
});

export type AssistantInput = Static<typeof AssistantInput>;
export type AssistantCitation = Static<typeof AssistantCitation>;
export type AssistantPlanContext = Static<typeof AssistantPlanContext>;
export type AssistantAnswer = Static<typeof AssistantAnswer>;
export type PlanDraftStatus = Static<typeof PlanDraftStatus>;
export type PlanDraftPayload = Static<typeof PlanDraftPayload>;
export type PlanDraft = Static<typeof PlanDraft>;
