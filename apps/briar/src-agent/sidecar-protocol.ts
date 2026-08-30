import {
  create,
  fromJson,
  toJson,
  type JsonObject,
  type JsonValue,
} from "@bufbuild/protobuf";
import {
  sizeDelimitedEncode,
} from "@bufbuild/protobuf/wire";
import {
  ValueSchema,
  timestampFromDate,
  type Value,
} from "@bufbuild/protobuf/wkt";
import { CONTRACTS_DESCRIPTOR_FINGERPRINT } from "@briar/contracts/descriptor-fingerprint";
import {
  ApprovalRequestSchema,
  ApprovalResponseSchema,
  BlockReason,
  ParentToRunnerSchema,
  ProviderEventSchema,
  RunBlockedSchema,
  RunErrorCode,
  RunErrorSchema,
  RunResultSchema,
  RunnerToParentSchema,
  SessionStartedSchema,
  type ApprovalRequest as ProtoApprovalRequest,
  type ParentToRunner,
  type RunRequest,
  type RunResult as ProtoRunResult,
  type RunnerToParent,
} from "@briar/contracts/gen/briar/sidecar/v1/agent_runner_pb";
import {
  AgentEventDirection,
  AgentActivityKind as ProtoAgentActivityKind,
  AgentActivityStatus as ProtoAgentActivityStatus,
  NormalizedAgentEventSchema,
  type NormalizedAgentEvent as ProtoNormalizedAgentEvent,
} from "@briar/contracts/gen/briar/types/v1/agent_event_pb";
import { timingSafeEqual } from "node:crypto";
import type { NormalizedAgentEvent } from "./normalized-agent-event";

export type SidecarProviderEventInput = {
  raw: unknown;
  event?: NormalizedAgentEvent;
  direction?: "client" | "server";
};

export type SidecarApprovalInput = Pick<
  ProtoApprovalRequest,
  "id" | "toolName" | "title"
> & {
  input: Record<string, unknown>;
};

export type SidecarResultInput = Pick<
  ProtoRunResult,
  "sessionId" | "message"
>;

export type SidecarBlockedInput = {
  reason:
    | "mcp_auth_required"
    | "usage_exhausted"
    | "upstream_overloaded"
    | "free_tier_limit";
  message: string;
  provider?: string;
  serverNames?: string[];
  nextRetryAt?: string | null;
  statusCode?: number;
};

const activityKindToProto = {
  command: ProtoAgentActivityKind.COMMAND,
  fileChange: ProtoAgentActivityKind.FILE_CHANGE,
  webSearch: ProtoAgentActivityKind.WEB_SEARCH,
  tool: ProtoAgentActivityKind.TOOL,
} as const;

const activityKindFromProto = (
  value: ProtoAgentActivityKind,
): Extract<NormalizedAgentEvent, { type: "activityStarted" }>["kind"] => {
  switch (value) {
    case ProtoAgentActivityKind.COMMAND:
      return "command";
    case ProtoAgentActivityKind.FILE_CHANGE:
      return "fileChange";
    case ProtoAgentActivityKind.WEB_SEARCH:
      return "webSearch";
    case ProtoAgentActivityKind.TOOL:
      return "tool";
    default:
      throw new Error(`Unsupported agent activity kind: ${value}`);
  }
};

const activityStatusToProto = {
  completed: ProtoAgentActivityStatus.COMPLETED,
  failed: ProtoAgentActivityStatus.FAILED,
  cancelled: ProtoAgentActivityStatus.CANCELLED,
} as const;

const activityStatusFromProto = (
  value: ProtoAgentActivityStatus,
): Extract<NormalizedAgentEvent, { type: "activityCompleted" }>["status"] => {
  switch (value) {
    case ProtoAgentActivityStatus.COMPLETED:
      return "completed";
    case ProtoAgentActivityStatus.FAILED:
      return "failed";
    case ProtoAgentActivityStatus.CANCELLED:
      return "cancelled";
    default:
      throw new Error(`Unsupported agent activity status: ${value}`);
  }
};

const blockReasonToProto = {
  mcp_auth_required: BlockReason.MCP_AUTH_REQUIRED,
  usage_exhausted: BlockReason.USAGE_EXHAUSTED,
  upstream_overloaded: BlockReason.UPSTREAM_OVERLOADED,
  free_tier_limit: BlockReason.FREE_TIER_LIMIT,
} as const;

function normalizedJson(value: unknown): JsonValue {
  const serialized = JSON.stringify(value);
  return serialized === undefined
    ? null
    : (JSON.parse(serialized) as JsonValue);
}

const rawToProto = (value: unknown) =>
  fromJson(ValueSchema, normalizedJson(value));

const rawFromProto = (value: Value) =>
  toJson(ValueSchema, value);

export const sidecarProviderRaw = (
  message: RunnerToParent,
): unknown | undefined =>
  message.payload.case === "event" && message.payload.value.raw
    ? rawFromProto(message.payload.value.raw)
    : undefined;

function normalizedEventToProto(
  event: NormalizedAgentEvent,
): ProtoNormalizedAgentEvent {
  switch (event.type) {
    case "messageStarted":
      return create(NormalizedAgentEventSchema, {
        event: {
          case: "messageStarted",
          value: {
            id: event.id,
            phase: event.phase ?? undefined,
            text: event.text,
          },
        },
      });
    case "messageDelta":
      return create(NormalizedAgentEventSchema, {
        event: { case: "messageDelta", value: event },
      });
    case "messageCompleted":
      return create(NormalizedAgentEventSchema, {
        event: {
          case: "messageCompleted",
          value: {
            id: event.id,
            phase: event.phase ?? undefined,
            text: event.text,
          },
        },
      });
    case "activityStarted":
      return create(NormalizedAgentEventSchema, {
        event: {
          case: "activityStarted",
          value: {
            id: event.id,
            kind: activityKindToProto[event.kind],
            title: event.title,
            text: event.text,
          },
        },
      });
    case "activityDelta":
      return create(NormalizedAgentEventSchema, {
        event: { case: "activityDelta", value: event },
      });
    case "activityCompleted":
      return create(NormalizedAgentEventSchema, {
        event: {
          case: "activityCompleted",
          value: {
            id: event.id,
            kind: activityKindToProto[event.kind],
            title: event.title,
            text: event.text,
            status: activityStatusToProto[event.status],
          },
        },
      });
    case "turnCompleted":
      return create(NormalizedAgentEventSchema, {
        event: { case: "turnCompleted", value: event },
      });
  }
}

export function sidecarNormalizedEvent(
  event: ProtoNormalizedAgentEvent,
): NormalizedAgentEvent | undefined {
  switch (event.event.case) {
    case "conversationStarted":
      // Session starts have their own sidecar envelope and are synthesized by
      // the parent with the project-scoped conversation ID.
      return undefined;
    case "messageStarted":
      return {
        type: "messageStarted",
        id: event.event.value.id,
        phase: event.event.value.phase ?? null,
        text: event.event.value.text,
      };
    case "messageDelta":
      return { type: "messageDelta", ...event.event.value };
    case "messageCompleted":
      return {
        type: "messageCompleted",
        id: event.event.value.id,
        phase: event.event.value.phase ?? null,
        text: event.event.value.text,
      };
    case "activityStarted":
      return {
        type: "activityStarted",
        id: event.event.value.id,
        kind: activityKindFromProto(event.event.value.kind),
        title: event.event.value.title,
        text: event.event.value.text,
      };
    case "activityDelta":
      return { type: "activityDelta", ...event.event.value };
    case "activityCompleted":
      return {
        type: "activityCompleted",
        id: event.event.value.id,
        kind: activityKindFromProto(event.event.value.kind),
        title: event.event.value.title,
        text: event.event.value.text,
        status: activityStatusFromProto(event.event.value.status),
      };
    case "turnCompleted":
      return { type: "turnCompleted", status: event.event.value.status };
    case undefined:
      return undefined;
  }
}

function assertProtocolFingerprint(actual: Uint8Array) {
  if (
    actual.byteLength !== CONTRACTS_DESCRIPTOR_FINGERPRINT.byteLength ||
    !timingSafeEqual(actual, CONTRACTS_DESCRIPTOR_FINGERPRINT)
  ) {
    throw new Error(
      "Briar sidecar protocol fingerprint does not match this runner bundle.",
    );
  }
}

export function decodeSidecarRunRequest(message: ParentToRunner): RunRequest {
  if (message.payload.case !== "run") {
    throw new Error("The first sidecar frame must contain a run request.");
  }
  assertProtocolFingerprint(message.payload.value.protocolFingerprint);
  return message.payload.value;
}

export function encodeSidecarRunRequest(
  request: RunRequest,
): Uint8Array {
  return sizeDelimitedEncode(
    ParentToRunnerSchema,
    create(ParentToRunnerSchema, {
      payload: { case: "run", value: request },
    }),
  );
}

export function encodeSidecarApprovalResponse(
  id: string,
  approved: boolean,
): Uint8Array {
  return sizeDelimitedEncode(
    ParentToRunnerSchema,
    create(ParentToRunnerSchema, {
      payload: {
        case: "approvalResponse",
        value: create(ApprovalResponseSchema, { id, approved }),
      },
    }),
  );
}

export const sidecarSessionStarted = (sessionId: string): RunnerToParent =>
  create(RunnerToParentSchema, {
    payload: {
      case: "sessionStarted",
      value: create(SessionStartedSchema, { sessionId }),
    },
  });

export const sidecarProviderEvent = (
  input: SidecarProviderEventInput,
): RunnerToParent =>
  create(RunnerToParentSchema, {
    payload: {
      case: "event",
      value: create(ProviderEventSchema, {
        raw: rawToProto(input.raw),
        normalized: input.event
          ? normalizedEventToProto(input.event)
          : undefined,
        direction:
          input.direction === "client"
            ? AgentEventDirection.CLIENT
            : AgentEventDirection.SERVER,
      }),
    },
  });

export const sidecarApprovalRequest = (
  input: SidecarApprovalInput,
): RunnerToParent =>
  create(RunnerToParentSchema, {
    payload: {
      case: "approval",
      value: create(ApprovalRequestSchema, {
        id: input.id,
        toolName: input.toolName,
        input: normalizedJson(input.input) as JsonObject,
        title: input.title,
      }),
    },
  });

export const sidecarRunResult = (
  input: SidecarResultInput,
): RunnerToParent =>
  create(RunnerToParentSchema, {
    payload: {
      case: "result",
      value: create(RunResultSchema, input),
    },
  });

export const sidecarRunBlocked = (
  input: SidecarBlockedInput,
): RunnerToParent => {
  const retryDate = input.nextRetryAt
    ? new Date(input.nextRetryAt)
    : undefined;
  if (retryDate && Number.isNaN(retryDate.valueOf())) {
    throw new Error(`Invalid sidecar retry timestamp: ${input.nextRetryAt}`);
  }
  return create(RunnerToParentSchema, {
    payload: {
      case: "blocked",
      value: create(RunBlockedSchema, {
        reason: blockReasonToProto[input.reason],
        message: input.message,
        provider: input.provider,
        serverNames: input.serverNames ?? [],
        nextRetryAt: retryDate ? timestampFromDate(retryDate) : undefined,
        statusCode: input.statusCode,
      }),
    },
  });
};

export const sidecarRunError = (message: string): RunnerToParent =>
  create(RunnerToParentSchema, {
    payload: {
      case: "error",
      value: create(RunErrorSchema, {
        code: RunErrorCode.PROVIDER_FAILED,
        message,
      }),
    },
  });

export const encodeSidecarRunnerOutput = (
  output: RunnerToParent,
): Uint8Array => sizeDelimitedEncode(RunnerToParentSchema, output);
