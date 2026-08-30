import {
  type AgentReplyActivityFrame as AgentReplyActivityFrameMessage,
  AgentReplyActivityFrameSchema,
  type ChannelActivityScope,
  type IssueActivityScope,
} from "@briar/contracts/gen/briar/realtime/v1/realtime_pb";
import { AgentActivityKind as ProtoAgentActivityKind } from "@briar/contracts/gen/briar/types/v1/agent_event_pb";
import { fromBinary, toBinary } from "@bufbuild/protobuf";
import { timestampDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

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

export type AgentReplyActivityFrame = AgentReplyActivityFrameMessage;

declare const validatedAgentReplyActivityFrame: unique symbol;
export type ValidatedAgentReplyActivityFrame =
  Omit<AgentReplyActivityFrameMessage, "scope"> & {
    scope: Exclude<
      AgentReplyActivityFrameMessage["scope"],
      { case: undefined }
    >;
    readonly [validatedAgentReplyActivityFrame]: true;
  };

type CommonAgentActivityFrame = Omit<
  AgentReplyActivityFrameMessage,
  | "$typeName"
  | "$unknown"
  | "sequence"
  | "activity"
  | "sentAt"
  | "expiresAt"
  | "scope"
> & {
  sequence: number;
  activity: ChannelAgentActivityDescriptor | null;
  sentAt: string;
  expiresAt: string;
};

type DomainChannelScope = Omit<ChannelActivityScope, "$typeName" | "$unknown">;
type DomainIssueScope = Omit<IssueActivityScope, "$typeName" | "$unknown">;

export type ChannelAgentActivityFrame =
  CommonAgentActivityFrame & DomainChannelScope;

export type IssueAgentActivityFrame = CommonAgentActivityFrame & DomainIssueScope;

export type AgentReplyActivityDomainFrame =
  | ChannelAgentActivityFrame
  | IssueAgentActivityFrame;

const maxSafeSequence = BigInt(Number.MAX_SAFE_INTEGER);

const decodeDomainDescriptor = Schema.decodeUnknownSync(
  ChannelAgentActivityDescriptor,
);
const decodeUuid = Schema.decodeUnknownSync(
  Schema.String.check(Schema.isUUID()),
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

export const agentActivityKindToProto = (kind: ChannelAgentActivityKind) => {
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

const timestampMilliseconds = (value: Timestamp | undefined, name: string) => {
  if (value === undefined) throw new Error(`Agent activity ${name} is required`);
  const milliseconds = timestampDate(value).getTime();
  if (!Number.isFinite(milliseconds)) {
    throw new Error(`Agent activity ${name} is invalid`);
  }
  return milliseconds;
};

const validateProtobufFrame = (
  message: AgentReplyActivityFrameMessage,
): ValidatedAgentReplyActivityFrame => {
  if (
    message.attempt < 1 || message.sequence < 1n ||
    message.sequence > maxSafeSequence
  ) {
    throw new Error("Invalid Agent activity revision");
  }
  decodeUuid(message.replyJobId);
  decodeUuid(message.triggerMessageId);
  decodeUuid(message.parentMessageId);
  timestampMilliseconds(message.sentAt, "sent_at");
  timestampMilliseconds(message.expiresAt, "expires_at");
  if (message.activity !== undefined) {
    const descriptor = decodeDomainDescriptor({
      id: message.activity.id,
      kind: toDomainKind(message.activity.kind),
      headline: message.activity.headline,
    });
    if (
      descriptor.id !== message.activity.id ||
      descriptor.headline !== message.activity.headline
    ) {
      throw new Error("Agent activity descriptor is not canonical");
    }
  }
  switch (message.scope.case) {
    case "channel":
      decodeUuid(message.scope.value.agentId);
      decodeUuid(message.scope.value.channelId);
      break;
    case "issue":
      decodeUuid(message.scope.value.projectId);
      decodeUuid(message.scope.value.runId);
      break;
    case undefined:
      throw new Error("Agent activity scope is required");
  }
  return message as ValidatedAgentReplyActivityFrame;
};

const decodeProtobufFrame = Option.liftThrowable((bytes: Uint8Array) =>
  validateProtobufFrame(
    fromBinary(AgentReplyActivityFrameSchema, bytes),
  )
);

export const decodeAgentReplyActivityFrameBinaryOption = (
  bytes: Uint8Array,
) => decodeProtobufFrame(bytes);

export const encodeAgentReplyActivityFrameBinary = (
  frame: AgentReplyActivityFrameMessage,
) => toBinary(AgentReplyActivityFrameSchema, frame);

export const agentReplyActivityExpiresAt = (
  frame: AgentReplyActivityFrameMessage,
) => timestampMilliseconds(frame.expiresAt, "expires_at");

export const agentReplyActivityDomainFrameOption = Option.liftThrowable(
  (message: ValidatedAgentReplyActivityFrame): AgentReplyActivityDomainFrame => {
    const common: CommonAgentActivityFrame = {
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
      sentAt: new Date(
        timestampMilliseconds(message.sentAt, "sent_at"),
      ).toISOString(),
      expiresAt: new Date(
        timestampMilliseconds(message.expiresAt, "expires_at"),
      ).toISOString(),
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
    }
  },
);
