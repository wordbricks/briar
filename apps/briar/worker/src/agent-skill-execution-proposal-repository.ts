import { type AgentSkillKind } from "./agent-skills";
import type {
  AgentSkillApprovalPolicy,
  AgentSkillExecutionMode,
} from "../../src/lib/channels-contract";

import {
  type ModelEffort,
  type ProjectAgentProvider,
  type ProjectAgentTaskJobRow,
} from "./project-agent-model";

export type AgentSkillExecutionProposalRow = {
  id: string;
  organization_id: string;
  project_id: string;
  source_kind: "channel" | "issue";
  channel_id: string | null;
  conversation_run_id: string | null;
  trigger_message_id: string;
  reply_message_id: string;
  source_reply_job_id: string;
  delegated_by_reply_job_id: string | null;
  agent_id: string;
  agent_name: string;
  agent_responsibility: string;
  skill_id: string;
  skill_name: string;
  skill_instructions: string;
  skill_kind: AgentSkillKind;
  provider: ProjectAgentProvider;
  model: string | null;
  effort: ModelEffort | null;
  execution_mode: AgentSkillExecutionMode;
  approval_policy: AgentSkillApprovalPolicy;
  thread_root_message_id: string | null;
  request: string;
  delegated_by_agent_id: string | null;
  delegated_by_agent_name: string | null;
  generation: number;
  status: "pending" | "accepted" | "invalidated";
  requested_worker_id: string | null;
  requested_worker_label: string | null;
  result_session_id: string | null;
  result_reply_job_id: string | null;
  result_message_id: string | null;
  execution_status: "waiting" | "running" | "completed" | "failed";
  execution_error: string | null;
  accepted_by_user_id: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AgentSkillExecutionApprovalAuditRow = {
  id: string;
  proposal_id: string;
  organization_id: string;
  project_id: string;
  source_kind: "channel" | "issue";
  channel_id: string | null;
  conversation_run_id: string | null;
  trigger_message_id: string;
  reply_message_id: string;
  source_reply_job_id: string;
  delegated_by_reply_job_id: string | null;
  agent_id: string;
  agent_name: string;
  agent_responsibility: string;
  skill_id: string;
  skill_name: string;
  skill_instructions: string;
  skill_kind: AgentSkillKind;
  provider: ProjectAgentProvider;
  model: string | null;
  effort: ModelEffort | null;
  execution_mode: AgentSkillExecutionMode;
  approval_policy: AgentSkillApprovalPolicy;
  thread_root_message_id: string | null;
  request: string;
  worker_id: string;
  worker_label: string;
  result_session_id: string;
  result_reply_job_id: string | null;
  result_message_id: string | null;
  approved_by_user_id: string | null;
  approved_at: string;
  delegated_by_agent_id: string | null;
  delegated_by_agent_name: string | null;
  created_at: string;
};

export async function listIssueAgentSkillExecutionProposals(
  db: D1Database,
  projectId: string,
  conversationRunId: string,
) {
  const rows = await db
    .prepare(
      `select proposal.*,
              case
                when proposal.status = 'pending' then 'waiting'
                when proposal.execution_mode = 'task' then coalesce((
                  select case task.status
                    when 'completed' then 'completed'
                    when 'failed' then 'failed'
                    else 'running' end
                  from briar_project_agent_task_jobs task
                  where task.id = proposal.result_session_id
                ), 'running')
                else coalesce((
                  select case reply.status
                    when 'completed' then 'completed'
                    when 'failed' then 'failed'
                    else 'running' end
                  from briar_channel_agent_reply_jobs reply
                  where reply.id = proposal.result_reply_job_id
                ), 'running')
              end as execution_status,
              case when proposal.execution_mode = 'task' then (
                select task.error from briar_project_agent_task_jobs task
                where task.id = proposal.result_session_id
              ) else (
                select reply.error from briar_channel_agent_reply_jobs reply
                where reply.id = proposal.result_reply_job_id
              ) end as execution_error
       from briar_agent_skill_execution_proposals proposal
       join briar_hunt_runs conversation
         on conversation.id = proposal.conversation_run_id
        and conversation.project_id = proposal.project_id
       where proposal.source_kind = 'issue'
         and proposal.project_id = ? and proposal.conversation_run_id = ?
         and proposal.status in ('pending', 'accepted')
       order by proposal.created_at, proposal.id`,
    )
    .bind(projectId, conversationRunId)
    .all<AgentSkillExecutionProposalRow>();
  return rows.results;
}

export async function getIssueAgentSkillExecutionProposal(
  db: D1Database,
  projectId: string,
  conversationRunId: string,
  proposalId: string,
) {
  return db
    .prepare(
      `select proposal.*,
              case
                when proposal.status = 'pending' then 'waiting'
                when proposal.execution_mode = 'task' then coalesce((
                  select case task.status when 'completed' then 'completed'
                    when 'failed' then 'failed' else 'running' end
                  from briar_project_agent_task_jobs task
                  where task.id = proposal.result_session_id
                ), 'running')
                else coalesce((
                  select case reply.status when 'completed' then 'completed'
                    when 'failed' then 'failed' else 'running' end
                  from briar_channel_agent_reply_jobs reply
                  where reply.id = proposal.result_reply_job_id
                ), 'running')
              end as execution_status,
              case when proposal.execution_mode = 'task' then (
                select task.error from briar_project_agent_task_jobs task
                where task.id = proposal.result_session_id
              ) else (
                select reply.error from briar_channel_agent_reply_jobs reply
                where reply.id = proposal.result_reply_job_id
              ) end as execution_error
       from briar_agent_skill_execution_proposals proposal
       join briar_hunt_runs conversation
         on conversation.id = proposal.conversation_run_id
        and conversation.project_id = proposal.project_id
       where proposal.id = ? and proposal.source_kind = 'issue'
         and proposal.project_id = ? and proposal.conversation_run_id = ?`,
    )
    .bind(proposalId, projectId, conversationRunId)
    .first<AgentSkillExecutionProposalRow>();
}

export async function getAgentSkillExecutionApprovalAudit(
  db: D1Database,
  projectId: string,
  proposalId: string,
) {
  return db
    .prepare(
      `select * from briar_agent_skill_execution_approval_audit
       where project_id = ? and proposal_id = ?`,
    )
    .bind(projectId, proposalId)
    .first<AgentSkillExecutionApprovalAuditRow>();
}

export async function acceptAgentSkillExecutionProposal(
  db: D1Database,
  input: {
    proposalId: string;
    sourceKind: "channel" | "issue";
    organizationId: string;
    projectId: string;
    channelId: string | null;
    conversationRunId: string | null;
    userId: string;
    workerId: string;
    workerLabel: string;
    resultSessionId: string;
    resultReplyJobId?: string | null;
    resultMessageId?: string | null;
    acceptedAt: string;
  },
) {
  return db
    .prepare(
      `update briar_agent_skill_execution_proposals
       set status = 'accepted', requested_worker_id = ?,
           requested_worker_label = ?, result_session_id = ?,
           result_reply_job_id = ?, result_message_id = ?,
           accepted_by_user_id = ?, accepted_at = ?, updated_at = ?
       where id = ? and source_kind = ? and organization_id = ?
         and project_id = ? and channel_id is ? and conversation_run_id is ?
         and status = 'pending'
       returning *`,
    )
    .bind(
      input.workerId,
      input.workerLabel,
      input.resultSessionId,
      input.resultReplyJobId ?? null,
      input.resultMessageId ?? null,
      input.userId,
      input.acceptedAt,
      input.acceptedAt,
      input.proposalId,
      input.sourceKind,
      input.organizationId,
      input.projectId,
      input.channelId,
      input.conversationRunId,
    )
    .first<AgentSkillExecutionProposalRow>();
}

export async function acceptConversationAgentSkillExecutionProposal(
  db: D1Database,
  input: {
    proposal: AgentSkillExecutionProposalRow;
    userId: string;
    workerId: string;
    workerLabel: string;
    resultSessionId: string;
    resultReplyJobId: string;
    resultMessageId: string;
    acceptedAt: string;
  },
) {
  const proposal = input.proposal;
  const [accepted] = await db.batch([
    db.prepare(
      `update briar_agent_skill_execution_proposals
       set status = 'accepted', requested_worker_id = ?,
           requested_worker_label = ?, result_session_id = ?,
           result_reply_job_id = ?, result_message_id = ?,
           accepted_by_user_id = ?, accepted_at = ?, updated_at = ?
       where id = ? and source_kind = 'channel' and organization_id = ?
         and project_id = ? and channel_id is ? and conversation_run_id is null
         and execution_mode = 'conversation' and approval_policy = 'explicit'
         and status = 'pending'
       returning *`,
    ).bind(
      input.workerId,
      input.workerLabel,
      input.resultSessionId,
      input.resultReplyJobId,
      input.resultMessageId,
      input.userId,
      input.acceptedAt,
      input.acceptedAt,
      proposal.id,
      proposal.organization_id,
      proposal.project_id,
      proposal.channel_id,
    ),
    db.prepare(
      `insert into briar_agent_skill_execution_approval_audit (
         id, proposal_id, organization_id, project_id, source_kind, channel_id,
         conversation_run_id, trigger_message_id, reply_message_id,
         source_reply_job_id, delegated_by_reply_job_id, agent_id, agent_name,
         agent_responsibility, skill_id, skill_name, skill_instructions,
         skill_kind, provider, model, effort, request, worker_id, worker_label,
         result_session_id, approved_by_user_id, approved_at,
         delegated_by_agent_id, delegated_by_agent_name, created_at,
         execution_mode, approval_policy, thread_root_message_id,
         result_reply_job_id, result_message_id
       )
       select proposal.id || ':approval:' || proposal.generation,
              proposal.id, proposal.organization_id, proposal.project_id,
              proposal.source_kind, proposal.channel_id,
              proposal.conversation_run_id, proposal.trigger_message_id,
              proposal.reply_message_id, proposal.source_reply_job_id,
              proposal.delegated_by_reply_job_id, proposal.agent_id,
              proposal.agent_name, proposal.agent_responsibility,
              proposal.skill_id, proposal.skill_name,
              proposal.skill_instructions, proposal.skill_kind,
              proposal.provider, proposal.model, proposal.effort,
              proposal.request, proposal.requested_worker_id,
              proposal.requested_worker_label, proposal.result_session_id,
              proposal.accepted_by_user_id, proposal.accepted_at,
              proposal.delegated_by_agent_id, proposal.delegated_by_agent_name,
              proposal.accepted_at, proposal.execution_mode,
              proposal.approval_policy, proposal.thread_root_message_id,
              proposal.result_reply_job_id, proposal.result_message_id
       from briar_agent_skill_execution_proposals proposal
       where proposal.id = ? and proposal.status = 'accepted'
         and proposal.result_reply_job_id = ?`,
    ).bind(proposal.id, input.resultReplyJobId),
    db.prepare(
      `insert into briar_channel_agent_reply_jobs (
         id, organization_id, channel_id, project_id, agent_id, skill_id,
         selected_skill_id_snapshot, selected_agent_name_snapshot,
         selected_agent_responsibility_snapshot,
         selected_skill_name_snapshot, selected_skill_instructions_snapshot,
         selected_skill_kind_snapshot, selected_skill_provider_snapshot,
         selected_skill_model_snapshot, selected_skill_effort_snapshot,
         skill_execution_request_snapshot, session_id, trigger_message_id,
         parent_message_id, reply_message_id, agent_provider,
         preferred_device_id, approved_skill_execution_proposal_id,
         created_at, updated_at
       )
       select proposal.result_reply_job_id, proposal.organization_id,
              proposal.channel_id, proposal.project_id, proposal.agent_id,
              proposal.skill_id, proposal.skill_id, proposal.agent_name,
              proposal.agent_responsibility, proposal.skill_name,
              proposal.skill_instructions, proposal.skill_kind,
              proposal.provider, proposal.model, proposal.effort,
              proposal.request, source.session_id, proposal.reply_message_id,
              proposal.thread_root_message_id, proposal.result_message_id,
              session.provider, worker.device_id, proposal.id,
              proposal.accepted_at, proposal.accepted_at
       from briar_agent_skill_execution_proposals proposal
       join briar_channel_agent_reply_jobs source
         on source.id = proposal.source_reply_job_id
        and source.channel_id = proposal.channel_id
        and source.session_id = proposal.result_session_id
       join briar_channel_reply_sessions session
         on session.id = source.session_id
        and session.channel_id = proposal.channel_id
        and session.thread_root_message_id = proposal.thread_root_message_id
        and session.agent_id = proposal.agent_id
       join briar_execution_workers worker
         on worker.id = proposal.requested_worker_id
       where proposal.id = ? and proposal.status = 'accepted'
         and proposal.execution_mode = 'conversation'
         and source.status = 'completed'`,
    ).bind(proposal.id),
    db.prepare(
      `insert into briar_channel_reply_session_events (
         id, session_id, reply_job_id, event_type, reason,
         retained_until, detail_json, occurred_at
       )
       select ?, proposal.result_session_id, proposal.result_reply_job_id,
              'ttl_renewed', 'approved_skill_enqueued',
              session.retained_until,
              json_object('proposalId', proposal.id), proposal.accepted_at
       from briar_agent_skill_execution_proposals proposal
       join briar_channel_reply_sessions session
         on session.id = proposal.result_session_id
       where proposal.id = ? and proposal.status = 'accepted'`,
    ).bind(crypto.randomUUID(), proposal.id),
  ]);
  return (accepted.results[0] as AgentSkillExecutionProposalRow | undefined) ??
    null;
}

export async function publishAgentSkillTaskResult(
  db: D1Database,
  task: ProjectAgentTaskJobRow,
  publishedAt: string,
) {
  if (
    !task.skill_execution_proposal_id ||
    (task.status !== "completed" && task.status !== "failed")
  ) return null;
  const messageId = crypto.randomUUID();
  const outcome = task.status === "completed" ? "completed" : "failed";
  const detail = task.status === "completed"
    ? task.result_summary?.trim() || "The Skill completed without a summary."
    : task.error?.trim() || "The Skill failed without an error summary.";
  const sessionLink = `briar-companion://sessions/${task.project_id}/${task.id}`;
  const boundedDetail = detail.slice(0, 9_000);
  const body = [
    task.status === "completed"
      ? "**Skill execution completed**"
      : "**Skill execution failed**",
    boundedDetail,
    `[View Agent Session](${sessionLink})`,
  ].join("\n\n");
  const [updated] = await db.batch([
    db.prepare(
      `update briar_agent_skill_execution_proposals
       set result_message_id = ?, updated_at = ?
       where id = ? and project_id = ? and execution_mode = 'task'
         and status = 'accepted' and result_session_id = ?
         and result_message_id is null
         and exists (
           select 1 from briar_project_agent_task_jobs task
           where task.id = briar_agent_skill_execution_proposals.result_session_id
             and task.skill_execution_proposal_id =
               briar_agent_skill_execution_proposals.id
             and task.status = ?
         )
       returning *`,
    ).bind(
      messageId,
      publishedAt,
      task.skill_execution_proposal_id,
      task.project_id,
      task.id,
      outcome,
    ),
    db.prepare(
      `insert into briar_channel_messages (
         id, channel_id, parent_message_id, author_user_id, author_agent_id,
         author_agent_name, author_agent_provider, body, created_at, updated_at
       )
       select proposal.result_message_id, proposal.channel_id,
              proposal.thread_root_message_id, null, proposal.agent_id,
              proposal.agent_name, proposal.provider, ?, ?, ?
       from briar_agent_skill_execution_proposals proposal
       where proposal.id = ? and proposal.source_kind = 'channel'
         and proposal.result_message_id = ?
         and exists (
           select 1 from briar_channel_messages root
           where root.id = proposal.thread_root_message_id
             and root.channel_id = proposal.channel_id
             and root.parent_message_id is null
         )`,
    ).bind(
      body,
      publishedAt,
      publishedAt,
      task.skill_execution_proposal_id,
      messageId,
    ),
    db.prepare(
      `insert into briar_issue_messages (
         id, project_id, run_id, parent_message_id, author_user_id,
         author_agent_id, author_agent_name, author_agent_provider,
         body, created_at, updated_at
       )
       select proposal.result_message_id, proposal.project_id,
              proposal.conversation_run_id, proposal.thread_root_message_id,
              null, proposal.agent_id, proposal.agent_name,
              proposal.provider, ?, ?, ?
       from briar_agent_skill_execution_proposals proposal
       where proposal.id = ? and proposal.source_kind = 'issue'
         and proposal.result_message_id = ?
         and exists (
           select 1 from briar_issue_messages root
           where root.id = proposal.thread_root_message_id
             and root.project_id = proposal.project_id
             and root.run_id = proposal.conversation_run_id
         )`,
    ).bind(
      body,
      publishedAt,
      publishedAt,
      task.skill_execution_proposal_id,
      messageId,
    ),
  ]);
  const proposal = updated.results[0] as
    | AgentSkillExecutionProposalRow
    | undefined;
  if (proposal) return proposal;
  return db.prepare(
    `select * from briar_agent_skill_execution_proposals
     where id = ? and project_id = ? and status = 'accepted'
       and execution_mode = 'task' and result_session_id = ?
       and result_message_id is not null`,
  ).bind(
    task.skill_execution_proposal_id,
    task.project_id,
    task.id,
  ).first<AgentSkillExecutionProposalRow>();
}
