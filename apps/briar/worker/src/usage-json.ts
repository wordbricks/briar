import {
  summarizeProjectUsage,
  type ProjectUsageDateRange,
  type ProjectUsagePeriod,
} from "../../src/lib/project-usage-summary";
import type {
  OrganizationCostRecordRow,
  OrganizationUsageRecordRow,
  OrganizationUsageRunRow,
  ProjectUsageTotalRow,
  RunExecutionAttemptRow,
} from "./db";
import { parseExecutionMetrics } from "./agent-result-json";
import { estimateOrganizationUsageCosts } from "./usage-pricing";

const usageRangeFetchPaddingDays = 1;

export const organizationUsageQuerySince = (
  days: 7 | 30 | 90,
  now: number = Date.now(),
) =>
  new Date(
    now - (days + usageRangeFetchPaddingDays) * 24 * 60 * 60_000,
  ).toISOString();

const parseUsageExecutionMetrics = (value: string | null) => {
  try {
    return parseExecutionMetrics(value);
  } catch {
    return null;
  }
};

const usageExecutionAttemptJson = (attempt: RunExecutionAttemptRow) => ({
  executionId: attempt.id,
  projectId: attempt.project_id,
  runAttempt: attempt.run_attempt,
  claimAttempt: attempt.claim_attempt,
  workerId: attempt.worker_id,
  claimedBy: attempt.claimed_by,
  claimedAt: attempt.claimed_at,
  recordedAt: attempt.recorded_at,
});

const organizationUsageRecordJson = (record: OrganizationUsageRecordRow) => ({
  executionId: record.execution_id,
  projectId: record.project_id,
  runAttempt: record.run_attempt,
  claimAttempt: record.claim_attempt,
  workerId: record.worker_id,
  claimedAt: record.claimed_at,
  usageKey: record.usage_key,
  sessionId: record.session_id,
  scopeId: record.scope_id,
  turnId: record.turn_id,
  agentProvider: record.agent_provider,
  modelProvider: record.model_provider,
  model: record.model,
  canonicalModel: record.canonical_model,
  modelSource: record.model_source,
  source: record.source,
  uncachedInputTokens: record.uncached_input_tokens,
  cacheReadTokens: record.cache_read_tokens,
  cacheWriteTokens: record.cache_write_tokens,
  outputTokens: record.output_tokens,
  reasoningOutputTokens: record.reasoning_output_tokens,
  totalTokens: record.total_tokens,
  observedAt: record.observed_at,
  recordedAt: record.recorded_at,
});

const organizationCostRecordJson = (record: OrganizationCostRecordRow) => ({
  executionId: record.execution_id,
  projectId: record.project_id,
  runAttempt: record.run_attempt,
  claimAttempt: record.claim_attempt,
  workerId: record.worker_id,
  claimedAt: record.claimed_at,
  costKey: record.cost_key,
  usageKey: record.usage_key,
  sessionId: record.session_id,
  scopeId: record.scope_id,
  turnId: record.turn_id,
  agentProvider: record.agent_provider,
  modelProvider: record.model_provider,
  model: record.model,
  canonicalModel: record.canonical_model,
  modelSource: record.model_source,
  source: record.source,
  costSource: "providerReported" as const,
  amountUsdTicks: record.amount_usd_ticks,
  observedAt: record.observed_at,
  recordedAt: record.recorded_at,
});

export const organizationUsageRunJson = (
  run: OrganizationUsageRunRow,
  ledger: {
    attempts?: RunExecutionAttemptRow[];
    records?: OrganizationUsageRecordRow[];
    costRecords?: OrganizationCostRecordRow[];
    estimatedCostRecords?: ReturnType<typeof estimateOrganizationUsageCosts>;
  } = {},
) => ({
  id: run.id,
  projectId: run.project_id,
  status: run.paused_at ? ("paused" as const) : run.status,
  executionMetrics: parseUsageExecutionMetrics(run.execution_metrics_json),
  claimedBy: run.claimed_by,
  claimedAt: run.claimed_at,
  claimAttempts: run.claim_attempts,
  workerId: run.worker_id,
  preferredProvider: run.preferred_agent_provider,
  preferredModel: run.preferred_agent_model,
  requestedProvider: run.requested_agent_provider,
  requestedModel: run.requested_agent_model,
  executionProvider: run.execution_provider,
  executionModel: run.execution_model,
  startedAt: run.started_at,
  updatedAt: run.updated_at,
  completedAt: run.completed_at,
  executionAttempts: (ledger.attempts ?? []).map(usageExecutionAttemptJson),
  usageRecords: (ledger.records ?? []).map(organizationUsageRecordJson),
  costRecords: (ledger.costRecords ?? []).map(organizationCostRecordJson),
  estimatedCostRecords: ledger.estimatedCostRecords ?? [],
});

export function projectUsageSummaryJson(
  runs: readonly OrganizationUsageRunRow[],
  totals: readonly ProjectUsageTotalRow[],
  period: ProjectUsagePeriod,
  generatedAt: number,
  range?: ProjectUsageDateRange,
) {
  const totalsByRun = new Map<string, ProjectUsageTotalRow[]>();
  for (const total of totals) {
    const entries = totalsByRun.get(total.run_id) ?? [];
    entries.push(total);
    totalsByRun.set(total.run_id, entries);
  }
  return summarizeProjectUsage(
    runs.map((run) => {
      const runTotals = totalsByRun.get(run.id) ?? [];
      return {
        ...organizationUsageRunJson(run),
        sourceCreatedAt: run.source_created_at,
        createdByUserId: run.created_by_user_id,
        createdByName: run.created_by_name,
        agentId: run.agent_id,
        agentName: run.agent_name,
        hasUsageLedger: Boolean(run.has_usage_ledger),
        usageRecords: runTotals.map((total) => ({
              uncachedInputTokens: null,
              cacheReadTokens: null,
              cacheWriteTokens: null,
              outputTokens: null,
              totalTokens: total.total_tokens,
              observedAt: total.observed_at,
            })),
      };
    }),
    period,
    generatedAt,
    range,
  );
}
