import { issueExecutionApprovalTablesAvailable } from "./execution-approval-schema-repository";
import {
  type ModelEffort,
  type ProjectAgentProvider,
} from "./project-agent-model";

export type IssueExecutionProposalRow = {
  id: string;
  organization_id: string;
  project_id: string;
  source_kind: "channel" | "issue";
  channel_id: string | null;
  conversation_run_id: string | null;
  trigger_message_id: string;
  reply_message_id: string;
  target_run_id: string;
  target_title: string;
  target_run_updated_at: string;
  proposed_by_agent_id: string | null;
  delegated_by_agent_id: string | null;
  delegated_by_agent_name: string | null;
  origin_create_proposal_id: string | null;
  generation: number;
  status: "pending" | "accepted" | "invalidated";
  approval_reserved_by_user_id: string | null;
  approval_reserved_at: string | null;
  requested_provider: ProjectAgentProvider | null;
  requested_model: string | null;
  requested_effort: ModelEffort | null;
  requested_worker_id: string | null;
  dispatch_request_id: string | null;
  accepted_by_user_id: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type FreshBacklogExecutionTargetRow = {
  id: string;
  run_number: number;
  source_key: string;
  title: string;
  status: "backlog";
};

export async function createIssueExecutionProposal(
  db: D1Database,
  input: {
    id: string;
    projectId: string;
    conversationRunId: string;
    triggerMessageId: string;
    replyMessageId: string;
    createdAt: string;
  },
) {
  return db
    .prepare(
      `insert into briar_issue_execution_proposals (
         id, organization_id, project_id, source_kind, channel_id,
         conversation_run_id, trigger_message_id, reply_message_id,
         target_run_id, target_title, target_run_updated_at,
         proposed_by_agent_id, delegated_by_agent_id,
         delegated_by_agent_name, created_at, updated_at
       )
       select ?, project.organization_id, run.project_id, 'issue', null,
              run.id, ?, ?, run.id, run.title, run.updated_at,
              job.agent_id, null, null, ?, ?
       from briar_hunt_runs run
       join briar_projects project on project.id = run.project_id
       join briar_issue_agent_reply_jobs job
         on job.project_id = run.project_id and job.run_id = run.id
        and job.trigger_message_id = ? and job.reply_message_id = ?
       where run.id = ? and run.project_id = ?
         and run.status = 'backlog' and run.stage = 'queued'
         and run.workflow_stage is null
         and run.worker_id is null and run.requested_worker_id is null
         and run.claim_token_hash is null and run.claimed_by is null
         and run.claimed_at is null and run.lease_expires_at is null
         and run.last_execution_id is null
         and run.dispatch_mode is null and run.dispatch_request_id is null
         and run.dispatched_at is null and run.requested_by_user_id is null
         and run.completed_at is null and run.paused_at is null
         and run.resume_requested_at is null
       on conflict (reply_message_id) do nothing
       returning *`,
    )
    .bind(
      input.id,
      input.triggerMessageId,
      input.replyMessageId,
      input.createdAt,
      input.createdAt,
      input.triggerMessageId,
      input.replyMessageId,
      input.conversationRunId,
      input.projectId,
    )
    .first<IssueExecutionProposalRow>();
}

export async function listIssueExecutionProposals(
  db: D1Database,
  projectId: string,
  conversationRunId: string,
) {
  if (!(await issueExecutionApprovalTablesAvailable(db))) return [];
  const rows = await db
    .prepare(
      `select proposal.*
       from briar_issue_execution_proposals proposal
       join briar_hunt_runs conversation
         on conversation.id = proposal.conversation_run_id
        and conversation.project_id = proposal.project_id
       where proposal.source_kind = 'issue'
         and proposal.project_id = ? and proposal.conversation_run_id = ?
         and proposal.status in ('pending', 'accepted')
       order by proposal.created_at, proposal.id`,
    )
    .bind(projectId, conversationRunId)
    .all<IssueExecutionProposalRow>();
  return rows.results;
}

export async function getIssueExecutionProposal(
  db: D1Database,
  projectId: string,
  conversationRunId: string,
  proposalId: string,
) {
  return db
    .prepare(
      `select proposal.*
       from briar_issue_execution_proposals proposal
       join briar_hunt_runs conversation
         on conversation.id = proposal.conversation_run_id
        and conversation.project_id = proposal.project_id
       where proposal.id = ? and proposal.source_kind = 'issue'
         and proposal.project_id = ? and proposal.conversation_run_id = ?`,
    )
    .bind(proposalId, projectId, conversationRunId)
    .first<IssueExecutionProposalRow>();
}

export async function reserveIssueExecutionProposalApproval(
  db: D1Database,
  input: {
    projectId: string;
    conversationRunId: string;
    proposalId: string;
    userId: string;
    provider: ProjectAgentProvider;
    model: string | null;
    effort: ModelEffort | null;
    workerId: string | null;
    dispatchRequestId: string;
    reservedAt: string;
  },
) {
  return db
    .prepare(
      `update briar_issue_execution_proposals
       set approval_reserved_by_user_id = coalesce(
             approval_reserved_by_user_id, ?
           ),
           approval_reserved_at = coalesce(approval_reserved_at, ?),
           requested_provider = coalesce(requested_provider, ?),
           requested_model = case
             when dispatch_request_id is null then ? else requested_model end,
           requested_effort = case
             when dispatch_request_id is null then ? else requested_effort end,
           requested_worker_id = case
             when dispatch_request_id is null then ? else requested_worker_id end,
           dispatch_request_id = coalesce(dispatch_request_id, ?),
           updated_at = case
             when dispatch_request_id is null then ? else updated_at end
       where id = ? and source_kind = 'issue' and status = 'pending'
         and project_id = ? and conversation_run_id = ?
         and (
           target_run_id = conversation_run_id
           or origin_create_proposal_id is not null
         )
         and (
           dispatch_request_id is null
           or (
             approval_reserved_by_user_id = ?
             and requested_provider = ? and requested_model is ?
             and requested_effort is ? and requested_worker_id is ?
           )
         )
         and exists (
           select 1
           from briar_hunt_runs run
           join briar_projects project on project.id = run.project_id
           join briar_organization_members membership
             on membership.organization_id = project.organization_id
            and membership.user_id = ?
           where run.id = briar_issue_execution_proposals.target_run_id
             and run.project_id = briar_issue_execution_proposals.project_id
             and run.updated_at =
               briar_issue_execution_proposals.target_run_updated_at
             and run.status = 'backlog' and run.stage = 'queued'
             and run.workflow_stage is null
             and run.worker_id is null and run.requested_worker_id is null
             and run.claim_token_hash is null and run.claimed_by is null
             and run.claimed_at is null and run.lease_expires_at is null
             and run.last_execution_id is null
             and run.dispatch_mode is null and run.dispatch_request_id is null
             and run.dispatched_at is null and run.requested_by_user_id is null
             and run.completed_at is null and run.paused_at is null
             and run.resume_requested_at is null
         )
       returning *`,
    )
    .bind(
      input.userId,
      input.reservedAt,
      input.provider,
      input.model,
      input.effort,
      input.workerId,
      input.dispatchRequestId,
      input.reservedAt,
      input.proposalId,
      input.projectId,
      input.conversationRunId,
      input.userId,
      input.provider,
      input.model,
      input.effort,
      input.workerId,
      input.userId,
    )
    .first<IssueExecutionProposalRow>();
}

export async function acceptIssueExecutionProposal(
  db: D1Database,
  input: {
    proposalId: string;
    projectId: string;
    userId: string;
    acceptedAt: string;
  },
) {
  return db
    .prepare(
      `update briar_issue_execution_proposals
       set status = 'accepted',
           accepted_by_user_id = approval_reserved_by_user_id,
           accepted_at = approval_reserved_at,
           updated_at = approval_reserved_at
       where id = ? and project_id = ? and status = 'pending'
         and approval_reserved_by_user_id = ?
         and approval_reserved_at = ?
       returning *`,
    )
    .bind(
      input.proposalId,
      input.projectId,
      input.userId,
      input.acceptedAt,
    )
    .first<IssueExecutionProposalRow>();
}

export async function listFreshBacklogExecutionTargets(
  db: D1Database,
  projectId: string,
  limit = 100,
) {
  const rows = await db
    .prepare(
      `select id, run_number, source_key, title, status
       from briar_hunt_runs
       where project_id = ? and status = 'backlog' and stage = 'queued'
         and workflow_stage is null
         and worker_id is null and requested_worker_id is null
         and claim_token_hash is null and claimed_by is null
         and claimed_at is null and lease_expires_at is null
         and last_execution_id is null
         and dispatch_mode is null and dispatch_request_id is null
         and dispatched_at is null and requested_by_user_id is null
         and completed_at is null and paused_at is null
         and resume_requested_at is null
       order by run_number desc limit ?`,
    )
    .bind(projectId, Math.max(1, Math.min(limit, 100)))
    .all<FreshBacklogExecutionTargetRow>();
  return rows.results;
}
