import { Type, type Static } from '@sinclair/typebox';

/** Missing / unknown numeric — never coerce to 0. */
export const UnknownNull = Type.Union([Type.Null(), Type.Literal('unknown')]);

export const QuantityExpr = Type.Object({
  kind: Type.Union([
    Type.Literal('number'),
    Type.Literal('sum'),
    Type.Literal('unknown'),
    Type.Literal('raw'),
  ]),
  value: Type.Optional(Type.Number()),
  parts: Type.Optional(Type.Array(Type.Number())),
  raw: Type.String(),
  unit: Type.Union([Type.String(), UnknownNull]),
});

export const ResourceAmount = Type.Object({
  resourceName: Type.String(),
  quantity: QuantityExpr,
  evidence: Type.Optional(Type.String()),
});

export const ProductionRecipeDraft = Type.Object({
  city: Type.Union([Type.String(), UnknownNull]),
  tier: Type.Union([Type.String(), UnknownNull]),
  durationSeconds: Type.Union([Type.Integer({ minimum: 0 }), UnknownNull]),
  workers: Type.Union([Type.Integer({ minimum: 0 }), UnknownNull]),
  inputs: Type.Array(ResourceAmount),
  outputs: Type.Array(ResourceAmount),
  rawCells: Type.Record(Type.String(), Type.String()),
  confirmation: Type.Union([
    Type.Literal('draft'),
    Type.Literal('reviewed'),
    Type.Literal('published'),
  ]),
});

export const ParsedBuildingDraft = Type.Object({
  name: Type.String(),
  snapshotId: Type.String(),
  sourceUrl: Type.String(),
  revision: Type.Union([Type.Integer(), UnknownNull]),
  variants: Type.Array(
    Type.Object({
      city: Type.Union([Type.String(), UnknownNull]),
      recipes: Type.Array(ProductionRecipeDraft),
    }),
  ),
  aliases: Type.Array(Type.String()),
  notes: Type.Array(Type.String()),
  fieldSources: Type.Record(Type.String(), Type.String()),
});

export const KnowledgeBundle = Type.Object({
  bundleId: Type.String(),
  contentHash: Type.String(),
  createdAt: Type.String(),
  parserVersion: Type.String(),
  drafts: Type.Array(ParsedBuildingDraft),
  chunks: Type.Array(
    Type.Object({
      entityName: Type.String(),
      city: Type.Union([Type.String(), UnknownNull]),
      heading: Type.String(),
      body: Type.String(),
      snapshotId: Type.String(),
    }),
  ),
});

export const KnowledgeQuery = Type.Object({
  q: Type.String({ minLength: 1 }),
  city: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
});

export const KnowledgeHit = Type.Object({
  entityId: Type.String(),
  name: Type.String(),
  city: Type.Union([Type.String(), UnknownNull]),
  snippet: Type.String(),
  confirmation: Type.String(),
  sourceUrl: Type.Union([Type.String(), Type.Null()]),
  updatedAt: Type.Union([Type.String(), Type.Null()]),
  snapshotId: Type.Union([Type.String(), Type.Null()]),
});

export type QuantityExpr = Static<typeof QuantityExpr>;
export type ResourceAmount = Static<typeof ResourceAmount>;
export type ProductionRecipeDraft = Static<typeof ProductionRecipeDraft>;
export type ParsedBuildingDraft = Static<typeof ParsedBuildingDraft>;
export type KnowledgeBundle = Static<typeof KnowledgeBundle>;
export type KnowledgeQuery = Static<typeof KnowledgeQuery>;
export type KnowledgeHit = Static<typeof KnowledgeHit>;

export type SourceSnapshot = {
  snapshotId: string;
  title: string;
  sourceUrl: string;
  revision: number | null;
  html: string;
  fetchedAt: string;
};
