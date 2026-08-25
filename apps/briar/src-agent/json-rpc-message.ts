import * as Schema from "effect/Schema";

const JsonRpcId = Schema.Union([
  Schema.Finite,
  Schema.String,
  Schema.Null,
]);

const JsonRpcError = Schema.Struct({
  code: Schema.optional(Schema.Finite),
  message: Schema.optional(Schema.String),
  data: Schema.optional(Schema.Unknown),
});

export const JsonRpcMessage = Schema.Struct({
  jsonrpc: Schema.optional(Schema.String),
  id: Schema.optional(JsonRpcId),
  method: Schema.optional(Schema.String),
  params: Schema.optional(Schema.Unknown),
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.NullOr(JsonRpcError)),
});

export type JsonRpcMessage = typeof JsonRpcMessage.Type;

const JsonRpcMessageJson = Schema.fromJsonString(JsonRpcMessage);
const decoderOptions = {
  onExcessProperty: "preserve",
  propertyOrder: "original",
} as const;

export const decodeJsonRpcMessageJsonOption = Schema.decodeUnknownOption(
  JsonRpcMessageJson,
  decoderOptions,
);

export const decodeJsonRpcMessageJsonResult = Schema.decodeUnknownResult(
  JsonRpcMessageJson,
  decoderOptions,
);
