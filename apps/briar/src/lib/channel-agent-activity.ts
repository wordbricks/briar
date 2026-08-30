import {
  AgentActivitySchema,
  type AgentReplyActivityFrame as AgentReplyActivityFrameMessage,
  AgentReplyActivityFrameSchema,
  ChannelActivityScopeSchema,
  IssueActivityScopeSchema,
} from "@briar/contracts/gen/briar/realtime/v1/realtime_pb";
import { AgentActivityKind as ProtoAgentActivityKind } from "@briar/contracts/gen/briar/types/v1/agent_event_pb";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { timestampDate, timestampFromDate } from "@bufbuild/protobuf/wkt";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { IsoDateTimeUtc } from "./date-time-schema";

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

const decodeDomainFrame = Schema.decodeUnknownOption(AgentReplyActivityFrame);

const decodeProtobufFrame = Option.liftThrowable((bytes: Uint8Array) =>
  fromBinary(AgentReplyActivityFrameSchema, bytes)
);

const toDomainKind = (kind: ProtoAgentActivityKind): ChannelAgentActivityKind => {
  switch (kind) {
    case ProtoAgentActivityKind.MESSAGE:
      return "message";
    case ProtoAgentActivityKind.COMMAND:
      return "command";
    case ProtoAgentActivityKind.FILE_CHANGE:
      return "fileChange";
    case ProtoAgentActivityKind.WEB_SEARCH:
      return "webSearch";
    case ProtoAgentActivityKind.TOOL:
      return "tool";
    case ProtoAgentActivityKind.UNSPECIFIED:
      throw new Error("Agent activity kind is required");
  }
  throw new Error(`Unknown Agent activity kind: ${String(kind)}`);
};

const fromDomainKind = (kind: ChannelAgentActivityKind) => {
  switch (kind) {
    case "message":
      return ProtoAgentActivityKind.MESSAGE;
    case "command":
      return ProtoAgentActivityKind.COMMAND;
    case "fileChange":
      return ProtoAgentActivityKind.FILE_CHANGE;
    case "webSearch":
      return ProtoAgentActivityKind.WEB_SEARCH;
    case "tool":
      return ProtoAgentActivityKind.TOOL;
  }
};

const toDomainFrame = Option.liftThrowable(
  (message: AgentReplyActivityFrameMessage) => {
    if (
      message.sequence > BigInt(Number.MAX_SAFE_INTEGER) ||
      message.sentAt === undefined ||
      message.expiresAt === undefined
    ) {
      throw new Error("Invalid Agent activity revision or timestamps");
    }
    const common = {
      replyJobId: message.replyJobId,
      attempt: message.attempt,
      sequence: Number(message.sequence),
      triggerMessageId: message.triggerMessageId,
      parentMessageId: message.parentMessageId,
      activity: message.activity === undefined
        ? null
        : {
          id: message.activity.id,
          kind: toDomainKind(message.activity.kind),
          headline: message.activity.headline,
        },
      sentAt: timestampDate(message.sentAt).toISOString(),
      expiresAt: timestampDate(message.expiresAt).toISOString(),
    };
    switch (message.scope.case) {
      case "channel":
        return {
          ...common,
          agentId: message.scope.value.agentId,
          channelId: message.scope.value.channelId,
        };
      case "issue":
        return {
          ...common,
          projectId: message.scope.value.projectId,
          runId: message.scope.value.runId,
        };
      case undefined:
        throw new Error("Agent activity scope is required");
    }
  },
);

export const decodeAgentReplyActivityFrameBinaryOption = (
  bytes: Uint8Array,
) => Option.flatMap(
  decodeProtobufFrame(bytes),
  (message) => Option.flatMap(toDomainFrame(message), decodeDomainFrame),
);

export const decodeChannelAgentActivityFrameBinaryOption = (
  bytes: Uint8Array,
) => Option.filter(
  decodeAgentReplyActivityFrameBinaryOption(bytes),
  (frame): frame is ChannelAgentActivityFrame => "channelId" in frame,
);

export const decodeIssueAgentActivityFrameBinaryOption = (
  bytes: Uint8Array,
) => Option.filter(
  decodeAgentReplyActivityFrameBinaryOption(bytes),
  (frame): frame is IssueAgentActivityFrame => "projectId" in frame,
);

export const encodeAgentReplyActivityFrameBinary = (
  frame: AgentReplyActivityFrame,
) => {
  const activity = frame.activity === null
    ? undefined
    : create(AgentActivitySchema, {
      id: frame.activity.id,
      kind: fromDomainKind(frame.activity.kind),
      headline: frame.activity.headline,
    });
  const scope = "channelId" in frame
    ? {
      case: "channel" as const,
      value: create(ChannelActivityScopeSchema, {
        agentId: frame.agentId,
        channelId: frame.channelId,
      }),
    }
    : {
      case: "issue" as const,
      value: create(IssueActivityScopeSchema, {
        projectId: frame.projectId,
        runId: frame.runId,
      }),
    };
  return toBinary(
    AgentReplyActivityFrameSchema,
    create(AgentReplyActivityFrameSchema, {
      replyJobId: frame.replyJobId,
      attempt: frame.attempt,
      sequence: BigInt(frame.sequence),
      triggerMessageId: frame.triggerMessageId,
      parentMessageId: frame.parentMessageId,
      activity,
      sentAt: timestampFromDate(new Date(frame.sentAt)),
      expiresAt: timestampFromDate(new Date(frame.expiresAt)),
      scope,
    }),
  );
};
