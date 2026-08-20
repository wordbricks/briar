import * as Schema from "effect/Schema";

const decoderOptions = {
  onExcessProperty: "preserve",
  propertyOrder: "original",
} as const;

const ApprovalResponse = Schema.Struct({
  type: Schema.Literal("approvalResponse"),
  id: Schema.String,
  approved: Schema.Boolean,
});

const RunRequestEnvelope = Schema.Struct({
  type: Schema.Literal("run"),
});

export const decodeApprovalResponse = Schema.decodeUnknownOption(
  ApprovalResponse,
  decoderOptions,
);

export const isRunRequestEnvelope = Schema.is(RunRequestEnvelope);
