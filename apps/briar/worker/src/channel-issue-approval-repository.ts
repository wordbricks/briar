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
) => Boolean(await db
    .prepare(
      `select 1 as approved
       from briar_channel_issue_approval_audit approval
       where approval.run_id = ? and approval.issue_source_key = ?
         and approval.result_verification in ('atomic', 'legacy_authorized')
       limit 1`,
    )
    .bind(run.id, run.source_key)
    .first<{ approved: number }>());
