import {
  type AutoHuntPersistedRunStatus,
  type DashboardStage,
} from "../../src/lib/auto-hunt-contract";

import { type HuntEventInput } from "./hunt-event-model";
import { HuntClaimError } from "./hunt-run-errors";
import { type HuntRunRow } from "./hunt-run-model";
import { type ProjectAgentProvider } from "./project-agent-model";

export async function claimNextQueuedHuntRun(
  db: D1Database,
  projectId: string,
  input: {
    claimTokenHash: string;
    claimedBy: string;
    claimedAt: string;
    leaseExpiresAt: string;
    runId?: string;
    workerId?: string;
    workerDeviceId?: string;
    agentProvider?: ProjectAgentProvider;
    agentProviders?: ProjectAgentProvider[];
    detachedOnly?: boolean;
  },
) {
  const allowedProviders =
    input.agentProviders ??
    (input.agentProvider ? [input.agentProvider] : undefined);
  const executionId = crypto.randomUUID();
  const claimStatement = db
    .prepare(
      `update briar_hunt_runs
       set claim_token_hash = ?, claimed_by = ?, claimed_at = ?,
           lease_expires_at = ?,
           claim_attempts = claim_attempts +
             case when planned_update_resume = 1 then 0 else 1 end,
           planned_update_resume = 0,
           last_execution_id = ?,
           worker_id = ?,
           status = case
             when status = 'queued' and workflow_stage is not null
               then 'running'
             else status
           end,
           stage = case
             when status = 'queued' and workflow_stage is not null then
               case
                 when workflow_stage in (
                   'analyzing', 'implementing', 'pr_open',
                   'staging_qa', 'production_qa'
                 ) then workflow_stage
                 else 'implementing'
               end
             else stage
           end,
           detail = case
             when status = 'queued' and workflow_stage is not null
               then '워커가 이전 작업 단계부터 이어받았습니다.'
             else detail
           end,
           paused_at = case
             when resume_requested_at is not null then null else paused_at end,
           updated_at = ?
       where id = (
         select id from briar_hunt_runs
         where project_id = ?
           and (
             status = 'queued'
             or (
               status = 'running' and paused_at is not null
               and resume_requested_at is not null
             )
           )
           and (lease_expires_at is null or lease_expires_at <= ?)
           and (? is null or id = ?)
           and not exists (
             select 1
             from briar_issue_dependencies dependency
             join briar_hunt_runs prerequisite
               on prerequisite.id = dependency.prerequisite_run_id
             where dependency.project_id = briar_hunt_runs.project_id
               and dependency.dependent_run_id = briar_hunt_runs.id
               and prerequisite.status != 'completed'
           )
           and (? = 0 or dispatched_at is not null)
           and (
             (? = 0 and dispatch_mode is null)
             or (? = 1 and dispatch_mode = 'any')
             or (
               ? = 1 and dispatch_mode = 'specific'
               and requested_worker_id = ?
             )
           )
           and (
             ? is null
             or not exists (
               select 1 from briar_project_execution_worker_policies policy
               where policy.project_id = briar_hunt_runs.project_id
                 and policy.selection_mode = 'allowlist'
             )
             or exists (
               select 1
               from briar_project_execution_worker_allowlist allowed
               where allowed.project_id = briar_hunt_runs.project_id
                 and allowed.worker_id = ?
             )
           )
           and (
             ? = 0
             or (
               ? = 1
               and coalesce(
                 requested_agent_provider,
                 preferred_agent_provider,
                 (
                   select skill.provider
                   from briar_agent_skills skill
                   where skill.agent_id = briar_hunt_runs.agent_id
                     and skill.kind = 'issue_processing'
                   order by skill.position, skill.created_at, skill.id
                   limit 1
                 ),
                 (
                   select agent.provider from briar_project_agents agent
                   where agent.id = briar_hunt_runs.agent_id
                     and agent.project_id = briar_hunt_runs.project_id
                 )
               ) = 'codex'
             )
             or (
               ? = 1
               and coalesce(
                 requested_agent_provider,
                 preferred_agent_provider,
                 (
                   select skill.provider
                   from briar_agent_skills skill
                   where skill.agent_id = briar_hunt_runs.agent_id
                     and skill.kind = 'issue_processing'
                   order by skill.position, skill.created_at, skill.id
                   limit 1
                 ),
                 (
                   select agent.provider from briar_project_agents agent
                   where agent.id = briar_hunt_runs.agent_id
                     and agent.project_id = briar_hunt_runs.project_id
                 )
               ) = 'claude'
             )
             or (
               ? = 1
               and coalesce(
                 requested_agent_provider,
                 preferred_agent_provider,
                 (
                   select skill.provider
                   from briar_agent_skills skill
                   where skill.agent_id = briar_hunt_runs.agent_id
                     and skill.kind = 'issue_processing'
                   order by skill.position, skill.created_at, skill.id
                   limit 1
                 ),
                 (
                   select agent.provider from briar_project_agents agent
                   where agent.id = briar_hunt_runs.agent_id
                     and agent.project_id = briar_hunt_runs.project_id
                 )
               ) = 'cursor'
             )
             or (
               ? = 1
               and coalesce(
                 requested_agent_provider,
                 preferred_agent_provider,
                 (
                   select skill.provider
                   from briar_agent_skills skill
                   where skill.agent_id = briar_hunt_runs.agent_id
                     and skill.kind = 'issue_processing'
                   order by skill.position, skill.created_at, skill.id
                   limit 1
                 ),
                 (
                   select agent.provider from briar_project_agents agent
                   where agent.id = briar_hunt_runs.agent_id
                     and agent.project_id = briar_hunt_runs.project_id
                 )
               ) = 'grok'
             )
             or (
               ? = 1
               and coalesce(
                 requested_agent_provider,
                 preferred_agent_provider,
                 (
                   select skill.provider
                   from briar_agent_skills skill
                   where skill.agent_id = briar_hunt_runs.agent_id
                     and skill.kind = 'issue_processing'
                   order by skill.position, skill.created_at, skill.id
                   limit 1
                 ),
                 (
                   select agent.provider from briar_project_agents agent
                   where agent.id = briar_hunt_runs.agent_id
                     and agent.project_id = briar_hunt_runs.project_id
                 )
               ) = 'agy'
             )
             or (
               ? = 1
               and coalesce(
                 requested_agent_provider,
                 preferred_agent_provider,
                 (
                   select skill.provider
                   from briar_agent_skills skill
                   where skill.agent_id = briar_hunt_runs.agent_id
                     and skill.kind = 'issue_processing'
                   order by skill.position, skill.created_at, skill.id
                   limit 1
                 ),
                 (
                   select agent.provider from briar_project_agents agent
                   where agent.id = briar_hunt_runs.agent_id
                     and agent.project_id = briar_hunt_runs.project_id
                 )
               ) = 'opencode'
             )
             or (
               ? = 1
               and coalesce(
                 requested_agent_provider,
                 preferred_agent_provider,
                 (
                   select skill.provider
                   from briar_agent_skills skill
                   where skill.agent_id = briar_hunt_runs.agent_id
                     and skill.kind = 'issue_processing'
                   order by skill.position, skill.created_at, skill.id
                   limit 1
                 ),
                 (
                   select agent.provider from briar_project_agents agent
                   where agent.id = briar_hunt_runs.agent_id
                     and agent.project_id = briar_hunt_runs.project_id
                 )
               ) = 'openrouter'
             )
           )
           and (
             ? is null or (
             (select count(*)
              from briar_hunt_runs active
              join briar_execution_workers holder
                on holder.id = active.worker_id
              where holder.device_id = ?
                and active.claim_token_hash is not null
                and active.lease_expires_at is not null
                and active.lease_expires_at > ?
                and active.status not in (
                  'backlog', 'completed', 'cancelled', 'blocked', 'failed'
                ))
             +
             (select count(*)
              from briar_project_agent_task_jobs active_task
              join briar_execution_workers holder
                on holder.id = active_task.claimed_worker_id
              where holder.device_id = ?
                and active_task.status = 'running'
                and active_task.lease_expires_at > ?)
             +
             (select count(*)
              from briar_merge_batches active_batch
              join briar_execution_workers holder
                on holder.id = active_batch.claimed_worker_id
              where holder.device_id = ?
                and active_batch.claim_token_hash is not null
                and active_batch.lease_expires_at > ?
                and active_batch.state in (
                  'enqueueing', 'waiting_tail', 'validating',
                  'publishing', 'draining'
                ))
             ) < coalesce((
               select device.max_concurrent_sessions
               from briar_execution_worker_devices device
               where device.id = ?
             ), 0)
           )
         order by
           case when resume_requested_at is not null then 0 else 1 end,
           case when priority is null then 1 else 0 end,
           priority asc,
           coalesce(source_created_at, started_at) asc,
           run_number asc
         limit 1
       )
       returning *`,
    )
    .bind(
      input.claimTokenHash,
      input.claimedBy,
      input.claimedAt,
      input.leaseExpiresAt,
      executionId,
      input.workerId ?? null,
      input.claimedAt,
      projectId,
      input.claimedAt,
      input.runId ?? null,
      input.runId ?? null,
      input.detachedOnly ? 1 : 0,
      input.detachedOnly ? 1 : 0,
      input.detachedOnly ? 1 : 0,
      input.detachedOnly ? 1 : 0,
      input.workerId ?? null,
      input.workerId ?? null,
      input.workerId ?? null,
      allowedProviders ? 1 : 0,
      allowedProviders?.includes("codex") ? 1 : 0,
      allowedProviders?.includes("claude") ? 1 : 0,
      allowedProviders?.includes("cursor") ? 1 : 0,
      allowedProviders?.includes("grok") ? 1 : 0,
      allowedProviders?.includes("agy") ? 1 : 0,
      allowedProviders?.includes("opencode") ? 1 : 0,
      allowedProviders?.includes("openrouter") ? 1 : 0,
      input.workerDeviceId ?? null,
      input.workerDeviceId ?? null,
      input.claimedAt,
      input.workerDeviceId ?? null,
      input.claimedAt,
      input.workerDeviceId ?? null,
      input.claimedAt,
      input.workerDeviceId ?? null,
    );
  const attemptStatement = db
    .prepare(
      `insert into briar_run_execution_attempts (
         id, organization_id, project_id, run_id, run_attempt, claim_attempt,
         worker_id, claimed_by, claimed_at, recorded_at
       )
       select ?, project.organization_id, run.project_id, run.id,
              run.current_attempt, run.claim_attempts, ?,
              run.claimed_by, run.claimed_at, ?
       from briar_hunt_runs run
       join briar_projects project on project.id = run.project_id
       where run.project_id = ? and run.last_execution_id = ?`,
    )
    .bind(
      executionId,
      input.workerId ?? null,
      input.claimedAt,
      projectId,
      executionId,
    );
  const [claimResult] = await db.batch([claimStatement, attemptStatement]);
  return (claimResult.results[0] as HuntRunRow | undefined) ?? null;
}

export async function assertQueuedHuntClaim(
  db: D1Database,
  projectId: string,
  input: Pick<HuntEventInput, "source" | "sourceKey">,
  claimTokenHash: string | null,
  observedAt: string,
) {
  const run = await db
    .prepare(
      `select stage, status, claim_token_hash, lease_expires_at, context_json,
              case when claim_token_hash = ? then 1 else 0 end as claim_token_valid
       from briar_hunt_runs
       where project_id = ? and source = ? and source_key = ?
       limit 1`,
    )
    .bind(claimTokenHash ?? "", projectId, input.source, input.sourceKey)
    .first<{
      stage: DashboardStage;
      status: AutoHuntPersistedRunStatus;
      claim_token_hash: string | null;
      lease_expires_at: string | null;
      context_json: string | null;
      claim_token_valid: number;
    }>();
  if (!run) return;
  if (run.status !== "queued") {
    if (claimTokenHash && run.claim_token_valid !== 1) {
      throw new HuntClaimError("Issue processing claim token is no longer active");
    }
    return;
  }
  const context: unknown = run.context_json
    ? JSON.parse(run.context_json)
    : null;
  const appCreated =
    context !== null &&
    typeof context === "object" &&
    !Array.isArray(context) &&
    (context as Record<string, unknown>).origin === "briar-app";
  if (!run.claim_token_hash) {
    if (claimTokenHash) {
      throw new HuntClaimError("Issue processing claim token is no longer active");
    }
    if (!appCreated) return;
  }
  if (
    run.claim_token_valid !== 1 ||
    !run.lease_expires_at ||
    run.lease_expires_at <= observedAt
  ) {
    throw new HuntClaimError(
      "Queued issue processing requires its active claim token",
    );
  }
}

export async function findProjectIdByAgentTokenHash(
  db: D1Database,
  agentTokenHash: string,
) {
  return await db
    .prepare(
      `select token.project_id
       from briar_project_agent_tokens token
       join briar_projects project on project.id = token.project_id
       join briar_organization_members membership
         on membership.organization_id = project.organization_id
        and membership.user_id = token.issued_to_user_id
       left join briar_project_members project_membership
         on project_membership.project_id = project.id
        and project_membership.organization_id = project.organization_id
        and project_membership.user_id = membership.user_id
       where token.token_hash = ?
         and (
           membership.role in ('owner', 'co-owner')
           or project_membership.user_id is not null
         )
       union all
       select id as project_id
       from briar_projects
       where agent_token_hash = ?
       limit 1`,
    )
    .bind(agentTokenHash, agentTokenHash)
    .first<string>("project_id");
}

export async function issueProjectAgentToken(
  db: D1Database,
  projectId: string,
  userId: string,
  agentTokenHash: string,
) {
  const result = await db
    .prepare(
      `insert into briar_project_agent_tokens (
         token_hash, project_id, issued_to_user_id, created_at
       )
       select ?, project.id, ?, ?
       from briar_projects project
       join briar_organization_members membership
         on membership.organization_id = project.organization_id
        and membership.user_id = ?
       left join briar_project_members project_membership
         on project_membership.project_id = project.id
        and project_membership.organization_id = project.organization_id
        and project_membership.user_id = membership.user_id
       where project.id = ?
         and (
           membership.role in ('owner', 'co-owner')
           or project_membership.user_id is not null
         )`,
    )
    .bind(
      agentTokenHash,
      userId,
      new Date().toISOString(),
      userId,
      projectId,
    )
    .run();
  return result.meta.changes > 0;
}
