import { Type, type Static } from '@sinclair/typebox';

export const CityState = Type.Object({
  prefectLevel: Type.Integer({ minimum: 1 }),
  unlockedAreas: Type.Array(Type.String()),
  inventory: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
  buildings: Type.Array(
    Type.Object({
      typeName: Type.String(),
      level: Type.Integer({ minimum: 1 }),
      count: Type.Integer({ minimum: 1 }),
      workersAssigned: Type.Optional(Type.Integer({ minimum: 0 })),
    }),
  ),
  workersAvailable: Type.Integer({ minimum: 0 }),
  notes: Type.Optional(Type.String()),
});

export const CitySnapshot = Type.Object({
  id: Type.String(),
  cityKey: Type.String(),
  displayName: Type.String(),
  version: Type.Integer({ minimum: 1 }),
  schemaVersion: Type.Integer({ minimum: 1 }),
  state: CityState,
  updatedAt: Type.String(),
});

export type CityState = Static<typeof CityState>;
export type CitySnapshot = Static<typeof CitySnapshot>;
