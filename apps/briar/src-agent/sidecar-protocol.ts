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
  timestampDate,
  timestampFromDate,
  type Value,
} from "@bufbuild/protobuf/wkt";
import { CONTRACTS_DESCRIPTOR_FINGERPRINT } from "@briar/contracts/descriptor-fingerprint";
import {
  ApprovalPolicy,
  ApprovalRequestSchema,
  ApprovalResponseSchema,
  BlockReason,
  EventDirection,
  JsonSchemaSchema,
  ParentToRunnerSchema,
  ProviderEventSchema,
  RunBlockedSchema,
  RunErrorCode,
  RunErrorSchema,
  RunResultSchema,
  RunRequestSchema,
  RunnerToParentSchema,
  SandboxMode,
  SessionStartedSchema,
  type JsonSchema as ProtoJsonSchema,
  type ParentToRunner,
  type RunnerToParent,
} from "@briar/contracts/gen/briar/sidecar/v1/agent_runner_pb";
import {
  AgentActivityKind as ProtoAgentActivityKind,
  AgentActivityStatus as ProtoAgentActivityStatus,
  NormalizedAgentEventSchema,
  type NormalizedAgentEvent as ProtoNormalizedAgentEvent,
} from "@briar/contracts/gen/briar/types/v1/agent_event_pb";
import { timingSafeEqual } from "node:crypto";
import type { NormalizedAgentEvent } from "./normalized-agent-event";

export type SidecarRunRequest = {
  type: "run";
  message: string;
  workspaceRoot: string;
  conversationId?: string | null;
  instructions?: string | null;
  outputSchema?: Record<string, unknown> | boolean | null;
  model?: string | null;
  effort?: string | null;
  approvalPolicy: "untrusted" | "on-request" | "never";
  sandboxMode: "readOnly" | "workspaceWrite" | "dangerFullAccess";
  networkAccess: boolean;
  attachments?: ReadonlyArray<{
    type: "image";
    path: string;
    name: string;
    mimeType: string;
  }>;
  additionalDirectories?: ReadonlyArray<string>;
  externalTools?: boolean;
  providerBinaryPath: string;
};

export type SidecarRunnerOutput =
  | { type: "session"; sessionId: string }
  | {
      type: "event";
      raw: unknown;
      event?: NormalizedAgentEvent;
      direction?: "client" | "server";
    }
  | {
      type: "approval";
      id: string;
      toolName: string;
      input: Record<string, unknown>;
      title?: string;
    }
  | { type: "result"; sessionId: string; message: string }
  | {
      type: "blocked";
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
    }
  | { type: "error"; message: string };

const approvalPolicyToProto = {
  untrusted: ApprovalPolicy.UNTRUSTED,
  "on-request": ApprovalPolicy.ON_REQUEST,
  never: ApprovalPolicy.NEVER,
} as const;

const approvalPolicyFromProto = (
  value: ApprovalPolicy,
): SidecarRunRequest["approvalPolicy"] => {
  switch (value) {
    case ApprovalPolicy.UNTRUSTED:
      return "untrusted";
    case ApprovalPolicy.ON_REQUEST:
      return "on-request";
    case ApprovalPolicy.NEVER:
      return "never";
    default:
      throw new Error(`Unsupported sidecar approval policy: ${value}`);
  }
};

const sandboxModeToProto = {
  readOnly: SandboxMode.READ_ONLY,
  workspaceWrite: SandboxMode.WORKSPACE_WRITE,
  dangerFullAccess: SandboxMode.DANGER_FULL_ACCESS,
} as const;

const sandboxModeFromProto = (
  value: SandboxMode,
): SidecarRunRequest["sandboxMode"] => {
  switch (value) {
    case SandboxMode.READ_ONLY:
      return "readOnly";
    case SandboxMode.WORKSPACE_WRITE:
      return "workspaceWrite";
    case SandboxMode.DANGER_FULL_ACCESS:
      return "dangerFullAccess";
    default:
      throw new Error(`Unsupported sidecar sandbox mode: ${value}`);
  }
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

const eventDirectionFromProto = (
  value: EventDirection,
): "client" | "server" => {
  switch (value) {
    case EventDirection.CLIENT:
      return "client";
    case EventDirection.SERVER:
      return "server";
    default:
      throw new Error(`Unsupported sidecar event direction: ${value}`);
  }
};

const blockReasonToProto = {
  mcp_auth_required: BlockReason.MCP_AUTH_REQUIRED,
  usage_exhausted: BlockReason.USAGE_EXHAUSTED,
  upstream_overloaded: BlockReason.UPSTREAM_OVERLOADED,
  free_tier_limit: BlockReason.FREE_TIER_LIMIT,
} as const;

const blockReasonFromProto = (
  value: BlockReason,
): Extract<SidecarRunnerOutput, { type: "blocked" }>["reason"] => {
  switch (value) {
    case BlockReason.MCP_AUTH_REQUIRED:
      return "mcp_auth_required";
    case BlockReason.USAGE_EXHAUSTED:
      return "usage_exhausted";
    case BlockReason.UPSTREAM_OVERLOADED:
      return "upstream_overloaded";
    case BlockReason.FREE_TIER_LIMIT:
      return "free_tier_limit";
    default:
      throw new Error(`Unsupported sidecar block reason: ${value}`);
  }
};

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

function normalizedEventFromProto(
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

function jsonSchemaToProto(
  value: SidecarRunRequest["outputSchema"],
) {
  if (value === undefined || value === null) return undefined;
  return create(JsonSchemaSchema, {
    value:
      typeof value === "boolean"
        ? { case: "boolean", value }
        : {
            case: "object",
            value: normalizedJson(value) as JsonObject,
          },
  });
}

function jsonSchemaFromProto(
  value: ProtoJsonSchema | undefined,
): SidecarRunRequest["outputSchema"] {
  if (!value) return undefined;
  switch (value.value.case) {
    case "boolean":
    case "object":
      return value.value.value;
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

export function decodeSidecarRunRequest(message: ParentToRunner): SidecarRunRequest {
  if (message.payload.case !== "run") {
    throw new Error("The first sidecar frame must contain a run request.");
  }
  const request = message.payload.value;
  assertProtocolFingerprint(request.protocolFingerprint);
  return {
      type: "run" as const,
    message: request.message,
    workspaceRoot: request.workspaceRoot,
    conversationId: request.conversationId,
    instructions: request.instructions,
    outputSchema: jsonSchemaFromProto(request.outputSchema),
    model: request.model,
    effort: request.effort,
    approvalPolicy: approvalPolicyFromProto(request.approvalPolicy),
    sandboxMode: sandboxModeFromProto(request.sandboxMode),
    networkAccess: request.networkAccess,
    attachments: request.attachments.map((attachment) => ({
      type: "image" as const,
      path: attachment.path,
      name: attachment.name,
      mimeType: attachment.mimeType,
    })),
    additionalDirectories: request.additionalDirectories,
    externalTools: request.externalTools,
    providerBinaryPath: request.providerBinaryPath,
  };
}

export function encodeSidecarRunRequest(
  request: SidecarRunRequest,
): Uint8Array {
  const run = create(RunRequestSchema, {
    message: request.message,
    workspaceRoot: request.workspaceRoot,
    conversationId: request.conversationId ?? undefined,
    instructions: request.instructions ?? undefined,
    outputSchema: jsonSchemaToProto(request.outputSchema),
    model: request.model ?? undefined,
    effort: request.effort ?? undefined,
    approvalPolicy: approvalPolicyToProto[request.approvalPolicy],
    sandboxMode: sandboxModeToProto[request.sandboxMode],
    networkAccess: request.networkAccess,
    attachments: (request.attachments ?? []).map(({ path, name, mimeType }) => ({
      path,
      name,
      mimeType,
    })),
    additionalDirectories: [...(request.additionalDirectories ?? [])],
    externalTools: request.externalTools,
    providerBinaryPath: request.providerBinaryPath,
    protocolFingerprint: CONTRACTS_DESCRIPTOR_FINGERPRINT,
  });
  return sizeDelimitedEncode(
    ParentToRunnerSchema,
    create(ParentToRunnerSchema, {
      payload: { case: "run", value: run },
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

export function encodeSidecarRunnerOutput(
  output: SidecarRunnerOutput,
): Uint8Array {
  let payload: RunnerToParent["payload"];
  switch (output.type) {
    case "session":
      payload = {
        case: "sessionStarted",
        value: create(SessionStartedSchema, { sessionId: output.sessionId }),
      };
      break;
    case "event":
      payload = {
        case: "event",
        value: create(ProviderEventSchema, {
          raw: rawToProto(output.raw),
          normalized: output.event
            ? normalizedEventToProto(output.event)
            : undefined,
          direction:
            output.direction === "client"
              ? EventDirection.CLIENT
              : EventDirection.SERVER,
        }),
      };
      break;
    case "approval":
      payload = {
        case: "approval",
        value: create(ApprovalRequestSchema, {
          id: output.id,
          toolName: output.toolName,
          input: normalizedJson(output.input) as JsonObject,
          title: output.title,
        }),
      };
      break;
    case "result":
      payload = {
        case: "result",
        value: create(RunResultSchema, {
          sessionId: output.sessionId,
          message: output.message,
        }),
      };
      break;
    case "blocked": {
      const retryDate = output.nextRetryAt
        ? new Date(output.nextRetryAt)
        : undefined;
      if (retryDate && Number.isNaN(retryDate.valueOf())) {
        throw new Error(`Invalid sidecar retry timestamp: ${output.nextRetryAt}`);
      }
      const nextRetryAt = retryDate ? timestampFromDate(retryDate) : undefined;
      payload = {
        case: "blocked",
        value: create(RunBlockedSchema, {
          reason: blockReasonToProto[output.reason],
          message: output.message,
          provider: output.provider,
          serverNames: output.serverNames ?? [],
          nextRetryAt,
          statusCode: output.statusCode,
        }),
      };
      break;
    }
    case "error":
      payload = {
        case: "error",
        value: create(RunErrorSchema, {
          code: RunErrorCode.PROVIDER_FAILED,
          message: output.message,
        }),
      };
      break;
  }
  return sizeDelimitedEncode(
    RunnerToParentSchema,
    create(RunnerToParentSchema, { payload }),
  );
}

export function decodeSidecarRunnerOutput(
  message: RunnerToParent,
): SidecarRunnerOutput {
  switch (message.payload.case) {
    case "sessionStarted":
      return {
        type: "session",
        sessionId: message.payload.value.sessionId,
      };
    case "event": {
      const event = message.payload.value.normalized
        ? normalizedEventFromProto(message.payload.value.normalized)
        : undefined;
      return {
        type: "event",
        raw: message.payload.value.raw
          ? rawFromProto(message.payload.value.raw)
          : null,
        ...(event ? { event } : {}),
        direction: eventDirectionFromProto(message.payload.value.direction),
      };
    }
    case "approval":
      return {
        type: "approval",
        id: message.payload.value.id,
        toolName: message.payload.value.toolName,
        input: (message.payload.value.input ?? {}) as Record<string, unknown>,
        ...(message.payload.value.title
          ? { title: message.payload.value.title }
          : {}),
      };
    case "result":
      return {
        type: "result",
        sessionId: message.payload.value.sessionId,
        message: message.payload.value.message,
      };
    case "blocked": {
      return {
        type: "blocked",
        reason: blockReasonFromProto(message.payload.value.reason),
        message: message.payload.value.message,
        ...(message.payload.value.provider
          ? { provider: message.payload.value.provider }
          : {}),
        ...(message.payload.value.serverNames.length > 0
          ? { serverNames: message.payload.value.serverNames }
          : {}),
        nextRetryAt: message.payload.value.nextRetryAt
          ? timestampDate(message.payload.value.nextRetryAt).toISOString()
          : null,
        ...(message.payload.value.statusCode === undefined
          ? {}
          : { statusCode: message.payload.value.statusCode }),
      };
    }
    case "error":
      return { type: "error", message: message.payload.value.message };
    case undefined:
      throw new Error("Sidecar output frame does not contain a payload.");
  }
}
