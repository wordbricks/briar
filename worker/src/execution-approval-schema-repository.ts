export async function issueExecutionApprovalTablesAvailable(db: D1Database) {
  return Boolean(await db
    .prepare(
      `select 1 as available from sqlite_master
       where type = 'table' and name = 'briar_issue_execution_proposals'`,
    )
    .first<{ available: number }>());
}

export async function agentSkillExecutionApprovalTablesAvailable(
  db: D1Database,
) {
  return Boolean(await db
    .prepare(
      `select 1 as available from sqlite_master
       where type = 'table'
         and name = 'briar_agent_skill_execution_proposals'`,
    )
    .first<{ available: number }>());
}
