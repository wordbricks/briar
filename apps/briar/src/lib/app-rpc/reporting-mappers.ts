import {
  AgentExecutionCostEstimateReason,
  AgentExecutionCostEstimateStatus,
  AgentUsagePricingStatus,
  OrganizationUsageRange,
  ProjectUsagePeriod as ProtoProjectUsagePeriod,
  type AgentExecutionCostEstimateModel as AgentExecutionCostEstimateModelMessage,
  type AgentUsageCostRecord as AgentUsageCostRecordMessage,
  type AgentUsageEstimatedCostRecord as AgentUsageEstimatedCostRecordMessage,
  type AgentUsageExecutionAttempt as AgentUsageExecutionAttemptMessage,
  type AgentUsagePricing as AgentUsagePricingMessage,
  type AgentUsageRecord as AgentUsageRecordMessage,
  type AgentUsageRun as AgentUsageRunMessage,
  type GetProjectUsageSummaryResponse,
  type GetRunCostEstimateResponse,
  type ListOrganizationUsageRunsResponse,
  type ListStatusTrayRunsResponse,
} from "@briar/contracts/gen/briar/app/v1/reporting_pb";
import { AgentExecutionModelSource } from "@briar/contracts/gen/briar/types/v1/agent_execution_pb";
import type { UsageRangeDays } from "../agent-usage-overview";
import type {
  AgentExecutionCostEstimate,
  AgentExecutionCostEstimateModel,
  AgentUsagePricing,
} from "../agent-usage-pricing";
import type {
  TeamUsagePeriod,
  TeamUsageSummary,
} from "../team-usage-summary";
import type {
  AgentUsageReport,
  AgentUsageRun,
  StatusTrayRunsPayload,
} from "../../types";
import {
  agentExecutionMetricsFromProto,
  agentProviderFromProto,
  optionalAgentProviderFromProto,
  optionalSafeNumber,
  optionalTimestamp,
  requiredMessage,
  requiredTimestamp,
  runStatusFromProto,
  safeNumber,
} from "./mappers";

export const organizationUsageRangeToProto = (
  days: UsageRangeDays,
): OrganizationUsageRange => {
  switch (days) {
    case 7:
      return OrganizationUsageRange.ORGANIZATION_USAGE_RANGE_7_DAYS;
    case 30:
      return OrganizationUsageRange.ORGANIZATION_USAGE_RANGE_30_DAYS;
    case 90:
      return OrganizationUsageRange.ORGANIZATION_USAGE_RANGE_90_DAYS;
  }
};

export const projectUsagePeriodToProto = (
  period: TeamUsagePeriod,
): ProtoProjectUsagePeriod => {
  switch (period) {
    case "day":
      return ProtoProjectUsagePeriod.DAY;
    case "week":
      return ProtoProjectUsagePeriod.WEEK;
    case "month":
      return ProtoProjectUsagePeriod.MONTH;
  }
};

const projectUsagePeriodFromProto = (
  period: ProtoProjectUsagePeriod,
): TeamUsagePeriod => {
  switch (period) {
    case ProtoProjectUsagePeriod.DAY:
      return "day";
    case ProtoProjectUsagePeriod.WEEK:
      return "week";
    case ProtoProjectUsagePeriod.MONTH:
      return "month";
    case ProtoProjectUsagePeriod.UNSPECIFIED:
      throw new Error("Project usage period is missing");
    default:
      throw new Error(`Unknown project usage period: ${period}`);
  }
};

const modelSourceFromProto = (
  source: AgentExecutionModelSource,
): "providerReported" | "providerConfig" | "configuredFallback" | "unknown" => {
  switch (source) {
    case AgentExecutionModelSource.PROVIDER_REPORTED:
      return "providerReported";
    case AgentExecutionModelSource.PROVIDER_CONFIG:
      return "providerConfig";
    case AgentExecutionModelSource.CONFIGURED_FALLBACK:
      return "configuredFallback";
    case AgentExecutionModelSource.UNKNOWN:
      return "unknown";
    case AgentExecutionModelSource.UNSPECIFIED:
      throw new Error("Agent execution model source is missing");
    default:
      throw new Error(`Unknown agent execution model source: ${source}`);
  }
};

const pricingStatusFromProto = (
  status: AgentUsagePricingStatus,
): AgentUsagePricing["status"] => {
  switch (status) {
    case AgentUsagePricingStatus.LIVE:
      return "live";
    case AgentUsagePricingStatus.CACHED:
      return "cached";
    case AgentUsagePricingStatus.UNAVAILABLE:
      return "unavailable";
    case AgentUsagePricingStatus.UNSPECIFIED:
      throw new Error("Agent usage pricing status is missing");
    default:
      throw new Error(`Unknown agent usage pricing status: ${status}`);
  }
};

const agentUsagePricingFromProto = (
  pricing: AgentUsagePricingMessage | undefined,
): AgentUsagePricing => {
  const value = requiredMessage(pricing, "reporting.pricing");
  return {
    status: pricingStatusFromProto(value.status),
    source: value.source,
    fetchedAt: optionalTimestamp(value.fetchedAt),
    knownModels: value.knownModels,
  };
};

const executionAttemptFromProto = (
  attempt: AgentUsageExecutionAttemptMessage,
) => ({
  executionId: attempt.executionId,
  teamId: attempt.projectId,
  runAttempt: attempt.runAttempt,
  claimAttempt: attempt.claimAttempt,
  workerId: attempt.workerId ?? null,
  claimedBy: attempt.claimedBy ?? null,
  claimedAt: requiredTimestamp(
    attempt.claimedAt,
    "usageExecutionAttempt.claimedAt",
  ),
  recordedAt: requiredTimestamp(
    attempt.recordedAt,
    "usageExecutionAttempt.recordedAt",
  ),
});

const usageRecordFromProto = (record: AgentUsageRecordMessage) => ({
  executionId: record.executionId,
  teamId: record.projectId,
  runAttempt: record.runAttempt,
  claimAttempt: record.claimAttempt,
  workerId: record.workerId ?? null,
  claimedAt: requiredTimestamp(record.claimedAt, "usageRecord.claimedAt"),
  usageKey: record.usageKey,
  sessionId: record.sessionId ?? null,
  scopeId: record.scopeId ?? null,
  turnId: record.turnId ?? null,
  agentProvider: agentProviderFromProto(record.agentProvider),
  modelProvider: record.modelProvider ?? null,
  model: record.model ?? null,
  canonicalModel: record.canonicalModel ?? null,
  modelSource: modelSourceFromProto(record.modelSource),
  source: record.source,
  uncachedInputTokens: optionalSafeNumber(
    record.uncachedInputTokens,
    "usageRecord.uncachedInputTokens",
  ),
  cacheReadTokens: optionalSafeNumber(
    record.cacheReadTokens,
    "usageRecord.cacheReadTokens",
  ),
  cacheWriteTokens: optionalSafeNumber(
    record.cacheWriteTokens,
    "usageRecord.cacheWriteTokens",
  ),
  outputTokens: optionalSafeNumber(
    record.outputTokens,
    "usageRecord.outputTokens",
  ),
  reasoningOutputTokens: optionalSafeNumber(
    record.reasoningOutputTokens,
    "usageRecord.reasoningOutputTokens",
  ),
  totalTokens: optionalSafeNumber(
    record.totalTokens,
    "usageRecord.totalTokens",
  ),
  observedAt: requiredTimestamp(record.observedAt, "usageRecord.observedAt"),
  recordedAt: requiredTimestamp(record.recordedAt, "usageRecord.recordedAt"),
});

const costRecordFromProto = (record: AgentUsageCostRecordMessage) => ({
  executionId: record.executionId,
  teamId: record.projectId,
  runAttempt: record.runAttempt,
  claimAttempt: record.claimAttempt,
  workerId: record.workerId ?? null,
  claimedAt: requiredTimestamp(record.claimedAt, "costRecord.claimedAt"),
  costKey: record.costKey,
  usageKey: record.usageKey ?? null,
  sessionId: record.sessionId ?? null,
  scopeId: record.scopeId ?? null,
  turnId: record.turnId ?? null,
  agentProvider: agentProviderFromProto(record.agentProvider),
  modelProvider: record.modelProvider ?? null,
  model: record.model ?? null,
  canonicalModel: record.canonicalModel ?? null,
  modelSource: modelSourceFromProto(record.modelSource),
  source: record.source,
  costSource: "providerReported" as const,
  amountUsdTicks: safeNumber(
    record.amountUsdTicks,
    "costRecord.amountUsdTicks",
  ),
  observedAt: requiredTimestamp(record.observedAt, "costRecord.observedAt"),
  recordedAt: requiredTimestamp(record.recordedAt, "costRecord.recordedAt"),
});

const estimatedCostRecordFromProto = (
  record: AgentUsageEstimatedCostRecordMessage,
) => ({
  executionId: record.executionId,
  teamId: record.projectId,
  runAttempt: record.runAttempt,
  claimAttempt: record.claimAttempt,
  workerId: record.workerId ?? null,
  claimedAt: requiredTimestamp(
    record.claimedAt,
    "estimatedCostRecord.claimedAt",
  ),
  usageKey: record.usageKey,
  sessionId: record.sessionId ?? null,
  scopeId: record.scopeId ?? null,
  turnId: record.turnId ?? null,
  agentProvider: agentProviderFromProto(record.agentProvider),
  modelProvider: record.modelProvider ?? null,
  model: record.model ?? null,
  canonicalModel: record.canonicalModel ?? null,
  modelSource: modelSourceFromProto(record.modelSource),
  observedAt: requiredTimestamp(
    record.observedAt,
    "estimatedCostRecord.observedAt",
  ),
  usageSource: record.usageSource,
  pricingKey: record.pricingKey,
  amountUsdTicks: safeNumber(
    record.amountUsdTicks,
    "estimatedCostRecord.amountUsdTicks",
  ),
  costSource: "modelPriced" as const,
});

const usageRunFromProto = (run: AgentUsageRunMessage): AgentUsageRun => ({
  id: run.id,
  teamId: run.projectId,
  status: runStatusFromProto(run.status),
  executionMetrics: agentExecutionMetricsFromProto(run.executionMetrics),
  claimedBy: run.claimedBy ?? null,
  claimedAt: optionalTimestamp(run.claimedAt),
  claimAttempts: run.claimAttempts,
  workerId: run.workerId ?? null,
  preferredProvider: optionalAgentProviderFromProto(run.preferredProvider),
  preferredModel: run.preferredModel ?? null,
  requestedProvider: optionalAgentProviderFromProto(run.requestedProvider),
  requestedModel: run.requestedModel ?? null,
  executionProvider: optionalAgentProviderFromProto(run.executionProvider),
  executionModel: run.executionModel ?? null,
  startedAt: requiredTimestamp(run.startedAt, "usageRun.startedAt"),
  updatedAt: requiredTimestamp(run.updatedAt, "usageRun.updatedAt"),
  completedAt: optionalTimestamp(run.completedAt),
  executionAttempts: run.executionAttempts.map(executionAttemptFromProto),
  usageRecords: run.usageRecords.map(usageRecordFromProto),
  costRecords: run.costRecords.map(costRecordFromProto),
  estimatedCostRecords: run.estimatedCostRecords.map(
    estimatedCostRecordFromProto,
  ),
});

export const organizationUsageReportFromProto = (
  response: ListOrganizationUsageRunsResponse,
): AgentUsageReport => ({
  runs: response.runs.map(usageRunFromProto),
  generatedAt: requiredTimestamp(
    response.generatedAt,
    "organizationUsageReport.generatedAt",
  ),
  pricing: agentUsagePricingFromProto(response.pricing),
});

export const projectUsageSummaryFromProto = (
  response: GetProjectUsageSummaryResponse,
): TeamUsageSummary => ({
  period: projectUsagePeriodFromProto(response.period),
  rangeStart: requiredTimestamp(
    response.rangeStart,
    "projectUsageSummary.rangeStart",
  ),
  rangeEnd: requiredTimestamp(
    response.rangeEnd,
    "projectUsageSummary.rangeEnd",
  ),
  totalTokens: safeNumber(response.totalTokens, "projectUsageSummary.totalTokens"),
  trackedDurationMs: safeNumber(
    response.trackedDurationMs,
    "projectUsageSummary.trackedDurationMs",
  ),
  observedRuns: response.observedRuns,
  reportedRuns: response.reportedRuns,
  completedIssues: response.completedIssues,
  timeline: response.timeline.map((point) => ({
    startAt: requiredTimestamp(point.startAt, "projectUsageTimeline.startAt"),
    completedIssues: point.completedIssues,
    totalTokens: safeNumber(point.totalTokens, "projectUsageTimeline.totalTokens"),
  })),
  issueCreators: response.issueCreators.map((item) => ({
    id: item.id ?? null,
    name: item.name ?? null,
    issues: item.issues,
  })),
  agents: response.agents.map((item) => ({
    id: item.id ?? null,
    name: item.name ?? null,
    issues: item.issues,
  })),
  generatedAt: requiredTimestamp(
    response.generatedAt,
    "projectUsageSummary.generatedAt",
  ),
});

export const statusTrayRunsFromProto = (
  response: ListStatusTrayRunsResponse,
): StatusTrayRunsPayload => ({
  runs: response.runs.map((run) => {
    const status = runStatusFromProto(run.status);
    if (status !== "running") {
      throw new Error(`Status tray run must be running, received: ${status}`);
    }
    return {
      teamId: run.projectId,
      teamName: run.projectName,
      id: run.id,
      title: run.title,
      status,
      workflowStage: run.workflowStage ?? null,
      workflowStageLabel: run.workflowStageLabel ?? null,
      startedAt: requiredTimestamp(run.startedAt, "statusTrayRun.startedAt"),
      updatedAt: requiredTimestamp(run.updatedAt, "statusTrayRun.updatedAt"),
      lastEventAt: requiredTimestamp(
        run.lastEventAt,
        "statusTrayRun.lastEventAt",
      ),
    };
  }),
  generatedAt: requiredTimestamp(
    response.generatedAt,
    "statusTrayRuns.generatedAt",
  ),
});

const costEstimateStatusFromProto = (
  status: AgentExecutionCostEstimateStatus,
): AgentExecutionCostEstimate["status"] => {
  switch (status) {
    case AgentExecutionCostEstimateStatus.ESTIMATED:
      return "estimated";
    case AgentExecutionCostEstimateStatus.PARTIAL:
      return "partial";
    case AgentExecutionCostEstimateStatus.UNAVAILABLE:
      return "unavailable";
    case AgentExecutionCostEstimateStatus.UNSPECIFIED:
      throw new Error("Agent execution cost estimate status is missing");
    default:
      throw new Error(`Unknown cost estimate status: ${status}`);
  }
};

const costEstimateReasonFromProto = (
  reason: AgentExecutionCostEstimateReason | undefined,
): AgentExecutionCostEstimate["reason"] => {
  switch (reason) {
    case undefined:
      return null;
    case AgentExecutionCostEstimateReason.PRICING_UNAVAILABLE:
      return "pricingUnavailable";
    case AgentExecutionCostEstimateReason.USAGE_UNAVAILABLE:
      return "usageUnavailable";
    case AgentExecutionCostEstimateReason.MODEL_RATE_UNAVAILABLE:
      return "modelRateUnavailable";
    case AgentExecutionCostEstimateReason.TOKEN_BREAKDOWN_UNAVAILABLE:
      return "tokenBreakdownUnavailable";
    case AgentExecutionCostEstimateReason.UNSPECIFIED:
      throw new Error("Agent execution cost estimate reason is missing");
    default:
      throw new Error(`Unknown cost estimate reason: ${reason}`);
  }
};

const costEstimateModelFromProto = (
  model: AgentExecutionCostEstimateModelMessage,
): AgentExecutionCostEstimateModel => ({
  pricingKey: model.pricingKey,
  modelProvider: model.modelProvider ?? null,
  model: model.model,
  inputCostPerToken: model.inputCostPerToken,
  outputCostPerToken: model.outputCostPerToken,
  cacheReadCostPerToken: model.cacheReadCostPerToken,
  cacheWriteCostPerToken: model.cacheWriteCostPerToken,
  estimatedUsdTicks: safeNumber(
    model.estimatedUsdTicks,
    "costEstimateModel.estimatedUsdTicks",
  ),
});

export const runCostEstimateFromProto = (
  response: GetRunCostEstimateResponse,
): AgentExecutionCostEstimate => ({
  pricing: agentUsagePricingFromProto(response.pricing),
  status: costEstimateStatusFromProto(response.status),
  reason: costEstimateReasonFromProto(response.reason),
  usageRecords: response.usageRecords,
  pricedUsageRecords: response.pricedUsageRecords,
  providerReportedModels: response.providerReportedModels,
  estimatedUsdTicks: optionalSafeNumber(
    response.estimatedUsdTicks,
    "runCostEstimate.estimatedUsdTicks",
  ),
  pricedUsdTicks: safeNumber(
    response.pricedUsdTicks,
    "runCostEstimate.pricedUsdTicks",
  ),
  models: response.models.map(costEstimateModelFromProto),
});
