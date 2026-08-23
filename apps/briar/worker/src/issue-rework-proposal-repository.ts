export type IssueReworkProposalRow = {
  id: string;
  project_id: string;
  run_id: string;
  trigger_message_id: string;
  reply_message_id: string;
  workflow_stage: string;
  reason: string;
  expected_attempt: number;
  expected_revision: number;
  status: "pending" | "accepted";
  accepted_by_user_id: string | null;
  accepted_at: string | null;
  applied_revision: number | null;
  created_at: string;
  updated_at: string;
};

export async function createIssueReworkProposal(
  db: D1Database,
  input: {
    id: string;
    projectId: string;
    runId: string;
    triggerMessageId: string;
    replyMessageId: string;
    workflowStage: string;
    reason: string;
    createdAt: string;
  },
) {
  return await db
    .prepare(
      `insert into briar_issue_rework_proposals (
         id, project_id, run_id, trigger_message_id, reply_message_id,
         workflow_stage, reason, expected_attempt, expected_revision,
         created_at, updated_at
       )
       select ?, run.project_id, run.id, ?, ?, ?, ?,
              run.current_attempt, run.current_revision, ?, ?
       from briar_hunt_runs run
       where run.id = ? and run.project_id = ? and run.status = 'completed'
         and exists (
           select 1 from json_each(run.workflow_snapshot_json, '$.stages') stage
           where json_extract(stage.value, '$.id') = ?
         )
       on conflict (project_id, trigger_message_id) do nothing
       returning *`,
    )
    .bind(
      input.id,
      input.triggerMessageId,
      input.replyMessageId,
      input.workflowStage,
      input.reason,
      input.createdAt,
      input.createdAt,
      input.runId,
      input.projectId,
      input.workflowStage,
    )
    .first<IssueReworkProposalRow>();
}

export async function listIssueReworkProposals(
  db: D1Database,
  projectId: string,
  runId: string,
) {
  const result = await db
    .prepare(
      `select proposal.*
       from briar_issue_rework_proposals proposal
       join briar_hunt_runs run
         on run.id = proposal.run_id and run.project_id = proposal.project_id
       where proposal.project_id = ? and proposal.run_id = ?
       order by proposal.created_at, proposal.id`,
    )
    .bind(projectId, runId)
    .all<IssueReworkProposalRow>();
  return result.results;
}

export async function getIssueReworkProposal(
  db: D1Database,
  projectId: string,
  runId: string,
  proposalId: string,
) {
  return await db
    .prepare(
      `select proposal.*
       from briar_issue_rework_proposals proposal
       join briar_hunt_runs run
         on run.id = proposal.run_id and run.project_id = proposal.project_id
       where proposal.id = ? and proposal.project_id = ?
         and proposal.run_id = ?`,
    )
    .bind(proposalId, projectId, runId)
    .first<IssueReworkProposalRow>();
}

export async function acceptIssueReworkProposal(
  db: D1Database,
  input: {
    projectId: string;
    runId: string;
    proposalId: string;
    userId: string;
    acceptedAt: string;
    appliedRevision: number;
  },
) {
  return await db
    .prepare(
      `update briar_issue_rework_proposals
       set status = 'accepted', accepted_by_user_id = ?, accepted_at = ?,
           applied_revision = ?, updated_at = ?
       where id = ? and project_id = ? and run_id = ?
         and status = 'pending'
         and exists (
           select 1 from briar_hunt_runs run
           where run.id = briar_issue_rework_proposals.run_id
             and run.project_id = briar_issue_rework_proposals.project_id
         )
       returning *`,
    )
    .bind(
      input.userId,
      input.acceptedAt,
      input.appliedRevision,
      input.acceptedAt,
      input.proposalId,
      input.projectId,
      input.runId,
    )
    .first<IssueReworkProposalRow>();
}
