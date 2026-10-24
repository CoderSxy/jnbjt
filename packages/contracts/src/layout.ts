import { Type, type Static } from '@sinclair/typebox';

export const GridRect = Type.Object({
  x: Type.Integer(),
  y: Type.Integer(),
  w: Type.Integer({ minimum: 1 }),
  h: Type.Integer({ minimum: 1 }),
});

export const LayoutBuilding = Type.Object({
  id: Type.String(),
  typeName: Type.String(),
  x: Type.Integer(),
  y: Type.Integer(),
  w: Type.Integer({ minimum: 1 }),
  h: Type.Integer({ minimum: 1 }),
  rotation: Type.Union([Type.Literal(0), Type.Literal(90), Type.Literal(180), Type.Literal(270)]),
  locked: Type.Boolean(),
});

export const Layout = Type.Object({
  schemaVersion: Type.Integer({ minimum: 1 }),
  knowledgeVersion: Type.Union([Type.String(), Type.Null()]),
  width: Type.Integer({ minimum: 1 }),
  height: Type.Integer({ minimum: 1 }),
  buildable: Type.Array(GridRect),
  blocked: Type.Array(GridRect),
  roads: Type.Array(GridRect),
  buildings: Type.Array(LayoutBuilding),
  customBasemap: Type.Boolean(),
  notes: Type.Optional(Type.String()),
});

export const LayoutRuleSet = Type.Object({
  requireRoadAdjacent: Type.Boolean(),
  allowRotate: Type.Boolean(),
  statueEffects: Type.Array(
    Type.Object({
      typeName: Type.String(),
      mode: Type.Union([
        Type.Literal('verified_rect'),
        Type.Literal('unknown'),
      ]),
      /** Inclusive rect relative to building origin when verified_rect */
      relativeCoverage: Type.Optional(GridRect),
    }),
  ),
});

export const LayoutIssue = Type.Object({
  code: Type.String(),
  message: Type.String(),
  buildingId: Type.Optional(Type.String()),
  severity: Type.Union([Type.Literal('error'), Type.Literal('unknown')]),
});

export const LayoutValidation = Type.Object({
  ok: Type.Boolean(),
  issues: Type.Array(LayoutIssue),
});

export const EffectRule = Type.Object({
  typeName: Type.String(),
  mode: Type.Union([Type.Literal('verified_rect'), Type.Literal('unknown')]),
  relativeCoverage: Type.Optional(GridRect),
});

export const EffectEvaluation = Type.Object({
  status: Type.Union([Type.Literal('ok'), Type.Literal('unknown')]),
  affectedBuildingIds: Type.Array(Type.String()),
  reason: Type.Optional(Type.String()),
});

export type GridRect = Static<typeof GridRect>;
export type LayoutBuilding = Static<typeof LayoutBuilding>;
export type Layout = Static<typeof Layout>;
export type LayoutRuleSet = Static<typeof LayoutRuleSet>;
export type LayoutIssue = Static<typeof LayoutIssue>;
export type LayoutValidation = Static<typeof LayoutValidation>;
export type EffectRule = Static<typeof EffectRule>;
export type EffectEvaluation = Static<typeof EffectEvaluation>;
