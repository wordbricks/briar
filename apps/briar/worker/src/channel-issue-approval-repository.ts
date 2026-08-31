import { type HuntRunRow } from "./hunt-run-model";

export const isChannelApprovedIssue = async (
  db: D1Database,
  run: Pick<HuntRunRow, "id" | "source_key">,
) => Boolean(await db
    .prepare(
      `select 1 as approved
       from briar_channel_issue_approval_audit approval
       where approval.run_id = ? and approval.issue_source_key = ?
         and approval.result_verification = 'atomic'
       limit 1`,
    )
    .bind(run.id, run.source_key)
    .first<{ approved: number }>());
