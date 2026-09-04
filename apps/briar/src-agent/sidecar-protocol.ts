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
import {
  providerBlockFromProto,
  providerBlockToProto,
  type ProviderBlock,
} from "../src/lib/provider-block";

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

/** A runner's block, encoded on the wire as `briar.types.v1.ProviderBlock`. */
export type SidecarBlockedInput = ProviderBlock;

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
): RunnerToParent =>
  create(RunnerToParentSchema, {
    payload: {
      case: "blocked",
      value: create(RunBlockedSchema, {
        block: providerBlockToProto(input),
      }),
    },
  });

/** The block carried by a `blocked` frame, or null for any other frame. */
export const sidecarProviderBlock = (
  message: RunnerToParent,
): ProviderBlock | null =>
  message.payload.case === "blocked"
    ? providerBlockFromProto(message.payload.value.block)
    : null;

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
