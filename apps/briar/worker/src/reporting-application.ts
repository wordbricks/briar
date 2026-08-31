import {
  isProjectUsageDateRange,
  projectUsageSummaryWindow,
  summarizeProjectUsage,
  type ProjectUsageDateRange,
  type ProjectUsagePeriod,
} from "../../src/lib/project-usage-summary";
import { normalizeAutoHuntWorkflow } from "../../src/lib/auto-hunt-contract";
import { parseExecutionMetrics } from "./agent-result-json";
import {
  getHuntRunForProject,
  getProject,
  listOrganizationStatusTrayRuns,
  listOrganizationUsageCostRecords,
  listOrganizationUsageExecutionAttempts,
  listOrganizationUsageRecords,
  listOrganizationUsageRuns,
  listProjectUsageRuns,
  listProjectUsageTotals,
  listRunUsageRecords,
  type OrganizationCostRecordRow,
  type OrganizationUsageRecordRow,
  type OrganizationUsageRunRow,
  type ProjectUsageTotalRow,
  type RunExecutionAttemptRow,
} from "./db";
import { hasOrganizationCapability } from "./organization-access";
import { getOrganizationRole } from "./organization-repository";
import {
  estimateOrganizationUsageCosts,
  estimateRunExecutionCost,
  loadAgentUsagePricing,
} from "./usage-pricing";

export type ReportingApplicationErrorReason =
  | "organization_not_found"
  | "project_not_found"
  | "run_not_found"
  | "invalid_usage_range";

export class ReportingApplicationError extends Error {
  readonly name = "ReportingApplicationError";

  constructor(
    readonly reason: ReportingApplicationErrorReason,
    message: string,
  ) {
    super(message);
  }
}

export type ReportingApplicationServices = {
  readonly loadPricing: typeof loadAgentUsagePricing;
};

export const reportingApplicationServices: ReportingApplicationServices = {
  loadPricing: loadAgentUsagePricing,
};

const usageRangeFetchPaddingDays = 1;

export const organizationUsageQuerySince = (days: 7 | 30 | 90, now: number = Date.now()) =>
  new Date(now - (days + usageRangeFetchPaddingDays) * 24 * 60 * 60_000).toISOString();

const usageExecutionAttemptReport = (attempt: RunExecutionAttemptRow) => ({
  executionId: attempt.id,
  projectId: attempt.project_id,
  runAttempt: attempt.run_attempt,
  claimAttempt: attempt.claim_attempt,
  workerId: attempt.worker_id,
  claimedBy: attempt.claimed_by,
  claimedAt: attempt.claimed_at,
  recordedAt: attempt.recorded_at,
});

const organizationUsageRecordReport = (record: OrganizationUsageRecordRow) => ({
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

const organizationCostRecordReport = (record: OrganizationCostRecordRow) => ({
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
  amountUsdTicks: record.amount_usd_ticks,
  observedAt: record.observed_at,
  recordedAt: record.recorded_at,
});

export const organizationUsageRunReport = (
  run: OrganizationUsageRunRow,
  ledger: {
    readonly attempts?: readonly RunExecutionAttemptRow[];
    readonly records?: readonly OrganizationUsageRecordRow[];
    readonly costRecords?: readonly OrganizationCostRecordRow[];
    readonly estimatedCostRecords?: ReturnType<typeof estimateOrganizationUsageCosts>;
  } = {},
) => ({
  id: run.id,
  projectId: run.project_id,
  status: run.paused_at ? ("paused" as const) : run.status,
  executionMetrics: parseExecutionMetrics(run.execution_metrics_json),
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
  executionAttempts: (ledger.attempts ?? []).map(usageExecutionAttemptReport),
  usageRecords: (ledger.records ?? []).map(organizationUsageRecordReport),
  costRecords: (ledger.costRecords ?? []).map(organizationCostRecordReport),
  estimatedCostRecords: ledger.estimatedCostRecords ?? [],
});

const indexByRun = <Row extends { readonly run_id: string }>(rows: readonly Row[]) => {
  const byRun = new Map<string, Row[]>();
  for (const row of rows) {
    byRun.set(row.run_id, [...(byRun.get(row.run_id) ?? []), row]);
  }
  return byRun;
};

const requireOrganizationRead = async (db: D1Database, organizationId: string, userId: string) => {
  const role = await getOrganizationRole(db, organizationId, userId);
  if (!hasOrganizationCapability(role, "organization:read")) {
    throw new ReportingApplicationError("organization_not_found", "Organization not found");
  }
};

export async function listOrganizationUsageRunsApplication(
  input: {
    readonly db: D1Database;
    readonly organizationId: string;
    readonly userId: string;
    readonly days: 7 | 30 | 90;
    readonly generatedAt?: number;
  },
  services: ReportingApplicationServices = reportingApplicationServices,
) {
  await requireOrganizationRead(input.db, input.organizationId, input.userId);
  const generatedAt = input.generatedAt ?? Date.now();
  const since = organizationUsageQuerySince(input.days, generatedAt);
  const [runs, attempts, usageRecords, costRecords, loadedPricing] = await Promise.all([
    listOrganizationUsageRuns(input.db, input.organizationId, since),
    listOrganizationUsageExecutionAttempts(input.db, input.organizationId, since),
    listOrganizationUsageRecords(input.db, input.organizationId, since),
    listOrganizationUsageCostRecords(input.db, input.organizationId, since),
    services.loadPricing(),
  ]);
  const attemptsByRun = indexByRun(attempts);
  const usageRecordsByRun = indexByRun(usageRecords);
  const costRecordsByRun = indexByRun(costRecords);
  return {
    runs: runs.map((run) => {
      const runUsageRecords = usageRecordsByRun.get(run.id) ?? [];
      const runCostRecords = costRecordsByRun.get(run.id) ?? [];
      return organizationUsageRunReport(run, {
        attempts: attemptsByRun.get(run.id),
        records: runUsageRecords,
        costRecords: runCostRecords,
        estimatedCostRecords: estimateOrganizationUsageCosts({
          usageRecords: runUsageRecords,
          costRecords: runCostRecords,
          table: loadedPricing.table,
        }),
      });
    }),
    generatedAt: new Date(generatedAt).toISOString(),
    pricing: loadedPricing.pricing,
  };
}

const projectUsageSummaryRun = (
  run: OrganizationUsageRunRow,
  totals: readonly ProjectUsageTotalRow[],
) => ({
  ...organizationUsageRunReport(run),
  sourceCreatedAt: run.source_created_at,
  createdByUserId: run.created_by_user_id,
  createdByName: run.created_by_name,
  agentId: run.agent_id,
  agentName: run.agent_name,
  usageRecords: totals.map((total) => ({
    uncachedInputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    outputTokens: null,
    totalTokens: total.total_tokens,
    observedAt: total.observed_at,
  })),
});

export async function getProjectUsageSummaryApplication(input: {
  readonly db: D1Database;
  readonly projectId: string;
  readonly userId: string;
  readonly period: ProjectUsagePeriod;
  readonly range?: ProjectUsageDateRange;
  readonly generatedAt?: number;
}) {
  const project = await getProject(input.db, input.projectId, input.userId);
  if (!project) {
    throw new ReportingApplicationError("project_not_found", "Project not found");
  }
  if (input.range && !isProjectUsageDateRange(input.range, input.period)) {
    throw new ReportingApplicationError(
      "invalid_usage_range",
      "Usage range is invalid or contains more than 400 timeline buckets",
    );
  }
  const generatedAt = input.generatedAt ?? Date.now();
  const window = projectUsageSummaryWindow(input.period, generatedAt, input.range);
  const since = new Date(window.startAt).toISOString();
  const until = new Date(window.endAt).toISOString();
  const [runs, totals] = await Promise.all([
    listProjectUsageRuns(input.db, project.id, since, until),
    listProjectUsageTotals(input.db, project.id, since, until),
  ]);
  const totalsByRun = indexByRun(totals);
  return summarizeProjectUsage(
    runs.map((run) => projectUsageSummaryRun(run, totalsByRun.get(run.id) ?? [])),
    input.period,
    generatedAt,
    input.range,
  );
}

export async function listStatusTrayRunsApplication(input: {
  readonly db: D1Database;
  readonly organizationId: string;
  readonly userId: string;
  readonly generatedAt?: number;
}) {
  await requireOrganizationRead(input.db, input.organizationId, input.userId);
  const runs = await listOrganizationStatusTrayRuns(input.db, input.organizationId, input.userId);
  return {
    runs: runs.map((run) => {
      const workflow = normalizeAutoHuntWorkflow(JSON.parse(run.workflow_snapshot_json));
      return {
        projectId: run.project_id,
        projectName: run.project_name,
        id: run.id,
        title: run.title,
        status: run.status,
        workflowStage: run.workflow_stage,
        workflowStageLabel:
          workflow.stages.find((stage) => stage.id === run.workflow_stage)?.label ?? null,
        startedAt: run.started_at,
        updatedAt: run.updated_at,
        lastEventAt: run.last_event_at,
      };
    }),
    generatedAt: new Date(input.generatedAt ?? Date.now()).toISOString(),
  };
}

export async function getRunCostEstimateApplication(
  input: {
    readonly db: D1Database;
    readonly projectId: string;
    readonly runId: string;
    readonly userId: string;
  },
  services: ReportingApplicationServices = reportingApplicationServices,
) {
  const project = await getProject(input.db, input.projectId, input.userId);
  if (!project) {
    throw new ReportingApplicationError("project_not_found", "Project not found");
  }
  const run = await getHuntRunForProject(input.db, input.projectId, input.runId);
  if (!run) {
    throw new ReportingApplicationError("run_not_found", "Run not found");
  }
  const [usageRecords, loadedPricing] = await Promise.all([
    listRunUsageRecords(
      input.db,
      input.projectId,
      input.runId,
      run.current_attempt,
      run.last_execution_id,
    ),
    services.loadPricing(),
  ]);
  return estimateRunExecutionCost({
    usageRecords,
    loadedPricing,
  });
}
