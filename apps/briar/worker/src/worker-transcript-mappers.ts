import { toJson } from "@bufbuild/protobuf";
import { timestampDate, ValueSchema } from "@bufbuild/protobuf/wkt";
import type {
  AgentTranscriptEvent,
  WorkClaimIdentity,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import {
  AgentActivityKind,
  AgentActivityStatus,
  AgentEventDirection,
  type NormalizedAgentEvent,
} from "@briar/contracts/gen/briar/types/v1/agent_event_pb";
import {
  AgentExecutionModelSource,
  type AgentExecutionMetrics as ProtoAgentExecutionMetrics,
  type AgentUsageObservation,
  type AgentCostObservation,
} from "@briar/contracts/gen/briar/types/v1/agent_execution_pb";
import { AgentProvider as ProtoAgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import {
  AgentExecutionMetrics,
  AgentExecutionUsageRecord,
  type AgentExecutionUsageRecord as DomainUsageRecord,
} from "../../src/lib/agent-execution-metrics";
import {
  AgentExecutionCostRecord,
  type AgentExecutionCostRecord as DomainCostRecord,
} from "../../src/lib/agent-execution-cost";
import type { AgentProvider } from "../../src/lib/agent-provider";
import { HttpError } from "./http-response";
import { decodeRequestSync } from "./request-schema";
import type { TranscriptEventInput } from "./workers";

export type TranscriptWorkIdentity = {
  readonly workId: string;
  readonly runId: string;
  readonly claimToken: string;
  readonly workType: "issue" | "issueReply" | "projectAgentTask";
};

const decodeMetrics = decodeRequestSync(AgentExecutionMetrics);
const decodeUsage = decodeRequestSync(AgentExecutionUsageRecord);
const decodeCost = decodeRequestSync(AgentExecutionCostRecord);

const requiredText = (value: string, field: string) => {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new HttpError(400, `${field} is required`);
  }
  return normalized;
};

const safeInteger = (value: bigint, field: string) => {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new HttpError(400, `${field} is outside the safe integer range`);
  }
  return Number(value);
};

const optionalSafeInteger = (value: bigint | undefined, field: string) =>
  value === undefined ? null : safeInteger(value, field);

const isoTimestamp = (
  value: Parameters<typeof timestampDate>[0] | undefined,
  field: string,
) => {
  if (!value) throw new HttpError(400, `${field} is required`);
  const date = timestampDate(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `${field} is invalid`);
  }
  return date.toISOString();
};

export const transcriptWorkIdentity = (
  value: WorkClaimIdentity | undefined,
): TranscriptWorkIdentity => {
  if (!value || value.work.case === undefined) {
    throw new HttpError(400, "Worker claim identity is required");
  }
  const workType = value.work.case;
  if (
    workType !== "issue" && workType !== "issueReply" &&
    workType !== "projectAgentTask"
  ) {
    throw new HttpError(400, "This work type cannot write a transcript");
  }
  return {
    workId: requiredText(value.workId, "work.work_id"),
    runId: requiredText(value.runId, "work.run_id"),
    claimToken: requiredText(value.claimToken, "work.claim_token"),
    workType,
  };
};

export const transcriptAgentProvider = (
  value: ProtoAgentProvider,
): AgentProvider => {
  switch (value) {
    case ProtoAgentProvider.CODEX:
      return "codex";
    case ProtoAgentProvider.CLAUDE:
      return "claude";
    case ProtoAgentProvider.CURSOR:
      return "cursor";
    case ProtoAgentProvider.GROK:
      return "grok";
    case ProtoAgentProvider.AGY:
      return "agy";
    case ProtoAgentProvider.OPENCODE:
      return "opencode";
    case ProtoAgentProvider.OPENROUTER:
      return "openrouter";
    case ProtoAgentProvider.VERTEX:
      return "vertex";
    case ProtoAgentProvider.PI:
      return "pi";
    default:
      throw new HttpError(400, "agent_provider is required");
  }
};

const activityKind = (value: AgentActivityKind) => {
  switch (value) {
    case AgentActivityKind.COMMAND:
      return "command" as const;
    case AgentActivityKind.FILE_CHANGE:
      return "fileChange" as const;
    case AgentActivityKind.WEB_SEARCH:
      return "webSearch" as const;
    case AgentActivityKind.TOOL:
      return "tool" as const;
    default:
      throw new HttpError(400, "normalized activity kind is required");
  }
};

const activityStatus = (value: AgentActivityStatus) => {
  switch (value) {
    case AgentActivityStatus.COMPLETED:
      return "completed" as const;
    case AgentActivityStatus.FAILED:
      return "failed" as const;
    case AgentActivityStatus.CANCELLED:
      return "cancelled" as const;
    default:
      throw new HttpError(400, "normalized activity status is required");
  }
};

const normalizedEvent = (value: NormalizedAgentEvent) => {
  const event = value.event;
  switch (event.case) {
    case "conversationStarted":
      return {
        type: "conversationStarted" as const,
        conversationId: requiredText(
          event.value.conversationId,
          "normalized.conversation_id",
        ),
      };
    case "messageStarted":
      return {
        type: "messageStarted" as const,
        id: requiredText(event.value.id, "normalized.message.id"),
        phase: event.value.phase,
        text: event.value.text,
      };
    case "messageDelta":
      return {
        type: "messageDelta" as const,
        id: requiredText(event.value.id, "normalized.message.id"),
        delta: event.value.delta,
      };
    case "messageCompleted":
      return {
        type: "messageCompleted" as const,
        id: requiredText(event.value.id, "normalized.message.id"),
        phase: event.value.phase,
        text: event.value.text,
      };
    case "activityStarted":
      return {
        type: "activityStarted" as const,
        id: requiredText(event.value.id, "normalized.activity.id"),
        kind: activityKind(event.value.kind),
        title: event.value.title,
        text: event.value.text,
      };
    case "activityDelta":
      return {
        type: "activityDelta" as const,
        id: requiredText(event.value.id, "normalized.activity.id"),
        delta: event.value.delta,
      };
    case "activityCompleted":
      return {
        type: "activityCompleted" as const,
        id: requiredText(event.value.id, "normalized.activity.id"),
        kind: activityKind(event.value.kind),
        title: event.value.title,
        text: event.value.text,
        status: activityStatus(event.value.status),
      };
    case "turnCompleted":
      return {
        type: "turnCompleted" as const,
        status: requiredText(event.value.status, "normalized.turn.status"),
      };
    default:
      throw new HttpError(400, "normalized event variant is required");
  }
};

const transcriptDirection = (value: AgentEventDirection) => {
  switch (value) {
    case AgentEventDirection.CLIENT:
      return "client" as const;
    case AgentEventDirection.SERVER:
      return "server" as const;
    default:
      throw new HttpError(400, "event direction is required");
  }
};

export const transcriptEvent = (
  value: AgentTranscriptEvent,
): TranscriptEventInput => {
  const sequence = safeInteger(value.sequence, "event.sequence");
  if (sequence < 1) {
    throw new HttpError(400, "event.sequence must start at 1");
  }
  const normalized = value.normalized
    ? normalizedEvent(value.normalized)
    : undefined;
  if (!value.rawPayload && !normalized) {
    throw new HttpError(
      400,
      "Each transcript event requires raw_payload or normalized",
    );
  }
  if (
    value.archiveCompaction &&
    normalized?.type !== "messageDelta" &&
    normalized?.type !== "activityDelta"
  ) {
    throw new HttpError(
      400,
      "archive_compaction is only valid for delta events",
    );
  }
  const firstSequence = value.archiveCompaction
    ? safeInteger(
      value.archiveCompaction.firstSequence,
      "event.archive_compaction.first_sequence",
    )
    : undefined;
  if (
    value.archiveCompaction &&
    (firstSequence === undefined || firstSequence < 1 ||
      firstSequence > sequence ||
      value.archiveCompaction.representedEventCount < 2)
  ) {
    throw new HttpError(400, "archive_compaction is invalid");
  }
  return {
    sequence,
    direction: transcriptDirection(value.direction),
    payload: {
      type: "event",
      ...(value.rawPayload
        ? { raw: toJson(ValueSchema, value.rawPayload) }
        : {}),
      ...(normalized ? { event: normalized } : {}),
      ...(value.archiveCompaction
        ? {
            archiveCompaction: {
              kind: "delta",
              firstSequence,
              representedEventCount:
                value.archiveCompaction.representedEventCount,
            },
          }
        : {}),
    },
  };
};

const modelSource = (value: AgentExecutionModelSource) => {
  switch (value) {
    case AgentExecutionModelSource.PROVIDER_REPORTED:
      return "providerReported" as const;
    case AgentExecutionModelSource.PROVIDER_CONFIG:
      return "providerConfig" as const;
    case AgentExecutionModelSource.CONFIGURED_FALLBACK:
      return "configuredFallback" as const;
    case AgentExecutionModelSource.UNKNOWN:
      return "unknown" as const;
    default:
      throw new HttpError(400, "observation model_source is required");
  }
};

export const executionMetrics = (value: ProtoAgentExecutionMetrics) =>
  decodeMetrics({
    inputTokens: optionalSafeInteger(value.inputTokens, "input_tokens"),
    outputTokens: optionalSafeInteger(value.outputTokens, "output_tokens"),
    cacheReadTokens: optionalSafeInteger(
      value.cacheReadTokens,
      "cache_read_tokens",
    ),
    cacheWriteTokens: optionalSafeInteger(
      value.cacheWriteTokens,
      "cache_write_tokens",
    ),
    reasoningOutputTokens: optionalSafeInteger(
      value.reasoningOutputTokens,
      "reasoning_output_tokens",
    ),
    totalTokens: optionalSafeInteger(value.totalTokens, "total_tokens"),
    durationMs: safeInteger(value.durationMs, "duration_ms"),
  });

export const usageObservation = (
  value: AgentUsageObservation,
): DomainUsageRecord => decodeUsage({
  usageKey: value.usageKey,
  sessionId: value.sessionId ?? null,
  scopeId: value.scopeId ?? null,
  turnId: value.turnId ?? null,
  agentProvider: transcriptAgentProvider(value.agentProvider),
  modelProvider: value.modelProvider ?? null,
  model: value.model ?? null,
  canonicalModel: value.canonicalModel ?? null,
  modelSource: modelSource(value.modelSource),
  source: value.source,
  uncachedInputTokens: optionalSafeInteger(
    value.uncachedInputTokens,
    "uncached_input_tokens",
  ),
  cacheReadTokens: optionalSafeInteger(
    value.cacheReadTokens,
    "cache_read_tokens",
  ),
  cacheWriteTokens: optionalSafeInteger(
    value.cacheWriteTokens,
    "cache_write_tokens",
  ),
  outputTokens: optionalSafeInteger(value.outputTokens, "output_tokens"),
  reasoningOutputTokens: optionalSafeInteger(
    value.reasoningOutputTokens,
    "reasoning_output_tokens",
  ),
  totalTokens: optionalSafeInteger(value.totalTokens, "total_tokens"),
  observedAt: isoTimestamp(value.observedAt, "usage.observed_at"),
});

export const costObservation = (
  value: AgentCostObservation,
): DomainCostRecord => decodeCost({
  costKey: value.costKey,
  usageKey: value.usageKey ?? null,
  sessionId: value.sessionId ?? null,
  scopeId: value.scopeId ?? null,
  turnId: value.turnId ?? null,
  agentProvider: transcriptAgentProvider(value.agentProvider),
  modelProvider: value.modelProvider ?? null,
  model: value.model ?? null,
  canonicalModel: value.canonicalModel ?? null,
  modelSource: modelSource(value.modelSource),
  source: value.source,
  amountUsdTicks: safeInteger(value.amountUsdTicks, "amount_usd_ticks"),
  observedAt: isoTimestamp(value.observedAt, "cost.observed_at"),
});
