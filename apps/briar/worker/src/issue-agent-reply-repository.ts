import { type AgentSkillKind } from "./agent-skills";
import {
  replyCompletionReceiptStatement,
  type ReplyCompletionCommit,
} from "./reply-completion-repository";

import {
  type ModelEffort,
  type ProjectAgentProvider,
} from "./project-agent-model";

export type IssueAgentReplyJobRow = {
  id: string;
  project_id: string;
  run_id: string;
  trigger_message_id: string;
  parent_message_id: string;
  reply_message_id: string;
  agent_id: string | null;
  requires_preferred_worker: number;
  agent_name_snapshot: string | null;
  agent_responsibility_snapshot: string | null;
  status: "queued" | "running" | "completed" | "failed";
  preferred_worker_id: string | null;
  claimed_worker_id: string | null;
  preferred_provider: ProjectAgentProvider | null;
  agent_provider: ProjectAgentProvider | null;
  skill_id?: string | null;
  selected_skill_id_snapshot?: string | null;
  selected_agent_name_snapshot?: string | null;
  selected_agent_responsibility_snapshot?: string | null;
  selected_skill_name_snapshot?: string | null;
  selected_skill_instructions_snapshot?: string | null;
  selected_skill_kind_snapshot?: AgentSkillKind | null;
  selected_skill_provider_snapshot?: ProjectAgentProvider | null;
  selected_skill_model_snapshot?: string | null;
  selected_skill_effort_snapshot?: ModelEffort | null;
  skill_execution_request_snapshot?: string | null;
  claim_token_hash: string | null;
  claimed_at: string | null;
  lease_expires_at: string | null;
  attempts: number;
  planned_update_resume: number;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export async function enqueueIssueAgentReply(
  db: D1Database,
  input: {
    id: string;
    projectId: string;
    runId: string;
    triggerMessageId: string;
    parentMessageId: string;
    replyMessageId: string;
    agentId?: string | null;
    skillId?: string | null;
    requiresPreferredWorker?: boolean;
    createdAt: string;
  },
) {
  const targetAgentId = input.agentId ?? null;
  const preferredWorkerRequirement = input.requiresPreferredWorker === undefined
    ? null
    : input.requiresPreferredWorker
      ? 1
      : 0;
  const preferredProvider = targetAgentId
    ? `coalesce(
         selected_skill.provider,
         (
           select skill.provider
           from briar_agent_skills skill
           where skill.agent_id = agent.id
             and skill.kind = 'issue_processing'
           order by skill.position, skill.created_at, skill.id
           limit 1
         ),
         agent.provider,
         run.requested_agent_provider
       )`
    : `coalesce(
         selected_skill.provider,
         run.requested_agent_provider,
         (
           select skill.provider
           from briar_agent_skills skill
           where skill.agent_id = agent.id
             and skill.kind = 'issue_processing'
           order by skill.position, skill.created_at, skill.id
           limit 1
         ),
         agent.provider
       )`;
  await db
    .prepare(
      `insert into briar_issue_agent_reply_jobs (
         id, project_id, run_id, trigger_message_id, parent_message_id,
         reply_message_id, agent_id, requires_preferred_worker,
         agent_name_snapshot, agent_responsibility_snapshot,
         preferred_worker_id, preferred_provider,
         skill_id, selected_skill_id_snapshot,
         selected_agent_name_snapshot,
         selected_agent_responsibility_snapshot,
         selected_skill_name_snapshot, selected_skill_instructions_snapshot,
         selected_skill_kind_snapshot,
         selected_skill_provider_snapshot, selected_skill_model_snapshot,
         selected_skill_effort_snapshot, skill_execution_request_snapshot,
         created_at, updated_at
       )
       select ?, run.project_id, run.id, trigger.id, parent.id, ?,
              agent.id,
              coalesce(?, case when run.worker_id is null then 0 else 1 end),
              agent.name, agent.responsibility,
              run.worker_id,
              ${preferredProvider},
              selected_skill.id, selected_skill.id,
              case when selected_skill.id is null then null else agent.name end,
              case when selected_skill.id is null then null
                else agent.responsibility end,
              selected_skill.name, selected_skill.body,
              selected_skill.kind,
              selected_skill.provider, selected_skill.model,
              selected_skill.effort,
              case when selected_skill.id is null then null else trigger.body end,
              ?, ?
       from briar_hunt_runs run
       join briar_issue_messages trigger
         on trigger.id = ? and trigger.project_id = run.project_id
        and trigger.run_id = run.id
       join briar_issue_messages parent
         on parent.id = ? and parent.project_id = run.project_id
        and parent.run_id = run.id
       left join briar_project_agents agent
         on agent.id = coalesce(?, run.agent_id)
        and agent.project_id = run.project_id
       left join briar_agent_skills selected_skill
         on selected_skill.id = ? and selected_skill.agent_id = agent.id
       where run.id = ? and run.project_id = ?
         and (? is null or selected_skill.id is not null)
       on conflict (project_id, trigger_message_id, agent_id) do nothing`,
    )
    .bind(
      input.id,
      input.replyMessageId,
      preferredWorkerRequirement,
      input.createdAt,
      input.createdAt,
      input.triggerMessageId,
      input.parentMessageId,
      targetAgentId,
      input.skillId ?? null,
      input.runId,
      input.projectId,
      input.skillId ?? null,
    )
    .run();
  return getIssueAgentReplyJob(
    db,
    input.projectId,
    input.triggerMessageId,
    input.agentId ?? null,
  );
}

export async function getIssueAgentReplyJob(
  db: D1Database,
  projectId: string,
  triggerMessageId: string,
  agentId?: string | null,
) {
  return await db
    .prepare(
      `select job.*
       from briar_issue_agent_reply_jobs job
       join briar_hunt_runs run
         on run.id = job.run_id and run.project_id = job.project_id
       where job.project_id = ? and job.trigger_message_id = ?
         and (? is null or job.agent_id = ?)`,
    )
    .bind(projectId, triggerMessageId, agentId ?? null, agentId ?? null)
    .first<IssueAgentReplyJobRow>();
}

export async function listIssueAgentReplyJobs(
  db: D1Database,
  projectId: string,
  runId: string,
) {
  const result = await db
    .prepare(
      `select job.*
       from briar_issue_agent_reply_jobs job
       join briar_hunt_runs run
         on run.id = job.run_id and run.project_id = job.project_id
       where job.project_id = ? and job.run_id = ?
       order by job.created_at, job.id`,
    )
    .bind(projectId, runId)
    .all<IssueAgentReplyJobRow>();
  return result.results;
}

export async function claimNextIssueAgentReply(
  db: D1Database,
  projectId: string,
  input: {
    workerId: string;
    agentProvider: ProjectAgentProvider;
    claimTokenHash: string;
    claimedAt: string;
    leaseExpiresAt: string;
    staleBefore: string;
    computerUseProvidersJson?: string;
  },
) {
  // Migration 0092 is a deployment prerequisite, so every claim enforces the
  // saved-Skill snapshot without a runtime compatibility branch.
  const selectedSkillGuard = `and (
         job.selected_skill_id_snapshot is null
         or (
           job.skill_id = job.selected_skill_id_snapshot
           and exists (
             select 1
             from briar_teams project
             join briar_project_agents selected_agent
               on selected_agent.id = coalesce(job.agent_id, run.agent_id)
              and selected_agent.project_id = run.project_id
              and selected_agent.organization_id = project.organization_id
             join briar_agent_skills selected_skill
               on selected_skill.id = job.selected_skill_id_snapshot
              and selected_skill.agent_id = selected_agent.id
             join briar_issue_messages trigger
               on trigger.id = job.trigger_message_id
              and trigger.project_id = job.project_id
              and trigger.run_id = job.run_id
             where project.id = run.project_id
               and exists (
                 select 1
                 from briar_execution_worker_healthy_providers healthy
                 where healthy.worker_id = ?
                   and healthy.provider = selected_skill.provider
               )
               and selected_agent.name = job.selected_agent_name_snapshot
               and selected_agent.responsibility =
                 job.selected_agent_responsibility_snapshot
               and selected_skill.name = job.selected_skill_name_snapshot
               and selected_skill.body =
                 job.selected_skill_instructions_snapshot
               and selected_skill.kind = job.selected_skill_kind_snapshot
               and selected_skill.provider = job.selected_skill_provider_snapshot
               and selected_skill.model is job.selected_skill_model_snapshot
               and selected_skill.effort is job.selected_skill_effort_snapshot
               and trigger.body = job.skill_execution_request_snapshot
             )
         )
       )`;
  await db
    .prepare(
      `update briar_issue_agent_reply_jobs
       set status = 'failed',
           error = coalesce(error, 'Worker reply lease expired repeatedly.'),
           claim_token_hash = null, lease_expires_at = null, updated_at = ?
       where project_id = ? and status = 'running' and attempts >= 3
         and lease_expires_at <= ?
         and exists (
           select 1 from briar_hunt_runs run
           where run.id = briar_issue_agent_reply_jobs.run_id
             and run.project_id = briar_issue_agent_reply_jobs.project_id
         )`,
    )
    .bind(input.claimedAt, projectId, input.claimedAt)
    .run();
  return await db
    .prepare(
      `update briar_issue_agent_reply_jobs
       set status = 'running', claimed_worker_id = ?,
           agent_provider = case when exists (
             select 1
             from briar_execution_worker_healthy_providers healthy
             where healthy.worker_id = ?
               and healthy.provider = preferred_provider
           ) then preferred_provider else ?
           end,
           claim_token_hash = ?, claimed_at = ?, lease_expires_at = ?,
           attempts = attempts + case when planned_update_resume = 1 then 0 else 1 end,
           planned_update_resume = 0, error = null, updated_at = ?
       where id = (
         select job.id
         from briar_issue_agent_reply_jobs job
         join briar_hunt_runs run
           on run.id = job.run_id and run.project_id = job.project_id
         where job.project_id = ?
           and job.attempts < 3
           and (
             job.status = 'queued'
             or (job.status = 'running' and job.lease_expires_at <= ?)
           )
           and (
             job.requires_preferred_worker = 0
             or job.preferred_worker_id = ?
           )
           and (
             not exists (
               select 1 from briar_project_execution_worker_policies policy
               where policy.project_id = job.project_id
                 and policy.selection_mode = 'allowlist'
             )
             or exists (
               select 1
               from briar_project_execution_worker_allowlist allowed
               where allowed.project_id = job.project_id
                 and allowed.worker_id = ?
             )
           )
           and (
             job.preferred_worker_id is null
             or job.preferred_worker_id = ?
             or not exists (
               select 1
               from briar_execution_workers preferred
               join briar_execution_worker_devices device
                 on device.id = preferred.device_id
               where preferred.id = job.preferred_worker_id
                 and preferred.project_id = job.project_id
                 and preferred.state != 'disabled'
                 and device.state != 'disabled'
                 and preferred.accepting_work = 1
                 and preferred.readiness_state != 'needs_attention'
                 and preferred.last_heartbeat_at >= ?
                 and (
                   not exists (
                     select 1
                     from briar_project_execution_worker_policies policy
                     where policy.project_id = job.project_id
                       and policy.selection_mode = 'allowlist'
                   )
                   or exists (
                     select 1
                     from briar_project_execution_worker_allowlist allowed
                     where allowed.project_id = job.project_id
                       and allowed.worker_id = preferred.id
                   )
                 )
             )
           )
           ${selectedSkillGuard}
           and (
             not exists (
               select 1
               from briar_project_agents computer_agent
               where computer_agent.id = coalesce(job.agent_id, run.agent_id)
                 and computer_agent.project_id = run.project_id
                 and computer_agent.computer_use_policy = 'unattended'
             )
             or exists (
               select 1 from json_each(?) computer_provider
               where computer_provider.value = case when exists (
                 select 1
                 from briar_execution_worker_healthy_providers healthy
                 where healthy.worker_id = ?
                   and healthy.provider = job.preferred_provider
               ) then job.preferred_provider else ? end
             )
           )
         order by job.created_at, job.id
         limit 1
       )
       returning *`,
    )
    .bind(
      input.workerId,
      input.workerId,
      input.agentProvider,
      input.claimTokenHash,
      input.claimedAt,
      input.leaseExpiresAt,
      input.claimedAt,
      projectId,
      input.claimedAt,
      input.workerId,
      input.workerId,
      input.workerId,
      input.staleBefore,
      input.workerId,
      input.computerUseProvidersJson ?? "[]",
      input.workerId,
      input.agentProvider,
    )
    .first<IssueAgentReplyJobRow>();
}

export async function renewIssueAgentReplyLease(
  db: D1Database,
  projectId: string,
  jobId: string,
  input: {
    workerId: string;
    claimTokenHash: string;
    leaseExpiresAt: string;
    updatedAt: string;
  },
) {
  return await db
    .prepare(
      `update briar_issue_agent_reply_jobs
       set lease_expires_at = ?
       where id = ? and project_id = ? and status = 'running'
         and claimed_worker_id = ? and claim_token_hash = ?
         and lease_expires_at > ?
         and exists (
           select 1 from briar_hunt_runs run
           where run.id = briar_issue_agent_reply_jobs.run_id
             and run.project_id = briar_issue_agent_reply_jobs.project_id
         )
       returning *`,
    )
    .bind(
      input.leaseExpiresAt,
      jobId,
      projectId,
      input.workerId,
      input.claimTokenHash,
      input.updatedAt,
    )
    .first<IssueAgentReplyJobRow>();
}

export async function getClaimedIssueAgentReply(
  db: D1Database,
  projectId: string,
  jobId: string,
  input: {
    workerId: string;
    claimTokenHash: string;
    observedAt: string;
  },
) {
  return await db
    .prepare(
      `select job.*
       from briar_issue_agent_reply_jobs job
       join briar_hunt_runs run
         on run.id = job.run_id and run.project_id = job.project_id
       where job.id = ? and job.project_id = ? and job.status = 'running'
         and job.claimed_worker_id = ? and job.claim_token_hash = ?
         and job.lease_expires_at > ?`,
    )
    .bind(
      jobId,
      projectId,
      input.workerId,
      input.claimTokenHash,
      input.observedAt,
    )
    .first<IssueAgentReplyJobRow>();
}

export async function failIssueAgentReply(
  db: D1Database,
  projectId: string,
  jobId: string,
  input: {
    workerId: string;
    claimTokenHash: string;
    error: string;
    updatedAt: string;
    commit?: ReplyCompletionCommit;
  },
) {
  const transition = db.prepare(
      `update briar_issue_agent_reply_jobs
       set status = case when attempts >= 3 then 'failed' else 'queued' end,
           preferred_worker_id = case
             when requires_preferred_worker = 1 then preferred_worker_id
             else null
           end,
           ${input.commit
             ? ""
             : "claim_token_hash = null, claimed_at = null, lease_expires_at = null,"}
           error = ?, updated_at = ?
       where id = ? and project_id = ? and status = 'running'
         and claimed_worker_id = ? and claim_token_hash = ?
         and lease_expires_at > ?
         and exists (
           select 1 from briar_hunt_runs run
           where run.id = briar_issue_agent_reply_jobs.run_id
             and run.project_id = briar_issue_agent_reply_jobs.project_id
         )
       returning *`,
    )
    .bind(
      input.error,
      input.updatedAt,
      jobId,
      projectId,
      input.workerId,
      input.claimTokenHash,
      input.updatedAt,
    );
  if (!input.commit) return transition.first<IssueAgentReplyJobRow>();
  const [transitioned, receipt] = await db.batch([
    transition,
    replyCompletionReceiptStatement(db, {
      ...input.commit,
      createdAt: input.updatedAt,
    }),
    db.prepare(
      `update briar_issue_agent_reply_jobs
       set claim_token_hash = null, claimed_at = null, lease_expires_at = null
       where id = ? and project_id = ? and claimed_worker_id = ?
         and claim_token_hash = ? and status in ('queued', 'failed')
         and updated_at = ?`,
    ).bind(
      jobId,
      projectId,
      input.workerId,
      input.claimTokenHash,
      input.updatedAt,
    ),
  ]);
  const failed = transitioned.results[0] as IssueAgentReplyJobRow | undefined;
  if (failed && !receipt.results[0]) {
    throw new Error("Issue reply failure receipt was not committed atomically");
  }
  return failed
    ? { ...failed, claim_token_hash: null, claimed_at: null, lease_expires_at: null }
    : null;
}

export async function completeIssueAgentReply(
  db: D1Database,
  projectId: string,
  jobId: string,
  input: {
    workerId: string;
    claimTokenHash: string;
    completedAt: string;
  },
) {
  return await db
    .prepare(
      `update briar_issue_agent_reply_jobs
       set status = 'completed', claim_token_hash = null,
           lease_expires_at = null, completed_at = ?, updated_at = ?
       where id = ? and project_id = ? and status = 'running'
         and claimed_worker_id = ? and claim_token_hash = ?
         and lease_expires_at > ?
         and exists (
           select 1 from briar_hunt_runs run
           where run.id = briar_issue_agent_reply_jobs.run_id
             and run.project_id = briar_issue_agent_reply_jobs.project_id
         )
       returning *`,
    )
    .bind(
      input.completedAt,
      input.completedAt,
      jobId,
      projectId,
      input.workerId,
      input.claimTokenHash,
      input.completedAt,
    )
    .first<IssueAgentReplyJobRow>();
}
