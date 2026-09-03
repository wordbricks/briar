import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { RunStatus } from "@briar/contracts/gen/briar/app/v1/common_pb";
import {
  AgentExecutionCostEstimateModelSchema,
  AgentExecutionCostEstimateReason,
  AgentExecutionCostEstimateStatus,
  AgentUsageCostRecordSchema,
  AgentUsageEstimatedCostRecordSchema,
  AgentUsageExecutionAttemptSchema,
  AgentUsagePricingSchema,
  AgentUsagePricingStatus,
  AgentUsageRecordSchema,
  AgentUsageRunSchema,
  GetProjectUsageSummaryResponseSchema,
  GetRunCostEstimateResponseSchema,
  ListOrganizationUsageRunsResponseSchema,
  ListStatusTrayRunsResponseSchema,
  ProjectUsageBreakdownItemSchema,
  ProjectUsagePeriod,
  ProjectUsageTimelinePointSchema,
  StatusTrayRunSchema,
} from "@briar/contracts/gen/briar/app/v1/reporting_pb";
import {
  AgentExecutionMetricsSchema,
  AgentExecutionModelSource,
} from "@briar/contracts/gen/briar/types/v1/agent_execution_pb";
import type { AutoHuntRunStatus } from "../../src/lib/auto-hunt-contract";
import type { AgentExecutionMetrics } from "../../src/lib/agent-execution-metrics";
import type {
  AgentExecutionCostEstimate,
  AgentUsagePricing,
} from "../../src/lib/agent-usage-pricing";
import type { ProjectUsageSummary } from "../../src/lib/team-usage-summary";
import { appAgentProvider } from "./app-connect-mappers";
import type {
  listOrganizationUsageRunsApplication,
  listStatusTrayRunsApplication,
  organizationUsageRunReport,
} from "./reporting-application";

type OrganizationUsageRunReport = ReturnType<typeof organizationUsageRunReport>;
type OrganizationUsageRunsReport = Awaited<ReturnType<typeof listOrganizationUsageRunsApplication>>;
type StatusTrayRunsReport = Awaited<ReturnType<typeof listStatusTrayRunsApplication>>;

export const appReportingTimestamp = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid timestamp in ReportingService response");
  }
  return timestampFromDate(date);
};

const appUint32 = (value: number, field: string) => {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`Invalid uint32 ${field} in ReportingService response`);
  }
  return value;
};

const appUint64 = (value: number, field: string) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid uint64 ${field} in ReportingService response`);
  }
  return BigInt(value);
};

const appOptionalUint64 = (value: number | null, field: string) =>
  value === null ? undefined : appUint64(value, field);

const runStatus = {
  backlog: RunStatus.BACKLOG,
  queued: RunStatus.QUEUED,
  running: RunStatus.RUNNING,
  paused: RunStatus.PAUSED,
  blocked: RunStatus.BLOCKED,
  failed: RunStatus.FAILED,
  completed: RunStatus.COMPLETED,
  cancelled: RunStatus.CANCELLED,
} as const satisfies Record<AutoHuntRunStatus, RunStatus>;

const modelSource = {
  providerReported: AgentExecutionModelSource.PROVIDER_REPORTED,
  providerConfig: AgentExecutionModelSource.PROVIDER_CONFIG,
  configuredFallback: AgentExecutionModelSource.CONFIGURED_FALLBACK,
  unknown: AgentExecutionModelSource.UNKNOWN,
} as const satisfies Record<
  OrganizationUsageRunReport["usageRecords"][number]["modelSource"],
  AgentExecutionModelSource
>;

const pricingStatus = {
  live: AgentUsagePricingStatus.LIVE,
  cached: AgentUsagePricingStatus.CACHED,
  unavailable: AgentUsagePricingStatus.UNAVAILABLE,
} as const satisfies Record<AgentUsagePricing["status"], AgentUsagePricingStatus>;

export const appAgentUsagePricing = (pricing: AgentUsagePricing) =>
  create(AgentUsagePricingSchema, {
    status: pricingStatus[pricing.status],
    source: pricing.source,
    fetchedAt: pricing.fetchedAt ? appReportingTimestamp(pricing.fetchedAt) : undefined,
    knownModels: appUint32(pricing.knownModels, "pricing.knownModels"),
  });

const appExecutionMetrics = (metrics: AgentExecutionMetrics) =>
  create(AgentExecutionMetricsSchema, {
    inputTokens: appOptionalUint64(metrics.inputTokens, "metrics.inputTokens"),
    outputTokens: appOptionalUint64(metrics.outputTokens, "metrics.outputTokens"),
    cacheReadTokens: appOptionalUint64(metrics.cacheReadTokens, "metrics.cacheReadTokens"),
    cacheWriteTokens: appOptionalUint64(metrics.cacheWriteTokens, "metrics.cacheWriteTokens"),
    reasoningOutputTokens: appOptionalUint64(
      metrics.reasoningOutputTokens,
      "metrics.reasoningOutputTokens",
    ),
    totalTokens: appOptionalUint64(metrics.totalTokens, "metrics.totalTokens"),
    durationMs: appUint64(metrics.durationMs, "metrics.durationMs"),
  });

const appUsageExecutionAttempt = (
  attempt: OrganizationUsageRunReport["executionAttempts"][number],
) =>
  create(AgentUsageExecutionAttemptSchema, {
    executionId: attempt.executionId,
    projectId: attempt.projectId,
    runAttempt: appUint32(attempt.runAttempt, "attempt.runAttempt"),
    claimAttempt: appUint32(attempt.claimAttempt, "attempt.claimAttempt"),
    workerId: attempt.workerId ?? undefined,
    claimedBy: attempt.claimedBy ?? undefined,
    claimedAt: appReportingTimestamp(attempt.claimedAt),
    recordedAt: appReportingTimestamp(attempt.recordedAt),
  });

const appUsageRecord = (record: OrganizationUsageRunReport["usageRecords"][number]) =>
  create(AgentUsageRecordSchema, {
    executionId: record.executionId,
    projectId: record.projectId,
    runAttempt: appUint32(record.runAttempt, "usage.runAttempt"),
    claimAttempt: appUint32(record.claimAttempt, "usage.claimAttempt"),
    workerId: record.workerId ?? undefined,
    claimedAt: appReportingTimestamp(record.claimedAt),
    usageKey: record.usageKey,
    sessionId: record.sessionId ?? undefined,
    turnId: record.turnId ?? undefined,
    scopeId: record.scopeId ?? undefined,
    agentProvider: appAgentProvider[record.agentProvider],
    modelProvider: record.modelProvider ?? undefined,
    model: record.model ?? undefined,
    canonicalModel: record.canonicalModel ?? undefined,
    modelSource: modelSource[record.modelSource],
    source: record.source,
    uncachedInputTokens: appOptionalUint64(record.uncachedInputTokens, "usage.uncachedInputTokens"),
    cacheReadTokens: appOptionalUint64(record.cacheReadTokens, "usage.cacheReadTokens"),
    cacheWriteTokens: appOptionalUint64(record.cacheWriteTokens, "usage.cacheWriteTokens"),
    outputTokens: appOptionalUint64(record.outputTokens, "usage.outputTokens"),
    reasoningOutputTokens: appOptionalUint64(
      record.reasoningOutputTokens,
      "usage.reasoningOutputTokens",
    ),
    totalTokens: appOptionalUint64(record.totalTokens, "usage.totalTokens"),
    observedAt: appReportingTimestamp(record.observedAt),
    recordedAt: appReportingTimestamp(record.recordedAt),
  });

const appUsageCostRecord = (record: OrganizationUsageRunReport["costRecords"][number]) =>
  create(AgentUsageCostRecordSchema, {
    executionId: record.executionId,
    projectId: record.projectId,
    runAttempt: appUint32(record.runAttempt, "cost.runAttempt"),
    claimAttempt: appUint32(record.claimAttempt, "cost.claimAttempt"),
    workerId: record.workerId ?? undefined,
    claimedAt: appReportingTimestamp(record.claimedAt),
    costKey: record.costKey,
    usageKey: record.usageKey ?? undefined,
    sessionId: record.sessionId ?? undefined,
    turnId: record.turnId ?? undefined,
    scopeId: record.scopeId ?? undefined,
    agentProvider: appAgentProvider[record.agentProvider],
    modelProvider: record.modelProvider ?? undefined,
    model: record.model ?? undefined,
    canonicalModel: record.canonicalModel ?? undefined,
    modelSource: modelSource[record.modelSource],
    source: record.source,
    amountUsdTicks: appUint64(record.amountUsdTicks, "cost.amountUsdTicks"),
    observedAt: appReportingTimestamp(record.observedAt),
    recordedAt: appReportingTimestamp(record.recordedAt),
  });

const appUsageEstimatedCostRecord = (
  record: OrganizationUsageRunReport["estimatedCostRecords"][number],
) =>
  create(AgentUsageEstimatedCostRecordSchema, {
    executionId: record.executionId,
    projectId: record.projectId,
    runAttempt: appUint32(record.runAttempt, "estimatedCost.runAttempt"),
    claimAttempt: appUint32(record.claimAttempt, "estimatedCost.claimAttempt"),
    workerId: record.workerId ?? undefined,
    claimedAt: appReportingTimestamp(record.claimedAt),
    usageKey: record.usageKey,
    sessionId: record.sessionId ?? undefined,
    turnId: record.turnId ?? undefined,
    scopeId: record.scopeId ?? undefined,
    agentProvider: appAgentProvider[record.agentProvider],
    modelProvider: record.modelProvider ?? undefined,
    model: record.model ?? undefined,
    canonicalModel: record.canonicalModel ?? undefined,
    modelSource: modelSource[record.modelSource],
    observedAt: appReportingTimestamp(record.observedAt),
    usageSource: record.usageSource,
    pricingKey: record.pricingKey,
    amountUsdTicks: appUint64(record.amountUsdTicks, "estimatedCost.amountUsdTicks"),
  });

const appOrganizationUsageRun = (run: OrganizationUsageRunReport) =>
  create(AgentUsageRunSchema, {
    id: run.id,
    projectId: run.projectId,
    status: runStatus[run.status],
    executionMetrics: run.executionMetrics ? appExecutionMetrics(run.executionMetrics) : undefined,
    claimedBy: run.claimedBy ?? undefined,
    claimedAt: run.claimedAt ? appReportingTimestamp(run.claimedAt) : undefined,
    claimAttempts: appUint32(run.claimAttempts, "run.claimAttempts"),
    workerId: run.workerId ?? undefined,
    preferredProvider: run.preferredProvider ? appAgentProvider[run.preferredProvider] : undefined,
    preferredModel: run.preferredModel ?? undefined,
    requestedProvider: run.requestedProvider ? appAgentProvider[run.requestedProvider] : undefined,
    requestedModel: run.requestedModel ?? undefined,
    executionProvider: run.executionProvider ? appAgentProvider[run.executionProvider] : undefined,
    executionModel: run.executionModel ?? undefined,
    startedAt: appReportingTimestamp(run.startedAt),
    updatedAt: appReportingTimestamp(run.updatedAt),
    completedAt: run.completedAt ? appReportingTimestamp(run.completedAt) : undefined,
    executionAttempts: run.executionAttempts.map(appUsageExecutionAttempt),
    usageRecords: run.usageRecords.map(appUsageRecord),
    costRecords: run.costRecords.map(appUsageCostRecord),
    estimatedCostRecords: run.estimatedCostRecords.map(appUsageEstimatedCostRecord),
  });

export const appOrganizationUsageRuns = (report: OrganizationUsageRunsReport) =>
  create(ListOrganizationUsageRunsResponseSchema, {
    runs: report.runs.map(appOrganizationUsageRun),
    generatedAt: appReportingTimestamp(report.generatedAt),
    pricing: appAgentUsagePricing(report.pricing),
  });

const projectUsagePeriod = {
  day: ProjectUsagePeriod.DAY,
  week: ProjectUsagePeriod.WEEK,
  month: ProjectUsagePeriod.MONTH,
} as const satisfies Record<ProjectUsageSummary["period"], ProjectUsagePeriod>;

export const appProjectUsageSummary = (summary: ProjectUsageSummary) =>
  create(GetProjectUsageSummaryResponseSchema, {
    period: projectUsagePeriod[summary.period],
    rangeStart: appReportingTimestamp(summary.rangeStart),
    rangeEnd: appReportingTimestamp(summary.rangeEnd),
    totalTokens: appUint64(summary.totalTokens, "summary.totalTokens"),
    trackedDurationMs: appUint64(summary.trackedDurationMs, "summary.trackedDurationMs"),
    observedRuns: appUint32(summary.observedRuns, "summary.observedRuns"),
    reportedRuns: appUint32(summary.reportedRuns, "summary.reportedRuns"),
    completedIssues: appUint32(summary.completedIssues, "summary.completedIssues"),
    timeline: summary.timeline.map((point) =>
      create(ProjectUsageTimelinePointSchema, {
        startAt: appReportingTimestamp(point.startAt),
        completedIssues: appUint32(point.completedIssues, "summary.timeline.completedIssues"),
        totalTokens: appUint64(point.totalTokens, "summary.timeline.totalTokens"),
      }),
    ),
    issueCreators: summary.issueCreators.map((item) =>
      create(ProjectUsageBreakdownItemSchema, {
        id: item.id ?? undefined,
        name: item.name ?? undefined,
        issues: appUint32(item.issues, "summary.issueCreators.issues"),
      }),
    ),
    agents: summary.agents.map((item) =>
      create(ProjectUsageBreakdownItemSchema, {
        id: item.id ?? undefined,
        name: item.name ?? undefined,
        issues: appUint32(item.issues, "summary.agents.issues"),
      }),
    ),
    generatedAt: appReportingTimestamp(summary.generatedAt),
  });

export const appStatusTrayRuns = (report: StatusTrayRunsReport) =>
  create(ListStatusTrayRunsResponseSchema, {
    runs: report.runs.map((run) =>
      create(StatusTrayRunSchema, {
        projectId: run.projectId,
        projectName: run.projectName,
        id: run.id,
        title: run.title,
        status: runStatus[run.status],
        workflowStage: run.workflowStage ?? undefined,
        workflowStageLabel: run.workflowStageLabel ?? undefined,
        startedAt: appReportingTimestamp(run.startedAt),
        updatedAt: appReportingTimestamp(run.updatedAt),
        lastEventAt: appReportingTimestamp(run.lastEventAt),
      }),
    ),
    generatedAt: appReportingTimestamp(report.generatedAt),
  });

const costEstimateStatus = {
  estimated: AgentExecutionCostEstimateStatus.ESTIMATED,
  partial: AgentExecutionCostEstimateStatus.PARTIAL,
  unavailable: AgentExecutionCostEstimateStatus.UNAVAILABLE,
} as const satisfies Record<AgentExecutionCostEstimate["status"], AgentExecutionCostEstimateStatus>;

const costEstimateReason = {
  pricingUnavailable: AgentExecutionCostEstimateReason.PRICING_UNAVAILABLE,
  usageUnavailable: AgentExecutionCostEstimateReason.USAGE_UNAVAILABLE,
  modelRateUnavailable: AgentExecutionCostEstimateReason.MODEL_RATE_UNAVAILABLE,
  tokenBreakdownUnavailable: AgentExecutionCostEstimateReason.TOKEN_BREAKDOWN_UNAVAILABLE,
} as const satisfies Record<
  NonNullable<AgentExecutionCostEstimate["reason"]>,
  AgentExecutionCostEstimateReason
>;

const appFiniteNonnegative = (value: number, field: string) => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid number ${field} in ReportingService response`);
  }
  return value;
};

export const appRunCostEstimate = (estimate: AgentExecutionCostEstimate) =>
  create(GetRunCostEstimateResponseSchema, {
    pricing: appAgentUsagePricing(estimate.pricing),
    status: costEstimateStatus[estimate.status],
    reason: estimate.reason === null ? undefined : costEstimateReason[estimate.reason],
    usageRecords: appUint32(estimate.usageRecords, "estimate.usageRecords"),
    pricedUsageRecords: appUint32(estimate.pricedUsageRecords, "estimate.pricedUsageRecords"),
    providerReportedModels: estimate.providerReportedModels,
    estimatedUsdTicks:
      estimate.estimatedUsdTicks === null
        ? undefined
        : appUint64(estimate.estimatedUsdTicks, "estimate.estimatedUsdTicks"),
    pricedUsdTicks: appUint64(estimate.pricedUsdTicks, "estimate.pricedUsdTicks"),
    models: estimate.models.map((model) =>
      create(AgentExecutionCostEstimateModelSchema, {
        pricingKey: model.pricingKey,
        modelProvider: model.modelProvider ?? undefined,
        model: model.model,
        inputCostPerToken: appFiniteNonnegative(
          model.inputCostPerToken,
          "estimate.models.inputCostPerToken",
        ),
        outputCostPerToken: appFiniteNonnegative(
          model.outputCostPerToken,
          "estimate.models.outputCostPerToken",
        ),
        cacheReadCostPerToken: appFiniteNonnegative(
          model.cacheReadCostPerToken,
          "estimate.models.cacheReadCostPerToken",
        ),
        cacheWriteCostPerToken: appFiniteNonnegative(
          model.cacheWriteCostPerToken,
          "estimate.models.cacheWriteCostPerToken",
        ),
        estimatedUsdTicks: appUint64(model.estimatedUsdTicks, "estimate.models.estimatedUsdTicks"),
      }),
    ),
  });
