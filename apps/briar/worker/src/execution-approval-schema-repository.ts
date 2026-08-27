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
      `select 1 as available
       where exists (
         select 1 from sqlite_master
         where type = 'table'
           and name = 'briar_agent_skill_execution_proposals'
       ) and exists (
         select 1 from pragma_table_info(
           'briar_agent_skill_execution_proposals'
         ) where name = 'execution_mode'
       )`,
    )
    .first<{ available: number }>());
}
