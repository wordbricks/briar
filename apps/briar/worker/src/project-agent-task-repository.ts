import {
  hydrateAgentSkills,
  type AgentSkillEffort,
  type AgentSkillKind,
  type AgentSkillRow,
} from "./agent-skills";

import { agentSkillExecutionApprovalTablesAvailable } from "./execution-approval-schema-repository";
import {
  type ClaimedProjectAgentTaskRow,
  type ProjectAgentProvider,
  type ProjectAgentTaskCompletionReceiptRow,
  type ProjectAgentTaskJobRow,
} from "./project-agent-model";

export async function createProjectAgentTaskJob(
  db: D1Database,
  input: {
    id: string;
    projectId: string;
    agentId: string;
    skill: Pick<
      AgentSkillRow,
      "id" | "body" | "provider" | "model" | "effort"
    >;
    request: string;
    requestId: string;
    workerId: string;
    createdAt: string;
  },
) {
  const inserted = await db
    .prepare(
      `insert into briar_project_agent_task_jobs (
         id, project_id, agent_id, skill_id, request, request_id, status,
         preferred_worker_id, created_at, updated_at
       )
       select ?, ?, ?, skill.id, ?, ?, 'queued', ?, ?, ?
       from briar_agent_skills skill
       where skill.id = ? and skill.agent_id = ?
         and skill.body is ?
         and skill.provider is ?
         and skill.model is ?
         and skill.effort is ?`,
    )
    .bind(
      input.id,
      input.projectId,
      input.agentId,
      input.request,
      input.requestId,
      input.workerId,
      input.createdAt,
      input.createdAt,
      input.skill.id,
      input.agentId,
      input.skill.body,
      input.skill.provider,
      input.skill.model,
      input.skill.effort,
    )
    .run();
  if ((inserted.meta.changes ?? 0) < 1) return null;
  return getProjectAgentTaskJob(db, input.projectId, input.id);
}

export async function getProjectAgentTaskJob(
  db: D1Database,
  projectId: string,
  jobId: string,
) {
  return db
    .prepare(
      `select * from briar_project_agent_task_jobs
       where project_id = ? and id = ?`,
    )
    .bind(projectId, jobId)
    .first<ProjectAgentTaskJobRow>();
}

export async function getProjectAgentTaskJobByRequest(
  db: D1Database,
  projectId: string,
  requestId: string,
) {
  return db
    .prepare(
      `select * from briar_project_agent_task_jobs
       where project_id = ? and request_id = ?`,
    )
    .bind(projectId, requestId)
    .first<ProjectAgentTaskJobRow>();
}

export async function reapProjectAgentTaskJobs(
  db: D1Database,
  projectId: string,
  input: { observedAt: string; error: string },
) {
  const result = await db
    .prepare(
      `update briar_project_agent_task_jobs
       set status = 'failed',
           error = coalesce(error, ?),
           claim_token_hash = null, claimed_at = null, lease_expires_at = null,
           completed_at = ?, updated_at = ?
       where project_id = ? and status = 'running'
         and attempts >= 3 and lease_expires_at <= ?
       returning *`,
    )
    .bind(
      input.error,
      input.observedAt,
      input.observedAt,
      projectId,
      input.observedAt,
    )
    .all<ProjectAgentTaskJobRow>();
  return result.results ?? [];
}

export async function claimNextProjectAgentTask(
  db: D1Database,
  projectId: string,
  input: {
    workerId: string;
    agentProviders: ProjectAgentProvider[];
    claimTokenHash: string;
    claimedAt: string;
    leaseExpiresAt: string;
  },
) {
  const providerPlaceholders = input.agentProviders.map(() => "?").join(", ");
  // Migration 0092 is a deployment prerequisite, so this hot path never
  // probes schema metadata or drops the approval guard.
  const skillExecutionEligibility = `and (
         job.skill_execution_proposal_id is null
         or exists (
           select 1
           from briar_agent_skill_execution_approval_audit approval
           where approval.proposal_id = job.skill_execution_proposal_id
             and approval.project_id = job.project_id
             and approval.result_session_id = job.id
             and approval.agent_id = job.agent_id
             and approval.skill_id = job.skill_id
             and approval.request = job.request
             and approval.proposal_id = job.request_id
             and approval.worker_id = job.preferred_worker_id
         )
       )`;
  const claimed = await db
    .prepare(
      `update briar_project_agent_task_jobs
       set status = 'running', claimed_worker_id = ?,
           claim_token_hash = ?, claimed_at = ?, lease_expires_at = ?,
           attempts = attempts + case when planned_update_resume = 1 then 0 else 1 end,
           planned_update_resume = 0, error = null, updated_at = ?
       where id = (
         select job.id
         from briar_project_agent_task_jobs job
         join briar_project_agents agent on agent.id = job.agent_id
         join briar_agent_skills skill
           on skill.agent_id = agent.id
          and skill.id = job.skill_id
         where job.project_id = ?
           and job.preferred_worker_id = ?
           and skill.provider in (${providerPlaceholders})
           ${skillExecutionEligibility}
           and exists (
             select 1
             from briar_execution_workers selected_worker
             join briar_execution_worker_devices selected_device
               on selected_device.id = selected_worker.device_id
             where selected_worker.id = ?
               and (
                 (select count(*)
                  from briar_hunt_runs active
                  join briar_execution_workers holder
                    on holder.id = active.worker_id
                  where holder.device_id = selected_device.id
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
                 where holder.device_id = selected_device.id
                    and active_task.status = 'running'
                    and active_task.lease_expires_at > ?)
                 +
                 (select count(*)
                  from briar_merge_batches active_batch
                  join briar_execution_workers holder
                    on holder.id = active_batch.claimed_worker_id
                  where holder.device_id = selected_device.id
                    and active_batch.claim_token_hash is not null
                    and active_batch.lease_expires_at > ?
                    and active_batch.state in (
                      'enqueueing', 'waiting_tail', 'validating',
                      'publishing', 'draining'
                    ))
               ) < selected_device.max_concurrent_sessions
           )
           and job.attempts < 3
           and (
             job.status = 'queued'
             or (job.status = 'running' and job.lease_expires_at <= ?)
           )
         order by job.created_at, job.id
         limit 1
       )
       returning *`,
    )
    .bind(
      input.workerId,
      input.claimTokenHash,
      input.claimedAt,
      input.leaseExpiresAt,
      input.claimedAt,
      projectId,
      input.workerId,
      ...input.agentProviders,
      input.workerId,
      input.claimedAt,
      input.claimedAt,
      input.claimedAt,
      input.claimedAt,
    )
    .first<ProjectAgentTaskJobRow>()
    .catch((error: unknown) => {
      if (
        error instanceof Error &&
        error.message.includes(
          "Agent Skill execution approval audit is missing or stale",
        )
      ) {
        return null;
      }
      throw error;
    });
  if (!claimed) return null;
  if (claimed.skill_execution_proposal_id) {
    const approval = await db
      .prepare(
        `select approval.*, skill.description as skill_description
         from briar_agent_skill_execution_approval_audit approval
         join briar_agent_skills skill
           on skill.id = approval.skill_id
          and skill.agent_id = approval.agent_id
         where approval.proposal_id = ? and approval.project_id = ?
           and approval.result_session_id = ?
           and approval.agent_id = ? and approval.skill_id = ?
           and approval.request = ? and approval.worker_id = ?`,
      )
      .bind(
        claimed.skill_execution_proposal_id,
        claimed.project_id,
        claimed.id,
        claimed.agent_id,
        claimed.skill_id,
        claimed.request,
        input.workerId,
      )
      .first<{
        agent_name: string;
        agent_responsibility: string;
        skill_id: string;
        skill_name: string;
        skill_description: string;
        skill_instructions: string;
        skill_kind: AgentSkillKind;
        provider: ProjectAgentProvider;
        model: string | null;
        effort: AgentSkillEffort | null;
        execution_mode: "conversation" | "task";
        approval_policy: "invoke_is_consent" | "explicit";
        approved_at: string;
      }>();
    if (!approval) {
      throw new Error(
        "Agent Skill execution approval snapshot disappeared after claim",
      );
    }
    const approvedSkill: AgentSkillRow = {
      id: approval.skill_id,
      agent_id: claimed.agent_id,
      name: approval.skill_name,
      description: approval.skill_description,
      body: approval.skill_instructions,
      provider: approval.provider,
      model: approval.model,
      effort: approval.effort,
      kind: approval.skill_kind,
      execution_mode: approval.execution_mode,
      approval_policy: approval.approval_policy,
      is_default: 0,
      position: 0,
      created_at: approval.approved_at,
      updated_at: approval.approved_at,
    };
    return {
      ...claimed,
      agent_name: approval.agent_name,
      agent_provider: approval.provider,
      agent_model: approval.model,
      agent_effort: approval.effort,
      agent_responsibility: approval.agent_responsibility,
      agent_skill: approval.skill_instructions,
      selected_skill_id: approval.skill_id,
      selected_skill_name: approval.skill_name,
      selected_skill_instructions: approval.skill_instructions,
      agent_skills: [approvedSkill],
    };
  }
  const selected = await db
    .prepare(
      `select job.*, agent.name as agent_name, skill.provider as agent_provider,
              skill.model as agent_model, skill.effort as agent_effort,
              agent.responsibility as agent_responsibility,
              skill.body as agent_skill,
              skill.id as selected_skill_id,
              skill.name as selected_skill_name,
              skill.body as selected_skill_instructions
       from briar_project_agent_task_jobs job
       join briar_project_agents agent on agent.id = job.agent_id
       join briar_agent_skills skill
         on skill.agent_id = agent.id
        and skill.id = job.skill_id
       where job.id = ? and job.project_id = ?`,
    )
    .bind(claimed.id, projectId)
    .first<Omit<ClaimedProjectAgentTaskRow, "agent_skills">>();
  if (!selected) return null;
  const agentSkills = await hydrateAgentSkills(db, [{ id: selected.agent_id }]);
  return { ...selected, agent_skills: agentSkills[0].skills };
}

export async function getClaimedProjectAgentTask(
  db: D1Database,
  projectId: string,
  jobId: string,
  input: { workerId: string; claimTokenHash: string },
) {
  return db
    .prepare(
      `select * from briar_project_agent_task_jobs
       where id = ? and project_id = ? and status = 'running'
         and claimed_worker_id = ? and claim_token_hash = ?`,
    )
    .bind(jobId, projectId, input.workerId, input.claimTokenHash)
    .first<ProjectAgentTaskJobRow>();
}

export async function renewProjectAgentTaskLease(
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
  return db
    .prepare(
      `update briar_project_agent_task_jobs
       set lease_expires_at = ?
       where id = ? and project_id = ? and status = 'running'
         and claimed_worker_id = ? and claim_token_hash = ?
       returning *`,
    )
    .bind(
      input.leaseExpiresAt,
      jobId,
      projectId,
      input.workerId,
      input.claimTokenHash,
    )
    .first<ProjectAgentTaskJobRow>();
}

export async function completeProjectAgentTaskWithReceipt(
  db: D1Database,
  projectId: string,
  jobId: string,
  input: {
    workerId: string;
    claimTokenHash: string;
    updatedAt: string;
    summary?: string | null;
    conversationId?: string | null;
    error?: string;
  },
) {
  const approvalColumnsAvailable =
    await agentSkillExecutionApprovalTablesAvailable(db);
  const resultProjection = approvalColumnsAvailable
    ? `result_summary = ?, result_conversation_id = ?,`
    : "";
  const completionStatement = (receiptId: string | null) => db
    .prepare(
      `update briar_project_agent_task_jobs as task
       set status = case when ? is null then 'completed' else
         case when attempts >= 3 then 'failed' else 'queued' end end,
           error = ?,
           ${resultProjection}
           claim_token_hash = null, claimed_worker_id = null,
           claimed_at = null, lease_expires_at = null,
           completed_at = case when ? is null then ? else
             case when attempts >= 3 then ? else null end end,
           updated_at = ?
       where id = ? and project_id = ? and status = 'running'
         and claimed_worker_id = ? and claim_token_hash = ?
         ${receiptId
           ? `and exists (
                select 1
                from briar_project_agent_task_completion_receipts receipt
                where receipt.id = ?
                  and receipt.project_id = task.project_id
                  and receipt.task_id = task.id
                  and receipt.worker_id = task.claimed_worker_id
                  and receipt.claim_token_hash = task.claim_token_hash
              )`
           : ""}
       returning *`,
    )
    .bind(
      input.error ?? null,
      input.error ?? null,
      ...(approvalColumnsAvailable
        ? [input.summary ?? null, input.conversationId ?? null]
        : []),
      input.error ?? null,
      input.updatedAt,
      input.updatedAt,
      input.updatedAt,
      jobId,
      projectId,
      input.workerId,
      input.claimTokenHash,
      ...(receiptId ? [receiptId] : []),
    );
  if (!approvalColumnsAvailable) {
    const job = await completionStatement(null).first<ProjectAgentTaskJobRow>();
    return job ? { job, receipt: null, replayed: false } : null;
  }

  const summary = input.summary ?? null;
  const conversationId = input.conversationId ?? null;
  const error = input.error ?? null;
  const receiptId = crypto.randomUUID();
  const receiptStatement = db
    .prepare(
      `insert into briar_project_agent_task_completion_receipts (
         id, organization_id, project_id, task_id,
         skill_execution_proposal_id, worker_id, claim_token_hash,
         outcome_status, summary, conversation_id, error,
         completed_at, created_at
       )
       select ?, project.organization_id, task.project_id, task.id,
              task.skill_execution_proposal_id, task.claimed_worker_id,
              task.claim_token_hash,
              case when ? is null then 'completed'
                else case when task.attempts >= 3 then 'failed'
                  else 'queued' end end,
              ?, ?, ?, ?, ?
       from briar_project_agent_task_jobs task
       join briar_teams project on project.id = task.project_id
       where task.id = ? and task.project_id = ? and task.status = 'running'
         and task.claimed_worker_id = ? and task.claim_token_hash = ?
       on conflict (project_id, task_id, worker_id, claim_token_hash)
       do nothing
       returning *`,
    )
    .bind(
      receiptId,
      error,
      summary,
      conversationId,
      error,
      input.updatedAt,
      input.updatedAt,
      jobId,
      projectId,
      input.workerId,
      input.claimTokenHash,
    );
  const [receiptResult, completionResult] = await db.batch([
    receiptStatement,
    completionStatement(receiptId),
  ]);
  const receipt = receiptResult.results[0] as
    | ProjectAgentTaskCompletionReceiptRow
    | undefined;
  const job = completionResult.results[0] as ProjectAgentTaskJobRow | undefined;
  if (receipt && job) {
    return { job, receipt, replayed: false };
  }
  if (receipt || job) {
    throw new Error("Project Agent task completion was not atomic");
  }
  const existing = await db
    .prepare(
      `select * from briar_project_agent_task_completion_receipts
       where project_id = ? and task_id = ? and worker_id = ?
         and claim_token_hash = ?`,
    )
    .bind(projectId, jobId, input.workerId, input.claimTokenHash)
    .first<ProjectAgentTaskCompletionReceiptRow>();
  if (
    !existing || existing.summary !== summary ||
    existing.conversation_id !== conversationId || existing.error !== error
  ) {
    return null;
  }
  return {
    job: await getProjectAgentTaskJob(db, projectId, jobId),
    receipt: existing,
    replayed: true,
  };
}

export async function completeProjectAgentTask(
  db: D1Database,
  projectId: string,
  jobId: string,
  input: {
    workerId: string;
    claimTokenHash: string;
    updatedAt: string;
    summary?: string | null;
    conversationId?: string | null;
    error?: string;
  },
) {
  return (await completeProjectAgentTaskWithReceipt(
    db,
    projectId,
    jobId,
    input,
  ))?.job ?? null;
}
