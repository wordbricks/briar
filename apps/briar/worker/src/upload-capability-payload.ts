import * as Schema from "effect/Schema";

const Uuid = Schema.String.check(Schema.isPattern(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
));

export const UploadCapabilityPayload = Schema.Struct({
  purpose: Schema.Literal("raw-upload"),
  uploadId: Uuid,
  expiresAt: Schema.Int,
  nonce: Uuid,
});

export const decodeUploadCapabilityPayloadJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(UploadCapabilityPayload),
  { onExcessProperty: "error", propertyOrder: "original" },
);
