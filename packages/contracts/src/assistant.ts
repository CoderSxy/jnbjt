import { Type, type Static } from '@sinclair/typebox';

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

export const AssistantAnswer = Type.Object({
  facts: Type.Array(Type.String()),
  calculations: Type.Array(Type.Unknown()),
  suggestions: Type.Array(Type.String()),
  citations: Type.Array(AssistantCitation),
  assumptions: Type.Array(Type.String()),
  missing: Type.Array(Type.String()),
  unsupported: Type.Array(Type.String()),
});

export type AssistantInput = Static<typeof AssistantInput>;
export type AssistantCitation = Static<typeof AssistantCitation>;
export type AssistantAnswer = Static<typeof AssistantAnswer>;
