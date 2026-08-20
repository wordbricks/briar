import * as Schema from "effect/Schema";
import { IsoDateTimeUtc } from "./date-time-schema";

export const CHANNEL_AGENT_ACTIVITY_VERSION = 1 as const;
export const CHANNEL_AGENT_ACTIVITY_HEADLINE_MAX_LENGTH = 240;
export const CHANNEL_AGENT_ACTIVITY_STALE_MS = 30_000;

const strictSchemaOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const;
const PositiveInteger = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
);

export const ChannelAgentActivityKind = Schema.Literals([
  "message",
  "command",
  "fileChange",
  "webSearch",
  "tool",
]);
export type ChannelAgentActivityKind =
  typeof ChannelAgentActivityKind.Type;

export const ChannelAgentActivityDescriptor = Schema.Struct({
  id: Schema.Trim.check(Schema.isLengthBetween(1, 200)),
  kind: ChannelAgentActivityKind,
  headline: Schema.Trim.check(
    Schema.isLengthBetween(1, CHANNEL_AGENT_ACTIVITY_HEADLINE_MAX_LENGTH),
  ),
}).annotate({ parseOptions: strictSchemaOptions });
export type ChannelAgentActivityDescriptor =
  typeof ChannelAgentActivityDescriptor.Type;

export const ChannelAgentActivityPublishInput = Schema.Struct({
  // MAX_SAFE_INTEGER is reserved for the server's terminal clear tombstone.
  sequence: PositiveInteger.check(
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER - 1),
  ),
  activity: Schema.NullOr(ChannelAgentActivityDescriptor),
}).annotate({ parseOptions: strictSchemaOptions });
export type ChannelAgentActivityPublishInput =
  typeof ChannelAgentActivityPublishInput.Type;

export const ChannelAgentActivityFrame = Schema.Struct({
  version: Schema.Literal(CHANNEL_AGENT_ACTIVITY_VERSION),
  replyJobId: Schema.String.check(Schema.isUUID()),
  attempt: PositiveInteger,
  sequence: PositiveInteger,
  agentId: Schema.String.check(Schema.isUUID()),
  channelId: Schema.String.check(Schema.isUUID()),
  triggerMessageId: Schema.String.check(Schema.isUUID()),
  parentMessageId: Schema.String.check(Schema.isUUID()),
  activity: Schema.NullOr(ChannelAgentActivityDescriptor),
  sentAt: IsoDateTimeUtc,
  expiresAt: IsoDateTimeUtc,
}).annotate({ parseOptions: strictSchemaOptions });
export type ChannelAgentActivityFrame =
  typeof ChannelAgentActivityFrame.Type;

export const IssueAgentActivityFrame = Schema.Struct({
  version: Schema.Literal(CHANNEL_AGENT_ACTIVITY_VERSION),
  replyJobId: Schema.String.check(Schema.isUUID()),
  attempt: PositiveInteger,
  sequence: PositiveInteger,
  projectId: Schema.String.check(Schema.isUUID()),
  runId: Schema.String.check(Schema.isUUID()),
  triggerMessageId: Schema.String.check(Schema.isUUID()),
  parentMessageId: Schema.String.check(Schema.isUUID()),
  activity: Schema.NullOr(ChannelAgentActivityDescriptor),
  sentAt: IsoDateTimeUtc,
  expiresAt: IsoDateTimeUtc,
}).annotate({ parseOptions: strictSchemaOptions });
export type IssueAgentActivityFrame =
  typeof IssueAgentActivityFrame.Type;

export const AgentReplyActivityFrame = Schema.Union([
  ChannelAgentActivityFrame,
  IssueAgentActivityFrame,
]);
export type AgentReplyActivityFrame =
  typeof AgentReplyActivityFrame.Type;

export const decodeChannelAgentActivityFrameOption =
  Schema.decodeUnknownOption(ChannelAgentActivityFrame);
export const decodeIssueAgentActivityFrameOption =
  Schema.decodeUnknownOption(IssueAgentActivityFrame);
export const decodeAgentReplyActivityFrameOption =
  Schema.decodeUnknownOption(AgentReplyActivityFrame);
