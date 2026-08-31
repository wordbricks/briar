export type AgentSkillExecutionRealtimeOutboxRow = {
  task_id: string;
  organization_id: string;
  project_id: string;
  source_kind: "channel" | "issue";
  channel_cursor: number | null;
  project_cursor: number | null;
  session_version: number;
};

export async function listAgentSkillExecutionRealtimeOutbox(
  db: D1Database,
  limit = 100,
) {
  const result = await db
    .prepare(
      `select task_id, organization_id, project_id, source_kind,
              channel_cursor, project_cursor, session_version
       from briar_agent_skill_execution_realtime_outbox
       order by updated_at, task_id
       limit ?`,
    )
    .bind(Math.max(1, Math.min(limit, 100)))
    .all<AgentSkillExecutionRealtimeOutboxRow>();
  return result.results;
}

export async function acknowledgeAgentSkillExecutionRealtimeOutbox(
  db: D1Database,
  row: AgentSkillExecutionRealtimeOutboxRow,
) {
  await db
    .prepare(
      `delete from briar_agent_skill_execution_realtime_outbox
       where task_id = ? and session_version <= ?
         and coalesce(channel_cursor, -1) <= coalesce(?, -1)
         and coalesce(project_cursor, -1) <= coalesce(?, -1)`,
    )
    .bind(
      row.task_id,
      row.session_version,
      row.channel_cursor,
      row.project_cursor,
    )
    .run();
}
