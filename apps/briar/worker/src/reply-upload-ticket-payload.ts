import * as Schema from "effect/Schema";

const Uuid = Schema.String.check(Schema.isPattern(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
));

export const ReplyUploadTicketPayload = Schema.Struct({
  purpose: Schema.Literal("reply-attachment-upload"),
  attachmentId: Uuid,
  expiresAt: Schema.Int,
  nonce: Uuid,
});

export type ReplyUploadTicketPayload = typeof ReplyUploadTicketPayload.Type;

export const decodeReplyUploadTicketPayloadJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(ReplyUploadTicketPayload),
  { onExcessProperty: "preserve", propertyOrder: "original" },
);
