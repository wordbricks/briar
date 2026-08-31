export type IssueActionProposalRow = {
  id: string;
  project_id: string;
  conversation_run_id: string;
  trigger_message_id: string;
  reply_message_id: string;
  action_type: "request_issue_update" | "request_issue_create";
  payload_json: string;
  expected_run_updated_at: string | null;
  status: "pending" | "accepted";
  accepted_by_user_id: string | null;
  accepted_at: string | null;
  approval_reserved_by_user_id: string | null;
  approval_reserved_at: string | null;
  issue_source_key: string | null;
  execute_after_create: number;
  execution_proposal_id: string | null;
  result_run_id: string | null;
  created_at: string;
  updated_at: string;
};

export async function createIssueActionProposal(
  db: D1Database,
  input: {
    id: string;
    projectId: string;
    conversationRunId: string;
    triggerMessageId: string;
    replyMessageId: string;
    actionType: IssueActionProposalRow["action_type"];
    payloadJson: string;
    executeAfterCreate?: boolean;
    executionProposalId?: string | null;
    createdAt: string;
  },
) {
  return await db
    .prepare(
      `insert into briar_issue_action_proposals (
         id, project_id, conversation_run_id, trigger_message_id,
         reply_message_id, action_type, payload_json,
         expected_run_updated_at, execute_after_create,
         execution_proposal_id, created_at, updated_at
       )
       select ?, run.project_id, run.id, ?, ?, ?, ?,
              case when ? = 'request_issue_update' then run.updated_at else null end,
              ?, ?, ?, ?
       from briar_hunt_runs run
       where run.id = ? and run.project_id = ?
       on conflict (project_id, trigger_message_id) do nothing
       returning *`,
    )
    .bind(
      input.id,
      input.triggerMessageId,
      input.replyMessageId,
      input.actionType,
      input.payloadJson,
      input.actionType,
      input.executeAfterCreate ? 1 : 0,
      input.executionProposalId ?? null,
      input.createdAt,
      input.createdAt,
      input.conversationRunId,
      input.projectId,
    )
    .first<IssueActionProposalRow>();
}

export async function listIssueActionProposals(
  db: D1Database,
  projectId: string,
  conversationRunId: string,
) {
  const result = await db
    .prepare(
      `select proposal.*
       from briar_issue_action_proposals proposal
       join briar_hunt_runs run
         on run.id = proposal.conversation_run_id
        and run.project_id = proposal.project_id
       where proposal.project_id = ? and proposal.conversation_run_id = ?
       order by proposal.created_at, proposal.id`,
    )
    .bind(projectId, conversationRunId)
    .all<IssueActionProposalRow>();
  return result.results;
}

export async function getIssueActionProposal(
  db: D1Database,
  projectId: string,
  conversationRunId: string,
  proposalId: string,
) {
  return await db
    .prepare(
      `select proposal.*
       from briar_issue_action_proposals proposal
       join briar_hunt_runs run
         on run.id = proposal.conversation_run_id
        and run.project_id = proposal.project_id
       where proposal.id = ? and proposal.project_id = ?
         and proposal.conversation_run_id = ?`,
    )
    .bind(proposalId, projectId, conversationRunId)
    .first<IssueActionProposalRow>();
}

export async function acceptIssueUpdateProposal(
  db: D1Database,
  input: {
    projectId: string;
    conversationRunId: string;
    proposalId: string;
    userId: string;
    acceptedAt: string;
    title: string;
    description: string | null;
    priority: number | null;
  },
) {
  const proposal = await getIssueActionProposal(
    db,
    input.projectId,
    input.conversationRunId,
    input.proposalId,
  );
  if (!proposal || proposal.action_type !== "request_issue_update") return null;
  if (proposal.status === "accepted") return proposal;
  const results = await db.batch([
    db
      .prepare(
        `update briar_hunt_runs
         set title = ?, issue_description = ?, priority = ?, updated_at = ?
         where id = ? and project_id = ? and updated_at = ?
           and exists (
             select 1 from briar_issue_action_proposals proposal
             where proposal.id = ? and proposal.project_id = ?
               and proposal.conversation_run_id = briar_hunt_runs.id
               and proposal.status = 'pending'
               and proposal.action_type = 'request_issue_update'
           )`,
      )
      .bind(
        input.title,
        input.description,
        input.priority,
        input.acceptedAt,
        input.conversationRunId,
        input.projectId,
        proposal.expected_run_updated_at,
        input.proposalId,
        input.projectId,
      ),
    db
      .prepare(
        `update briar_issue_action_proposals
         set status = 'accepted', accepted_by_user_id = ?, accepted_at = ?,
             result_run_id = conversation_run_id, updated_at = ?
         where id = ? and project_id = ? and conversation_run_id = ?
           and status = 'pending' and action_type = 'request_issue_update'
           and exists (
             select 1 from briar_hunt_runs run
             where run.id = ? and run.project_id = ? and run.updated_at = ?
           )`,
      )
      .bind(
        input.userId,
        input.acceptedAt,
        input.acceptedAt,
        input.proposalId,
        input.projectId,
        input.conversationRunId,
        input.conversationRunId,
        input.projectId,
        input.acceptedAt,
      ),
  ]);
  if ((results[0]?.meta.changes ?? 0) === 0 ||
      (results[1]?.meta.changes ?? 0) === 0) {
    return null;
  }
  return await getIssueActionProposal(
    db,
    input.projectId,
    input.conversationRunId,
    input.proposalId,
  );
}

export async function acceptIssueCreateProposal(
  db: D1Database,
  input: {
    projectId: string;
    conversationRunId: string;
    proposalId: string;
    userId: string;
    acceptedAt: string;
    resultRunId: string;
  },
) {
  return await db
    .prepare(
      `update briar_issue_action_proposals
       set status = 'accepted',
           accepted_by_user_id = approval_reserved_by_user_id,
           accepted_at = approval_reserved_at,
           result_run_id = ?, updated_at = approval_reserved_at
       where id = ? and project_id = ? and conversation_run_id = ?
         and status = 'pending' and action_type = 'request_issue_create'
         and approval_reserved_by_user_id is not null
         and approval_reserved_at is not null
         and issue_source_key is not null
         and exists (
           select 1 from briar_hunt_runs conversation
           where conversation.id =
               briar_issue_action_proposals.conversation_run_id
             and conversation.project_id =
               briar_issue_action_proposals.project_id
         )
         and exists (
           select 1 from briar_hunt_runs result
           where result.id = ? and result.project_id = ?
             and result.source = 'issue'
             and result.source_key =
               briar_issue_action_proposals.issue_source_key
             and result.status = 'backlog' and result.stage = 'queued'
             and result.workflow_stage is null
             and result.worker_id is null
             and result.agent_id is null
             and result.requested_worker_id is null
             and result.claim_token_hash is null
             and result.claimed_by is null and result.claimed_at is null
             and result.lease_expires_at is null
             and result.last_execution_id is null
             and result.dispatch_mode is null
             and result.dispatch_request_id is null
             and result.dispatched_at is null
             and result.requested_by_user_id is null
             and result.requested_agent_provider is null
             and result.requested_agent_model is null
             and result.requested_agent_effort is null
             and result.completed_at is null
             and result.paused_at is null
             and result.resume_requested_at is null
         )
         and exists (
           select 1
           from briar_projects project
           join briar_organization_members membership
             on membership.organization_id = project.organization_id
           where project.id = briar_issue_action_proposals.project_id
             and membership.user_id = ?
         )
       returning *`,
    )
    .bind(
      input.resultRunId,
      input.proposalId,
      input.projectId,
      input.conversationRunId,
      input.resultRunId,
      input.projectId,
      input.userId,
    )
    .first<IssueActionProposalRow>();
}

export async function reserveIssueCreateProposalApproval(
  db: D1Database,
  input: {
    projectId: string;
    conversationRunId: string;
    proposalId: string;
    userId: string;
    reservedAt: string;
    issueSourceKey: string;
  },
) {
  return await db
    .prepare(
      `update briar_issue_action_proposals
       set approval_reserved_by_user_id = case
             when approval_reserved_by_user_id is null then ?
             else approval_reserved_by_user_id
           end,
           approval_reserved_at = case
             when approval_reserved_by_user_id is null then ?
             else approval_reserved_at
           end,
           issue_source_key = coalesce(issue_source_key, ?),
           updated_at = case
             when approval_reserved_by_user_id is null then ? else updated_at
           end
       where id = ? and project_id = ? and conversation_run_id = ?
         and status = 'pending' and action_type = 'request_issue_create'
         and exists (
           select 1 from briar_hunt_runs conversation
           where conversation.id =
               briar_issue_action_proposals.conversation_run_id
             and conversation.project_id =
               briar_issue_action_proposals.project_id
         )
       returning *`,
    )
    .bind(
      input.userId,
      input.reservedAt,
      input.issueSourceKey,
      input.reservedAt,
      input.proposalId,
      input.projectId,
      input.conversationRunId,
    )
    .first<IssueActionProposalRow>();
}
