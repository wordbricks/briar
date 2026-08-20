import * as Schema from "effect/Schema";

const decoderOptions = {
  onExcessProperty: "preserve",
  propertyOrder: "original",
} as const;

const approvalResponseEnvelopeFields = {
  type: Schema.Literal("approvalResponse"),
  id: Schema.String,
} satisfies Schema.Struct.Fields;

const ApprovalResponseEnvelope = Schema.Struct(
  approvalResponseEnvelopeFields,
);

const ApprovalResponse = Schema.Struct({
  ...approvalResponseEnvelopeFields,
  approved: Schema.Boolean,
});

const RunRequestEnvelope = Schema.Struct({
  type: Schema.Literal("run"),
});

export const decodeApprovalResponse = Schema.decodeUnknownOption(
  ApprovalResponse,
  decoderOptions,
);

export const decodeApprovalResponseEnvelope = Schema.decodeUnknownOption(
  ApprovalResponseEnvelope,
  decoderOptions,
);

export const isRunRequestEnvelope = Schema.is(RunRequestEnvelope);
