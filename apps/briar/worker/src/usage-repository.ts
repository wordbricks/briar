import { type AutoHuntPersistedRunStatus } from "../../src/lib/auto-hunt-contract";
import type { AgentExecutionCostRecord } from "../../src/lib/agent-execution-cost";
import type {
  AgentExecutionMetrics,
  AgentExecutionUsageRecord,
} from "../../src/lib/agent-execution-metrics";

import { stableJson } from "./hunt-run-codec";
import { type IssueResultReviewRow } from "./issue-result-review-repository";
import { type ProjectAgentProvider } from "./project-agent-model";

export type OrganizationUsageRunRow = {
  id: string;
  project_id: string;
  status: AutoHuntPersistedRunStatus;
  paused_at: string | null;
  execution_metrics_json: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  claim_attempts: number;
  worker_id: string | null;
  preferred_agent_provider: ProjectAgentProvider | null;
  preferred_agent_model: string | null;
  requested_agent_provider: ProjectAgentProvider | null;
  requested_agent_model: string | null;
  execution_provider: ProjectAgentProvider | null;
  execution_model: string | null;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
  source_created_at?: string | null;
  created_by_user_id?: string | null;
  created_by_name?: string | null;
  agent_id?: string | null;
  agent_name?: string | null;
};

export type RunExecutionAttemptRow = {
  id: string;
  organization_id: string;
  project_id: string;
  run_id: string;
  run_attempt: number;
  claim_attempt: number;
  worker_id: string | null;
  claimed_by: string | null;
  claimed_at: string;
  recorded_at: string;
};

export type OrganizationUsageRecordRow = {
  execution_id: string;
  run_id: string;
  project_id: string;
  run_attempt: number;
  claim_attempt: number;
  worker_id: string | null;
  claimed_at: string;
  usage_key: string;
  session_id: string | null;
  turn_id: string | null;
  scope_id: string | null;
  agent_provider: ProjectAgentProvider;
  model_provider: string | null;
  model: string | null;
  canonical_model: string | null;
  model_source: AgentExecutionUsageRecord["modelSource"];
  source: string;
  uncached_input_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  output_tokens: number | null;
  reasoning_output_tokens: number | null;
  total_tokens: number | null;
  observed_at: string;
  recorded_at: string;
};

export type ProjectUsageTotalRow = {
  run_id: string;
  total_tokens: number;
  usage_records: number;
  observed_at: string;
};

export type OrganizationCostRecordRow = {
  execution_id: string;
  run_id: string;
  project_id: string;
  run_attempt: number;
  claim_attempt: number;
  worker_id: string | null;
  claimed_at: string;
  cost_key: string;
  usage_key: string | null;
  session_id: string | null;
  turn_id: string | null;
  scope_id: string | null;
  agent_provider: ProjectAgentProvider;
  model_provider: string | null;
  model: string | null;
  canonical_model: string | null;
  model_source: AgentExecutionCostRecord["modelSource"];
  source: string;
  amount_usd_ticks: number;
  observed_at: string;
  recorded_at: string;
};

export async function listOrganizationUsageRuns(
  db: D1Database,
  organizationId: string,
  since: string,
) {
  const runs = await db
    .prepare(
      `select run.id, run.project_id, run.status, run.paused_at,
              run.execution_metrics_json,
              run.claimed_by, run.claimed_at, run.claim_attempts, run.worker_id,
              run.preferred_agent_provider, run.preferred_agent_model,
              run.requested_agent_provider, run.requested_agent_model,
              coalesce(
                run.requested_agent_provider,
                run.preferred_agent_provider
              ) as execution_provider,
              case
                when run.requested_agent_provider is not null
                  then run.requested_agent_model
                when run.preferred_agent_provider is not null
                  then run.preferred_agent_model
                else null
              end as execution_model,
              run.started_at, run.updated_at, run.completed_at
       from briar_hunt_runs run
       join briar_projects project on project.id = run.project_id
       where project.organization_id = ?
         and (
           unixepoch(coalesce(
             run.completed_at,
             run.updated_at,
             run.started_at
           )) >= unixepoch(?)
           or exists (
             select 1 from briar_run_execution_attempts attempt
             where attempt.run_id = run.id
               and attempt.organization_id = project.organization_id
               and (
                 unixepoch(attempt.claimed_at) >= unixepoch(?)
                 or exists (
                   select 1 from briar_run_usage_records usage
                   where usage.execution_id = attempt.id
                     and unixepoch(usage.observed_at) >= unixepoch(?)
                 )
                 or exists (
                   select 1 from briar_run_cost_records cost
                   where cost.execution_id = attempt.id
                     and unixepoch(cost.observed_at) >= unixepoch(?)
                 )
               )
           )
         )
         and (
           run.execution_metrics_json is not null
           or run.claimed_at is not null
           or run.claimed_by is not null
           or run.worker_id is not null
           or run.claim_attempts > 0
           or run.paused_at is not null
           or run.status in (
             'running', 'blocked', 'failed', 'completed', 'cancelled'
           )
           or exists (
             select 1 from briar_run_execution_attempts attempt
             where attempt.run_id = run.id
               and attempt.organization_id = project.organization_id
           )
         )
       order by unixepoch(coalesce(
         run.completed_at,
         run.updated_at,
         run.started_at
       )), run.id`,
    )
    .bind(organizationId, since, since, since, since)
    .all<OrganizationUsageRunRow>();

  return runs.results;
}

export async function listProjectUsageRuns(
  db: D1Database,
  projectId: string,
  since: string,
  until: string,
) {
  const runs = await db
    .prepare(
      `select run.id, run.project_id, run.status, run.paused_at,
              run.execution_metrics_json,
              run.claimed_by, run.claimed_at, run.claim_attempts, run.worker_id,
              run.preferred_agent_provider, run.preferred_agent_model,
              run.requested_agent_provider, run.requested_agent_model,
              coalesce(
                run.requested_agent_provider,
                run.preferred_agent_provider
              ) as execution_provider,
              case
                when run.requested_agent_provider is not null
                  then run.requested_agent_model
                when run.preferred_agent_provider is not null
                  then run.preferred_agent_model
                else null
              end as execution_model,
              run.started_at, run.updated_at, run.completed_at,
              run.source_created_at, run.created_by_user_id,
              creator.name as created_by_name,
              run.agent_id,
              coalesce(agent.name, worker.label, run.claimed_by) as agent_name
       from briar_hunt_runs run
       left join "user" creator on creator.id = run.created_by_user_id
       left join briar_project_agents agent on agent.id = run.agent_id
       left join briar_execution_workers worker on worker.id = run.worker_id
       where run.project_id = ?
         and (
           (coalesce(run.source_created_at, run.started_at) >= ?
             and coalesce(run.source_created_at, run.started_at) < ?)
           or
           (coalesce(run.completed_at, run.updated_at, run.started_at) >= ?
             and coalesce(run.completed_at, run.updated_at, run.started_at) < ?)
           or exists (
             select 1
             from briar_run_execution_attempts attempt
             join briar_run_usage_records usage
               on usage.execution_id = attempt.id
             where attempt.run_id = run.id
               and attempt.project_id = run.project_id
               and usage.observed_at >= ? and usage.observed_at < ?
           )
         )
       order by coalesce(run.completed_at, run.updated_at, run.started_at),
                run.id`,
    )
    .bind(projectId, since, until, since, until, since, until)
    .all<OrganizationUsageRunRow>();

  return runs.results;
}

export async function getRunExecutionAttempt(
  db: D1Database,
  executionId: string,
) {
  return db
    .prepare(`select * from briar_run_execution_attempts where id = ?`)
    .bind(executionId)
    .first<RunExecutionAttemptRow>();
}

export async function recordRunUsageRecords(
  db: D1Database,
  input: {
    executionId: string;
    records: AgentExecutionUsageRecord[];
    recordedAt: string;
  },
) {
  if (input.records.length === 0) return 0;
  const result = await db
    .prepare(
      `insert into briar_run_usage_records (
         execution_id, usage_key, session_id, turn_id, scope_id,
         agent_provider, model_provider, model, canonical_model,
         model_source, source, uncached_input_tokens, cache_read_tokens,
         cache_write_tokens, output_tokens, reasoning_output_tokens,
         total_tokens, observed_at, recorded_at
       )
       select ?, json_extract(record.value, '$.usageKey'),
              json_extract(record.value, '$.sessionId'),
              json_extract(record.value, '$.turnId'),
              json_extract(record.value, '$.scopeId'),
              json_extract(record.value, '$.agentProvider'),
              json_extract(record.value, '$.modelProvider'),
              json_extract(record.value, '$.model'),
              json_extract(record.value, '$.canonicalModel'),
              json_extract(record.value, '$.modelSource'),
              json_extract(record.value, '$.source'),
              json_extract(record.value, '$.uncachedInputTokens'),
              json_extract(record.value, '$.cacheReadTokens'),
              json_extract(record.value, '$.cacheWriteTokens'),
              json_extract(record.value, '$.outputTokens'),
              json_extract(record.value, '$.reasoningOutputTokens'),
              json_extract(record.value, '$.totalTokens'),
              json_extract(record.value, '$.observedAt'), ?
       from json_each(?) record
       where true
       on conflict (execution_id, usage_key) do nothing`,
    )
    .bind(
      input.executionId,
      input.recordedAt,
      JSON.stringify(input.records),
    )
    .run();
  return result.meta.changes ?? 0;
}

export async function recordRunCostRecords(
  db: D1Database,
  input: {
    executionId: string;
    records: AgentExecutionCostRecord[];
    recordedAt: string;
  },
) {
  if (input.records.length === 0) return 0;
  const result = await db
    .prepare(
      `insert into briar_run_cost_records (
         execution_id, cost_key, usage_key, session_id, turn_id, scope_id,
         agent_provider, model_provider, model, canonical_model,
         model_source, source, amount_usd_ticks, observed_at, recorded_at
       )
       select ?, json_extract(record.value, '$.costKey'),
              json_extract(record.value, '$.usageKey'),
              json_extract(record.value, '$.sessionId'),
              json_extract(record.value, '$.turnId'),
              json_extract(record.value, '$.scopeId'),
              json_extract(record.value, '$.agentProvider'),
              json_extract(record.value, '$.modelProvider'),
              json_extract(record.value, '$.model'),
              json_extract(record.value, '$.canonicalModel'),
              json_extract(record.value, '$.modelSource'),
              json_extract(record.value, '$.source'),
              json_extract(record.value, '$.amountUsdTicks'),
              json_extract(record.value, '$.observedAt'), ?
       from json_each(?) record
       where true
       on conflict (execution_id, cost_key) do nothing`,
    )
    .bind(
      input.executionId,
      input.recordedAt,
      JSON.stringify(input.records),
    )
    .run();
  return result.meta.changes ?? 0;
}

export async function listOrganizationUsageExecutionAttempts(
  db: D1Database,
  organizationId: string,
  since: string,
) {
  const result = await db
    .prepare(
      `select * from briar_run_execution_attempts
       where organization_id = ? and (
         unixepoch(claimed_at) >= unixepoch(?)
         or exists (
           select 1 from briar_run_usage_records usage
           where usage.execution_id = briar_run_execution_attempts.id
             and unixepoch(usage.observed_at) >= unixepoch(?)
         )
         or exists (
           select 1 from briar_run_cost_records cost
           where cost.execution_id = briar_run_execution_attempts.id
             and unixepoch(cost.observed_at) >= unixepoch(?)
         )
       )
       order by unixepoch(claimed_at), run_id, claim_attempt, id`,
    )
    .bind(organizationId, since, since, since)
    .all<RunExecutionAttemptRow>();
  return result.results;
}

export async function listOrganizationUsageRecords(
  db: D1Database,
  organizationId: string,
  since: string,
) {
  const result = await db
    .prepare(
      `select usage.execution_id, attempt.run_id, attempt.project_id,
              attempt.run_attempt, attempt.claim_attempt, attempt.worker_id,
              attempt.claimed_at, usage.usage_key, usage.session_id,
              usage.turn_id, usage.scope_id, usage.agent_provider,
              usage.model_provider, usage.model, usage.canonical_model,
              usage.model_source, usage.source, usage.uncached_input_tokens,
              usage.cache_read_tokens, usage.cache_write_tokens,
              usage.output_tokens, usage.reasoning_output_tokens,
              usage.total_tokens, usage.observed_at, usage.recorded_at
       from briar_run_usage_records usage
       join briar_run_execution_attempts attempt
         on attempt.id = usage.execution_id
       where attempt.organization_id = ?
         and unixepoch(usage.observed_at) >= unixepoch(?)
       order by unixepoch(usage.observed_at), attempt.run_id,
                attempt.claim_attempt, usage.usage_key`,
    )
    .bind(organizationId, since)
    .all<OrganizationUsageRecordRow>();
  return result.results;
}

export async function listRunUsageRecords(
  db: D1Database,
  projectId: string,
  runId: string,
  runAttempt: number,
  executionId: string | null,
) {
  const result = await db
    .prepare(
      `select usage.execution_id, attempt.run_id, attempt.project_id,
              attempt.run_attempt, attempt.claim_attempt, attempt.worker_id,
              attempt.claimed_at, usage.usage_key, usage.session_id,
              usage.turn_id, usage.scope_id, usage.agent_provider,
              usage.model_provider, usage.model, usage.canonical_model,
              usage.model_source, usage.source, usage.uncached_input_tokens,
              usage.cache_read_tokens, usage.cache_write_tokens,
              usage.output_tokens, usage.reasoning_output_tokens,
              usage.total_tokens, usage.observed_at, usage.recorded_at
       from briar_run_usage_records usage
       join briar_run_execution_attempts attempt
         on attempt.id = usage.execution_id
       where attempt.project_id = ? and attempt.run_id = ?
         and attempt.run_attempt = ?
         and (? is null or attempt.id = ?)
       order by unixepoch(usage.observed_at), attempt.claim_attempt,
                usage.usage_key`,
    )
    .bind(projectId, runId, runAttempt, executionId, executionId)
    .all<OrganizationUsageRecordRow>();
  return result.results;
}

export async function listProjectUsageTotals(
  db: D1Database,
  projectId: string,
  since: string,
  until: string,
) {
  const result = await db
    .prepare(
      `select attempt.run_id,
              sum(coalesce(
                usage.total_tokens,
                coalesce(usage.uncached_input_tokens, 0) +
                coalesce(usage.cache_read_tokens, 0) +
                coalesce(usage.cache_write_tokens, 0) +
                coalesce(usage.output_tokens, 0)
              )) as total_tokens,
              count(*) as usage_records,
              substr(usage.observed_at, 1, 10) || 'T00:00:00.000Z'
                as observed_at
       from briar_run_execution_attempts attempt
       join briar_run_usage_records usage on usage.execution_id = attempt.id
       where attempt.project_id = ?
         and usage.observed_at >= ? and usage.observed_at < ?
       group by attempt.run_id, substr(usage.observed_at, 1, 10)
       order by observed_at, attempt.run_id`,
    )
    .bind(projectId, since, until)
    .all<ProjectUsageTotalRow>();
  return result.results;
}

export async function listOrganizationUsageCostRecords(
  db: D1Database,
  organizationId: string,
  since: string,
) {
  const result = await db
    .prepare(
      `select cost.execution_id, attempt.run_id, attempt.project_id,
              attempt.run_attempt, attempt.claim_attempt, attempt.worker_id,
              attempt.claimed_at, cost.cost_key, cost.usage_key,
              cost.session_id, cost.turn_id, cost.scope_id,
              cost.agent_provider, cost.model_provider, cost.model,
              cost.canonical_model, cost.model_source, cost.source,
              cost.amount_usd_ticks, cost.observed_at, cost.recorded_at
       from briar_run_cost_records cost
       join briar_run_execution_attempts attempt
         on attempt.id = cost.execution_id
       where attempt.organization_id = ?
         and unixepoch(cost.observed_at) >= unixepoch(?)
       order by unixepoch(cost.observed_at), attempt.run_id,
                attempt.claim_attempt, cost.cost_key`,
    )
    .bind(organizationId, since)
    .all<OrganizationCostRecordRow>();
  return result.results;
}

export async function listIssueResultReviews(
  db: D1Database,
  projectId: string,
) {
  const reviews = await db
    .prepare(
      `select review.run_id, user.id as user_id, user.name, user.username,
              user.image, review.completed_at
       from briar_issue_result_reviews review
       join briar_hunt_runs run on run.id = review.run_id
       join "user" user on user.id = review.reviewer_user_id
       where run.project_id = ?
       order by review.completed_at asc, lower(user.name), user.id`,
    )
    .bind(projectId)
    .all<IssueResultReviewRow>();
  return reviews.results;
}

export async function updateHuntRunExecutionMetrics(
  db: D1Database,
  projectId: string,
  input: {
    runId: string;
    attempt: number;
    workerId: string;
    executionId?: string;
    metrics: AgentExecutionMetrics;
  },
) {
  const result = await db
    .prepare(
      `update briar_hunt_runs
       set execution_metrics_json = ?
       where id = ? and project_id = ? and current_attempt = ?
         and worker_id = ?
         and (? is null or last_execution_id = ?)`,
    )
    .bind(
      stableJson(input.metrics),
      input.runId,
      projectId,
      input.attempt,
      input.workerId,
      input.executionId ?? null,
      input.executionId ?? null,
    )
    .run();
  return result.meta.changes > 0;
}
