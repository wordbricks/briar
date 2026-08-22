import * as Schema from "effect/Schema";

export const ChannelRealtimeTicketPayload = Schema.Struct({
  organizationId: Schema.String,
  userId: Schema.NonEmptyString,
  expiresAt: Schema.Int,
  nonce: Schema.NonEmptyString,
});

export type ChannelRealtimeTicketPayload =
  typeof ChannelRealtimeTicketPayload.Type;

export const decodeChannelRealtimeTicketPayloadJson =
  Schema.decodeUnknownOption(
    Schema.fromJsonString(ChannelRealtimeTicketPayload),
    {
      onExcessProperty: "preserve",
      propertyOrder: "original",
    },
  );
