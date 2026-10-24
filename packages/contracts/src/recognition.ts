import { Type, type Static } from '@sinclair/typebox';
import { CityState } from './city.js';

export const RecognitionField = Type.Object({
  path: Type.String(),
  value: Type.Union([Type.String(), Type.Number(), Type.Null()]),
  raw: Type.Union([Type.String(), Type.Null()]),
  status: Type.Union([
    Type.Literal('known'),
    Type.Literal('unknown'),
    Type.Literal('needs_review'),
  ]),
  evidence: Type.Optional(Type.String()),
});

export const RecognitionDraft = Type.Object({
  id: Type.String(),
  uploadId: Type.String(),
  cityId: Type.Union([Type.String(), Type.Null()]),
  fields: Type.Array(RecognitionField),
  status: Type.Union([
    Type.Literal('pending_review'),
    Type.Literal('applied'),
    Type.Literal('rejected'),
  ]),
});

export const RecognitionCorrections = Type.Object({
  fields: Type.Array(RecognitionField),
});

export const RecognitionContext = Type.Object({
  cityId: Type.Optional(Type.String()),
  panelType: Type.Optional(Type.String()),
});

export type RecognitionField = Static<typeof RecognitionField>;
export type RecognitionDraft = Static<typeof RecognitionDraft>;
export type RecognitionCorrections = Static<typeof RecognitionCorrections>;
export type RecognitionContext = Static<typeof RecognitionContext>;
export type CityStateForApply = Static<typeof CityState>;
