import { Buffer } from "node:buffer";
import {
  create,
  fromJson,
  toBinary,
  toJson,
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
  type AgentTranscriptEvent,
  type ReportIssueExecutionTelemetryResponse,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import {
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
  normalizedActivityText,
  normalizedActivityTitle,
} from "../src-agent/normalized-agent-event";
import {
  TranscriptBatcher,
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
const maxRawTranscriptBytes = 28_000;
const maxRawTranscriptPreviewBytes = 8_000;

function utf8Prefix(value: string, byteLimit: number): string {
  let bytes = 0;
  let output = "";
  for (const character of value) {
    const length = Buffer.byteLength(character, "utf8");
    if (bytes + length > byteLimit) break;
    output += character;
    bytes += length;
  }
  return output;
}

function boundedRawPayload(value: NonNullable<AgentTranscriptEvent["rawPayload"]>) {
  const json = JSON.stringify(toJson(ValueSchema, value));
  const originalBytes = Buffer.byteLength(json, "utf8");
  if (originalBytes <= maxRawTranscriptBytes) return value;
  return fromJson(ValueSchema, {
    type: "truncated",
    preview: utf8Prefix(json, maxRawTranscriptPreviewBytes),
    originalBytes,
  });
}

function boundedNormalizedEvent(
  value: NormalizedAgentEvent | undefined,
): NormalizedAgentEvent | undefined {
  const event = value?.event;
  switch (event?.case) {
    case "conversationStarted":
      return value;
    case "messageStarted":
    case "messageCompleted":
      return create(NormalizedAgentEventSchema, {
        event: {
          case: event.case,
          value: {
            id: event.value.id,
            phase: event.value.phase,
            text: normalizedActivityText(event.value.text),
          },
        },
      });
    case "messageDelta":
    case "activityDelta":
      return create(NormalizedAgentEventSchema, {
        event: {
          case: event.case,
          value: {
            id: event.value.id,
            delta: normalizedActivityText(event.value.delta),
          },
        },
      });
    case "activityStarted":
      return create(NormalizedAgentEventSchema, {
        event: {
          case: "activityStarted",
          value: {
            id: event.value.id,
            kind: event.value.kind,
            title: normalizedActivityTitle(event.value.title),
            text: normalizedActivityText(event.value.text),
          },
        },
      });
    case "activityCompleted":
      return create(NormalizedAgentEventSchema, {
        event: {
          case: "activityCompleted",
          value: {
            id: event.value.id,
            kind: event.value.kind,
            title: normalizedActivityTitle(event.value.title),
            text: normalizedActivityText(event.value.text),
            status: event.value.status,
          },
        },
      });
    case "turnCompleted":
      return value;
    case undefined:
      return undefined;
  }
}

/** Project a sidecar output into the generated Worker transcript contract once. */
export function transcriptEventFromSidecar(
  output: RunnerToParent,
  sequence: number | bigint,
): AgentTranscriptEvent {
  const payload = output.payload;
  if (payload.case === "event") {
    return create(AgentTranscriptEventSchema, {
      sequence: BigInt(sequence),
      direction: payload.value.direction,
      rawPayload: payload.value.raw
        ? boundedRawPayload(payload.value.raw)
        : undefined,
      normalized: boundedNormalizedEvent(payload.value.normalized),
    });
  }
  const rawPayload = fromJson(
    ValueSchema,
    toJson(RunnerToParentSchema, output),
  );
  return create(AgentTranscriptEventSchema, {
    sequence: BigInt(sequence),
    direction: AgentEventDirection.SERVER,
    rawPayload: boundedRawPayload(rawPayload),
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

export const appendTranscriptEventsRequest = (input: {
  projectId: string;
  work: TranscriptWork;
  sessionId: string;
  agentProvider: AgentProvider;
  events: AgentTranscriptEvent[];
}) => create(AppendTranscriptEventsRequestSchema, {
  projectId: input.projectId,
  work: workClaimIdentityToProto(input.work),
  sessionId: input.sessionId,
  agentProvider: agentProviderToProto(input.agentProvider),
  events: input.events,
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
  const request = (events: AgentTranscriptEvent[]) =>
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
