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
  type NormalizedAgentEvent,
} from "@briar/contracts/gen/briar/types/v1/agent_event_pb";
import { timingSafeEqual } from "node:crypto";

export type SidecarProviderEventInput = {
  raw: unknown;
  event?: NormalizedAgentEvent;
  direction?: AgentEventDirection;
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
        normalized: input.event,
        direction: input.direction ?? AgentEventDirection.SERVER,
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
