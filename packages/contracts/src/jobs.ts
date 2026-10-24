import { Type, type Static } from '@sinclair/typebox';

export const JobKind = Type.Union([
  Type.Literal('assistant'),
  Type.Literal('recognition'),
  Type.Literal('layout'),
]);

export const AssistantJobInput = Type.Object({
  kind: Type.Literal('assistant'),
  question: Type.String({ minLength: 1 }),
  cityId: Type.Optional(Type.String()),
});

export const RecognitionJobInput = Type.Object({
  kind: Type.Literal('recognition'),
  uploadId: Type.String(),
  cityId: Type.Optional(Type.String()),
  panelType: Type.Optional(Type.String()),
});

export const LayoutJobInput = Type.Object({
  kind: Type.Literal('layout'),
  cityId: Type.String(),
  layoutId: Type.Optional(Type.String()),
  seed: Type.Optional(Type.Integer()),
});

export const JobInput = Type.Union([AssistantJobInput, RecognitionJobInput, LayoutJobInput]);

export const JobStatus = Type.Union([
  Type.Literal('queued'),
  Type.Literal('running'),
  Type.Literal('succeeded'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
]);

export const Job = Type.Object({
  id: Type.String(),
  userId: Type.String(),
  idempotencyKey: Type.String(),
  kind: JobKind,
  status: JobStatus,
  input: JobInput,
  result: Type.Optional(Type.Unknown()),
  error: Type.Optional(Type.Unknown()),
  attempts: Type.Integer({ minimum: 0 }),
  workerId: Type.Union([Type.String(), Type.Null()]),
  leaseExpiresAt: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export const JobResult = Type.Object({
  ok: Type.Boolean(),
  data: Type.Optional(Type.Unknown()),
  error: Type.Optional(
    Type.Object({
      code: Type.String(),
      message: Type.String(),
    }),
  ),
});

export type JobKind = Static<typeof JobKind>;
export type JobInput = Static<typeof JobInput>;
export type JobStatus = Static<typeof JobStatus>;
export type Job = Static<typeof Job>;
export type JobResult = Static<typeof JobResult>;
