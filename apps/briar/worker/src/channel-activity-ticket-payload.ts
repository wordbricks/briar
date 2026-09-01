import * as Schema from "effect/Schema";

const activityUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const ActivityUuid = Schema.String.check(
  Schema.isPattern(activityUuidPattern),
);
const Attempt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
const ShortText = (maximumLength: number) =>
  Schema.String.check(Schema.isLengthBetween(1, maximumLength));

const WorkerId = ShortText(64);
const DeviceId = ShortText(200);
const UserId = ShortText(200);
const Nonce = ShortText(100);

export const ChannelActivityPublishTokenPayload = Schema.Struct({
  purpose: Schema.Literal("publish"),
  claimTokenHash: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u)),
  organizationId: ActivityUuid,
  channelId: ActivityUuid,
  replyJobId: ActivityUuid,
  agentId: ActivityUuid,
  triggerMessageId: ActivityUuid,
  parentMessageId: ActivityUuid,
  attempt: Attempt,
  workerId: WorkerId,
  deviceId: DeviceId,
  expiresAt: Schema.Int,
  nonce: Nonce,
});

export type ChannelActivityPublishTokenPayload =
  typeof ChannelActivityPublishTokenPayload.Type;

export const ChannelActivitySocketTicketPayload = Schema.Struct({
  purpose: Schema.Literal("subscribe"),
  organizationId: ActivityUuid,
  channelId: ActivityUuid,
  userId: UserId,
  expiresAt: Schema.Int,
  authorizationExpiresAt: Schema.Int,
  nonce: Nonce,
});

export type ChannelActivitySocketTicketPayload =
  typeof ChannelActivitySocketTicketPayload.Type;

export const IssueActivityPublishTokenPayload = Schema.Struct({
  purpose: Schema.Literal("publish-issue"),
  organizationId: ActivityUuid,
  projectId: ActivityUuid,
  runId: ActivityUuid,
  replyJobId: ActivityUuid,
  triggerMessageId: ActivityUuid,
  parentMessageId: ActivityUuid,
  attempt: Attempt,
  workerId: WorkerId,
  deviceId: DeviceId,
  expiresAt: Schema.Int,
  nonce: Nonce,
});

export type IssueActivityPublishTokenPayload =
  typeof IssueActivityPublishTokenPayload.Type;

export const IssueActivitySocketTicketPayload = Schema.Struct({
  purpose: Schema.Literal("subscribe-issue"),
  organizationId: ActivityUuid,
  projectId: ActivityUuid,
  runId: ActivityUuid,
  userId: UserId,
  expiresAt: Schema.Int,
  authorizationExpiresAt: Schema.Int,
  nonce: Nonce,
});

export type IssueActivitySocketTicketPayload =
  typeof IssueActivitySocketTicketPayload.Type;

const decoderOptions = {
  onExcessProperty: "preserve",
  propertyOrder: "original",
} as const;

export const decodeChannelActivityPublishTokenPayloadJson =
  Schema.decodeUnknownOption(
    Schema.fromJsonString(ChannelActivityPublishTokenPayload),
    decoderOptions,
  );

export const decodeChannelActivitySocketTicketPayloadJson =
  Schema.decodeUnknownOption(
    Schema.fromJsonString(ChannelActivitySocketTicketPayload),
    decoderOptions,
  );

export const decodeIssueActivityPublishTokenPayloadJson =
  Schema.decodeUnknownOption(
    Schema.fromJsonString(IssueActivityPublishTokenPayload),
    decoderOptions,
  );

export const decodeIssueActivitySocketTicketPayloadJson =
  Schema.decodeUnknownOption(
    Schema.fromJsonString(IssueActivitySocketTicketPayload),
    decoderOptions,
  );
