import { Type, type Static } from '@sinclair/typebox';

export const ModelRequest = Type.Object({
  purpose: Type.Union([
    Type.Literal('text'),
    Type.Literal('vision'),
    Type.Literal('json'),
  ]),
  messages: Type.Array(
    Type.Object({
      role: Type.Union([Type.Literal('system'), Type.Literal('user'), Type.Literal('assistant')]),
      content: Type.String(),
    }),
  ),
  /** Optional image URLs/data URLs for vision — never logged in full. */
  images: Type.Optional(Type.Array(Type.String())),
  responseFormat: Type.Optional(Type.Literal('json')),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 1000 })),
});

export const ModelResponse = Type.Object({
  text: Type.String(),
  json: Type.Optional(Type.Unknown()),
  modelId: Type.String(),
  usage: Type.Optional(
    Type.Object({
      promptTokens: Type.Optional(Type.Integer()),
      completionTokens: Type.Optional(Type.Integer()),
    }),
  ),
});

export const ModelCapabilities = Type.Object({
  text: Type.Boolean(),
  vision: Type.Boolean(),
  embedding: Type.Literal(false),
  modelId: Type.Union([Type.String(), Type.Null()]),
  probedAt: Type.Union([Type.String(), Type.Null()]),
  unavailableReason: Type.Union([Type.String(), Type.Null()]),
});

export type ModelRequest = Static<typeof ModelRequest>;
export type ModelResponse = Static<typeof ModelResponse>;
export type ModelCapabilities = Static<typeof ModelCapabilities>;
