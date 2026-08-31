import {
  create,
  fromJson,
  toBinary,
  toJson,
  type JsonValue,
} from "@bufbuild/protobuf";
import {
  timestampFromDate,
  ValueSchema,
} from "@bufbuild/protobuf/wkt";
import {
  Code,
  ConnectError,
} from "@connectrpc/connect";
import {
  RunnerToParentSchema,
  type RunnerToParent,
} from "@briar/contracts/gen/briar/sidecar/v1/agent_runner_pb";
import {
  AgentTranscriptEventSchema,
  AppendTranscriptEventsRequestSchema,
  ReportIssueExecutionTelemetryRequestSchema,
  type ReportIssueExecutionTelemetryResponse,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import {
  AgentActivityKind,
  AgentActivityStatus,
  AgentEventDirection,
  NormalizedAgentEventSchema,
  type NormalizedAgentEvent,
} from "@briar/contracts/gen/briar/types/v1/agent_event_pb";
import {
  AgentExecutionModelSource,
  AgentExecutionMetricsSchema,
  AgentCostObservationSchema,
  AgentUsageObservationSchema,
} from "@briar/contracts/gen/briar/types/v1/agent_execution_pb";
import type { AgentExecutionCostRecord } from "../src/lib/agent-execution-cost";
import type {
  AgentExecutionMetrics,
  AgentExecutionUsageRecord,
} from "../src/lib/agent-execution-metrics";
import type { AgentProvider } from "../src/lib/agent-provider";
import {
  TranscriptBatcher,
  type TranscriptBatchEvent,
} from "./transcript-batcher";
import {
  agentProviderToProto,
  type ClaimedIssueReply,
  type ClaimedProjectAgentTask,
  type ClaimedRun,
} from "./worker-queue-contract";
import {
  createAuthenticatedWorkerExecutionClient,
  workClaimIdentityToProto,
} from "./worker-queue-client";

type TranscriptWork = ClaimedRun | ClaimedIssueReply | ClaimedProjectAgentTask;
type JsonRecord = Record<string, unknown>;

const record = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;

const string = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const jsonValue = (value: unknown): JsonValue => {
  const serialized = JSON.stringify(value);
  return serialized === undefined
    ? null
    : JSON.parse(serialized) as JsonValue;
};

const rawTranscriptPayload = (payload: unknown): unknown => {
  const envelope = record(payload);
  if (envelope?.type !== "event") return payload;
  return Object.hasOwn(envelope, "raw") ? envelope.raw : undefined;
};

const activityKind = (value: unknown): AgentActivityKind | null => {
  switch (value) {
    case "command":
      return AgentActivityKind.COMMAND;
    case "fileChange":
      return AgentActivityKind.FILE_CHANGE;
    case "webSearch":
      return AgentActivityKind.WEB_SEARCH;
    case "tool":
      return AgentActivityKind.TOOL;
    default:
      return null;
  }
};

const activityStatus = (value: unknown): AgentActivityStatus | null => {
  switch (value) {
    case "completed":
      return AgentActivityStatus.COMPLETED;
    case "failed":
      return AgentActivityStatus.FAILED;
    case "cancelled":
      return AgentActivityStatus.CANCELLED;
    default:
      return null;
  }
};

const normalizedRecord = (payload: unknown): JsonRecord | null => {
  const envelope = record(payload);
  if (!envelope) return null;
  if (envelope.type === "event") return record(envelope.event);
  const nested = record(envelope.event);
  return typeof nested?.type === "string" ? nested : envelope;
};

function normalizedTranscriptEventToProto(
  payload: unknown,
): NormalizedAgentEvent | undefined {
  const event = normalizedRecord(payload);
  if (!event) return undefined;
  switch (event.type) {
    case "conversationStarted": {
      const conversationId = string(event.conversationId);
      return conversationId === null
        ? undefined
        : create(NormalizedAgentEventSchema, {
            event: {
              case: "conversationStarted",
              value: { conversationId },
            },
          });
    }
    case "messageStarted":
    case "messageCompleted": {
      const id = string(event.id);
      const text = string(event.text);
      if (id === null || text === null) return undefined;
      return create(NormalizedAgentEventSchema, {
        event: {
          case: event.type,
          value: { id, text, phase: optionalString(event.phase) },
        },
      });
    }
    case "messageDelta":
    case "activityDelta": {
      const id = string(event.id);
      const delta = string(event.delta);
      if (id === null || delta === null) return undefined;
      return create(NormalizedAgentEventSchema, {
        event: { case: event.type, value: { id, delta } },
      });
    }
    case "activityStarted": {
      const id = string(event.id);
      const kind = activityKind(event.kind);
      const title = string(event.title);
      const text = string(event.text);
      if (id === null || kind === null || title === null || text === null) {
        return undefined;
      }
      return create(NormalizedAgentEventSchema, {
        event: {
          case: "activityStarted",
          value: { id, kind, title, text },
        },
      });
    }
    case "activityCompleted": {
      const id = string(event.id);
      const kind = activityKind(event.kind);
      const title = string(event.title);
      const text = string(event.text);
      const status = activityStatus(event.status);
      if (
        id === null || kind === null || title === null || text === null ||
        status === null
      ) {
        return undefined;
      }
      return create(NormalizedAgentEventSchema, {
        event: {
          case: "activityCompleted",
          value: { id, kind, title, text, status },
        },
      });
    }
    case "turnCompleted": {
      const status = string(event.status);
      return status === null
        ? undefined
        : create(NormalizedAgentEventSchema, {
            event: { case: "turnCompleted", value: { status } },
          });
    }
    default:
      return undefined;
  }
}

const archiveCompaction = (payload: unknown) => {
  const value = record(record(payload)?.archiveCompaction);
  return value?.kind === "delta" &&
      Number.isSafeInteger(value.firstSequence) &&
      (value.firstSequence as number) > 0 &&
      Number.isSafeInteger(value.eventCount) &&
      (value.eventCount as number) > 0
    ? {
        firstSequence: BigInt(value.firstSequence as number),
        representedEventCount: value.eventCount as number,
      }
    : undefined;
};

export const transcriptEventToProto = (event: TranscriptBatchEvent) => {
  const sidecar =
    event.payload && typeof event.payload === "object" &&
      "$typeName" in event.payload &&
      event.payload.$typeName === "briar.sidecar.v1.RunnerToParent"
      ? event.payload as RunnerToParent
      : undefined;
  if (sidecar) {
    const payload = sidecar.payload;
    if (payload.case === "event") {
      return create(AgentTranscriptEventSchema, {
        sequence: BigInt(event.sequence),
        direction: payload.value.direction,
        rawPayload: payload.value.raw,
        normalized: payload.value.normalized,
      });
    }
    return create(AgentTranscriptEventSchema, {
      sequence: BigInt(event.sequence),
      direction: AgentEventDirection.SERVER,
      rawPayload: fromJson(
        ValueSchema,
        toJson(RunnerToParentSchema, sidecar),
      ),
      normalized: payload.case === "sessionStarted"
        ? create(NormalizedAgentEventSchema, {
            event: {
              case: "conversationStarted",
              value: { conversationId: payload.value.sessionId },
            },
          })
        : undefined,
    });
  }
  const rawPayload = rawTranscriptPayload(event.payload);
  return create(AgentTranscriptEventSchema, {
    sequence: BigInt(event.sequence),
    direction: event.direction === "client"
      ? AgentEventDirection.CLIENT
      : AgentEventDirection.SERVER,
    rawPayload: rawPayload === undefined
      ? undefined
      : fromJson(ValueSchema, jsonValue(rawPayload)),
    normalized: normalizedTranscriptEventToProto(event.payload),
    archiveCompaction: archiveCompaction(event.payload),
  });
};

export const appendTranscriptEventsRequest = (input: {
  projectId: string;
  work: TranscriptWork;
  sessionId: string;
  agentProvider: AgentProvider;
  events: TranscriptBatchEvent[];
}) => create(AppendTranscriptEventsRequestSchema, {
  projectId: input.projectId,
  work: workClaimIdentityToProto(input.work),
  sessionId: input.sessionId,
  agentProvider: agentProviderToProto(input.agentProvider),
  events: input.events.map(transcriptEventToProto),
});

export const isConnectPayloadTooLarge = (error: unknown) =>
  error instanceof ConnectError && error.code === Code.ResourceExhausted;

export function createWorkerTranscriptBatcher(input: {
  apiUrl: string;
  token: string;
  projectId: string;
  work: TranscriptWork;
  sessionId: string;
  agentProvider: AgentProvider;
  onError?: (error: unknown) => void;
}) {
  const rpc = createAuthenticatedWorkerExecutionClient(input.apiUrl, input.token);
  const request = (events: TranscriptBatchEvent[]) =>
    appendTranscriptEventsRequest({
    ...input,
    events,
  });
  return new TranscriptBatcher({
    send: async (events) => {
      await rpc.appendTranscriptEvents(request(events));
    },
    measureBytes: (events) =>
      toBinary(AppendTranscriptEventsRequestSchema, request(events)).byteLength,
    isPayloadTooLarge: isConnectPayloadTooLarge,
    onError: input.onError,
  });
}

const optionalUint64 = (value: number | null): bigint | undefined =>
  value === null ? undefined : BigInt(value);

const modelSourceToProto = (
  value: AgentExecutionUsageRecord["modelSource"],
): AgentExecutionModelSource => {
  switch (value) {
    case "providerReported":
      return AgentExecutionModelSource.PROVIDER_REPORTED;
    case "providerConfig":
      return AgentExecutionModelSource.PROVIDER_CONFIG;
    case "configuredFallback":
      return AgentExecutionModelSource.CONFIGURED_FALLBACK;
    case "unknown":
      return AgentExecutionModelSource.UNKNOWN;
  }
};

const optional = <T>(value: T | null): T | undefined =>
  value === null ? undefined : value;

const usageObservationToProto = (record: AgentExecutionUsageRecord) =>
  create(AgentUsageObservationSchema, {
    usageKey: record.usageKey,
    sessionId: optional(record.sessionId),
    scopeId: optional(record.scopeId),
    turnId: optional(record.turnId),
    agentProvider: agentProviderToProto(record.agentProvider),
    modelProvider: optional(record.modelProvider),
    model: optional(record.model),
    canonicalModel: optional(record.canonicalModel),
    modelSource: modelSourceToProto(record.modelSource),
    source: record.source,
    uncachedInputTokens: optionalUint64(record.uncachedInputTokens),
    cacheReadTokens: optionalUint64(record.cacheReadTokens),
    cacheWriteTokens: optionalUint64(record.cacheWriteTokens),
    outputTokens: optionalUint64(record.outputTokens),
    reasoningOutputTokens: optionalUint64(record.reasoningOutputTokens),
    totalTokens: optionalUint64(record.totalTokens),
    observedAt: timestampFromDate(new Date(record.observedAt)),
  });

const costObservationToProto = (record: AgentExecutionCostRecord) =>
  create(AgentCostObservationSchema, {
    costKey: record.costKey,
    usageKey: optional(record.usageKey),
    sessionId: optional(record.sessionId),
    scopeId: optional(record.scopeId),
    turnId: optional(record.turnId),
    agentProvider: agentProviderToProto(record.agentProvider),
    modelProvider: optional(record.modelProvider),
    model: optional(record.model),
    canonicalModel: optional(record.canonicalModel),
    modelSource: modelSourceToProto(record.modelSource),
    source: record.source,
    amountUsdTicks: BigInt(record.amountUsdTicks),
    observedAt: timestampFromDate(new Date(record.observedAt)),
  });

const executionMetricsToProto = (metrics: AgentExecutionMetrics) =>
  create(AgentExecutionMetricsSchema, {
    inputTokens: optionalUint64(metrics.inputTokens),
    outputTokens: optionalUint64(metrics.outputTokens),
    cacheReadTokens: optionalUint64(metrics.cacheReadTokens),
    cacheWriteTokens: optionalUint64(metrics.cacheWriteTokens),
    reasoningOutputTokens: optionalUint64(metrics.reasoningOutputTokens),
    totalTokens: optionalUint64(metrics.totalTokens),
    durationMs: BigInt(metrics.durationMs),
  });

type IssueExecutionTelemetryInput = {
  projectId: string;
  work: ClaimedRun;
  agentProvider: AgentProvider;
  executionMetrics: AgentExecutionMetrics;
  usageObservations: AgentExecutionUsageRecord[];
  costObservations: AgentExecutionCostRecord[];
};

export const issueExecutionTelemetryRequest = (
  input: IssueExecutionTelemetryInput,
) => create(ReportIssueExecutionTelemetryRequestSchema, {
    projectId: input.projectId,
    work: workClaimIdentityToProto(input.work),
    executionId: input.work.executionId,
    agentProvider: agentProviderToProto(input.agentProvider),
    executionMetrics: executionMetricsToProto(input.executionMetrics),
    usageObservations: input.work.executionId
      ? input.usageObservations.map(usageObservationToProto)
      : [],
    costObservations: input.work.executionId
      ? input.costObservations.map(costObservationToProto)
      : [],
  });

export async function reportIssueExecutionTelemetry(
  input: IssueExecutionTelemetryInput & { apiUrl: string; token: string },
): Promise<ReportIssueExecutionTelemetryResponse> {
  const rpc = createAuthenticatedWorkerExecutionClient(input.apiUrl, input.token);
  return rpc.reportIssueExecutionTelemetry(issueExecutionTelemetryRequest(input));
}
