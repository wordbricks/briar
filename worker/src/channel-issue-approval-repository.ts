import { type HuntRunRow } from "./hunt-run-model";

export const channelApprovalTablesAvailable = async (db: D1Database) => {
  const result = await db
    .prepare(
      `select count(*) as table_count from sqlite_master
       where type = 'table'
         and name in (
           'briar_channel_action_proposals',
           'briar_channel_issue_approval_audit'
         )`,
    )
    .first<{ table_count: number }>();
  return result?.table_count === 2;
};

export const isChannelApprovedIssue = async (
  db: D1Database,
  run: Pick<HuntRunRow, "id" | "source_key">,
) => {
  if (await channelApprovalTablesAvailable(db)) {
    return Boolean(await db
      .prepare(
        `select 1 as approved
         from briar_channel_issue_approval_audit approval
         where approval.run_id = ? and approval.issue_source_key = ?
           and approval.result_verification in ('atomic', 'legacy_authorized')
         limit 1`,
      )
      .bind(run.id, run.source_key)
      .first<{ approved: number }>());
  }
  const proposalTables = await db.prepare(
    `select name from sqlite_master
     where type = 'table'
       and name in (
         'briar_channel_action_proposals', 'briar_issue_action_proposals'
       )`,
  ).all<{ name: string }>();
  const available = new Set(proposalTables.results.map((row) => row.name));
  // The new Worker may briefly run before migration 0090 if an operator uses
  // the wrong rollout order. Recognize the exact pre-migration accepted shape
  // so a queued transfer still drops back to backlog instead of carrying the
  // source project's execution approval into the target project.
  if (available.has("briar_channel_action_proposals")) {
    const channel = await db
      .prepare(
        `select 1 as approved
         from briar_channel_action_proposals proposal
         where proposal.result_run_id = ? and proposal.status = 'accepted'
           and proposal.action_type = 'request_issue_create'
           and ? = 'briar-channel-proposal:' || proposal.id
         limit 1`,
      )
      .bind(run.id, run.source_key)
      .first<{ approved: number }>();
    if (channel) return true;
  }
  if (available.has("briar_issue_action_proposals")) {
    return Boolean(await db
      .prepare(
        `select 1 as approved
         from briar_issue_action_proposals proposal
         where proposal.result_run_id = ? and proposal.status = 'accepted'
           and proposal.action_type = 'request_issue_create'
           and ? = 'briar-conversation-proposal:' || proposal.id
         limit 1`,
      )
      .bind(run.id, run.source_key)
      .first<{ approved: number }>());
  }
  return false;
};
