import { inboxSessionMessageVersion } from "../../src/lib/inbox-session-version";

import {
  type ProjectAgentSessionChangeRow,
  type ProjectAgentSessionChangesPage,
  type ProjectAgentSessionRow,
  type ProjectAgentSessionSummaryRow,
} from "./project-agent-model";
import { decodeStoredProjectAgentSessionPayload } from "./project-request-contract";

const projectAgentSessionChangePageSize = 500;

const projectAgentSessionSummaryJson = (row: ProjectAgentSessionRow) => {
  const payload = decodeStoredProjectAgentSessionPayload(row.payload_json);
  const issues = payload.issues.map((issue) => ({
    runId: issue.runId,
    runNumber: issue.runNumber,
    sourceKey: issue.sourceKey,
    title: issue.title,
    outcome: issue.outcome,
    summary: null,
  }));
  return JSON.stringify({
    dispatchGroupId: payload.dispatchGroupId,
    agentId: payload.agentId,
    agentName: payload.agentName ?? null,
    skillId: payload.skillId ?? null,
    sessionType: payload.sessionType,
    trigger: payload.trigger ?? null,
    scheduleId: payload.scheduleId ?? null,
    scheduleRunId: payload.scheduleRunId ?? null,
    parentSessionId: payload.parentSessionId ?? null,
    requestedByUserId: row.requested_by_user_id,
    request: payload.request?.slice(0, 500) ?? null,
    status: payload.status,
    issues,
    startedAt: payload.startedAt,
    completedAt: payload.completedAt,
    inboxVersion: inboxSessionMessageVersion(
      payload.status,
      payload.completedAt ?? payload.startedAt,
    ),
    requestedWorkerId: payload.requestedWorkerId ?? null,
    workerId: payload.workerId ?? null,
    updatedAt: payload.updatedAt,
  });
};

const upsertProjectAgentSessionSummaryStatement = (
  db: D1Database,
  row: ProjectAgentSessionRow,
  archived: boolean,
  requesterFromHotSession = false,
) => {
  const requesterExpression = requesterFromHotSession
    ? `(select session.requested_by_user_id
        from briar_project_agent_sessions session
        where session.project_id = ? and session.id = ?)`
    : "?";
  return db.prepare(
    `insert into briar_project_agent_session_summaries (
       project_id, session_id, summary_json, updated_at, archived
     ) values (?, ?, json_set(?, '$.requestedByUserId', ${requesterExpression}), ?, ?)
     on conflict (project_id, session_id) do update set
       summary_json = excluded.summary_json,
       updated_at = excluded.updated_at,
       archived = excluded.archived
     where excluded.updated_at > briar_project_agent_session_summaries.updated_at
        or excluded.archived <> briar_project_agent_session_summaries.archived`,
  ).bind(
    row.project_id,
    row.id,
    projectAgentSessionSummaryJson(row),
    ...(requesterFromHotSession
      ? [row.project_id, row.id]
      : [row.requested_by_user_id]),
    row.updated_at,
    archived ? 1 : 0,
  );
};

export async function upsertProjectAgentSessionSummary(
  db: D1Database,
  row: ProjectAgentSessionRow,
  archived: boolean,
) {
  return upsertProjectAgentSessionSummaryStatement(db, row, archived).run();
}

export async function listProjectAgentSessionSummaries(
  db: D1Database,
  projectId: string,
  sessionIds?: readonly string[],
  requestedByUserId?: string,
) {
  if (sessionIds?.length === 0) return [];
  const idFilter = sessionIds
    ? `and session_id in (${sessionIds.map(() => "?").join(",")})`
    : "";
  const requesterFilter = requestedByUserId === undefined
    ? ""
    : "and json_extract(summary_json, '$.requestedByUserId') = ?";
  const rowLimit = sessionIds ? projectAgentSessionChangePageSize : 200;
  const result = await db
    .prepare(
      `select project_id, session_id, summary_json, updated_at, archived
       from briar_project_agent_session_summaries
       where project_id = ? ${idFilter} ${requesterFilter}
       order by updated_at desc, session_id
       limit ?`,
    )
    .bind(
      projectId,
      ...(sessionIds ?? []),
      ...(requestedByUserId === undefined ? [] : [requestedByUserId]),
      rowLimit,
    )
    .all<ProjectAgentSessionSummaryRow>();
  return result.results;
}

export async function getProjectAgentSessionSyncCursor(
  db: D1Database,
  projectId: string,
) {
  const state = await db
    .prepare(
      `select current_version from briar_project_agent_session_sync_state
       where project_id = ?`,
    )
    .bind(projectId)
    .first<{ current_version: number }>();
  return state?.current_version ?? 0;
}

export async function listProjectAgentSessionChanges(
  db: D1Database,
  projectId: string,
  cursor: number,
): Promise<ProjectAgentSessionChangesPage> {
  const currentVersion = await getProjectAgentSessionSyncCursor(db, projectId);
  const oldest = await db
    .prepare(
      `select min(version) as oldest_version
       from briar_project_agent_session_changes where project_id = ?`,
    )
    .bind(projectId)
    .first<{ oldest_version: number | null }>();
  const oldestVersion = oldest?.oldest_version ?? null;
  const expired =
    cursor < 0 ||
    cursor > currentVersion ||
    (cursor < currentVersion &&
      (oldestVersion === null || cursor < oldestVersion - 1));
  if (expired) {
    return {
      currentVersion,
      changes: [],
      hasMore: false,
      nextCursor: currentVersion,
      expired: true,
    };
  }
  const result = await db
    .prepare(
      `select version, session_id, operation
       from briar_project_agent_session_changes
       where project_id = ? and version > ? and version <= ?
       order by version
       limit ?`,
    )
    .bind(
      projectId,
      cursor,
      currentVersion,
      projectAgentSessionChangePageSize + 1,
    )
    .all<ProjectAgentSessionChangeRow>();
  const hasMore = result.results.length > projectAgentSessionChangePageSize;
  const changes = result.results.slice(0, projectAgentSessionChangePageSize);
  return {
    currentVersion,
    changes,
    hasMore,
    nextCursor: hasMore
      ? (changes.at(-1)?.version ?? cursor)
      : currentVersion,
    expired: false,
  };
}

export async function listProjectAgentSessions(
  db: D1Database,
  projectId: string,
) {
  const result = await db
    .prepare(
      `select project_id, id, agent_id, requested_by_user_id, status,
              session_type, payload_json,
              started_at, completed_at, updated_at
       from briar_project_agent_sessions
       where project_id = ?
       order by updated_at desc, id
       limit 200`,
    )
    .bind(projectId)
    .all<ProjectAgentSessionRow>();
  return result.results;
}

export async function getProjectAgentSession(
  db: D1Database,
  projectId: string,
  sessionId: string,
) {
  return db
    .prepare(
      `select project_id, id, agent_id, requested_by_user_id, status,
              session_type, payload_json,
              started_at, completed_at, updated_at
       from briar_project_agent_sessions
       where project_id = ? and id = ?`,
    )
    .bind(projectId, sessionId)
    .first<ProjectAgentSessionRow>();
}

export async function projectAgentSessionIsApprovalOwned(
  db: D1Database,
  projectId: string,
  sessionId: string,
) {
  const row = await db
    .prepare(
      `select 1 as owned
       from briar_agent_skill_execution_approval_audit
       where project_id = ? and result_session_id = ?
       limit 1`,
    )
    .bind(projectId, sessionId)
    .first<{ owned: number }>();
  return row?.owned === 1;
}

export async function upsertProjectAgentSession(
  db: D1Database,
  input: ProjectAgentSessionRow,
  observedAt: string,
) {
  await db.batch([
    db.prepare(
      `insert into briar_project_agent_session_context_membership (
         project_id, session_id, visible_at
       ) values (?, ?, ?)
       on conflict (project_id, session_id) do update set
         visible_at = excluded.visible_at
       where not exists (
         select 1 from briar_project_agent_sessions session
         where session.project_id = excluded.project_id
           and session.id = excluded.session_id
       ) and not exists (
         select 1 from briar_log_archives archive
         where archive.project_id = excluded.project_id
           and archive.scope_id = excluded.session_id
           and archive.archive_kind = 'project_agent_sessions'
           and archive.status in ('verified', 'complete')
       )`,
    ).bind(input.project_id, input.id, observedAt),
    db.prepare(
      `insert into briar_project_agent_sessions (
         project_id, id, agent_id, status, session_type, payload_json,
         started_at, completed_at, updated_at, requested_by_user_id
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict (project_id, id) do update set
         agent_id = excluded.agent_id,
         status = excluded.status,
         session_type = excluded.session_type,
         payload_json = excluded.payload_json,
         started_at = excluded.started_at,
         completed_at = excluded.completed_at,
         updated_at = excluded.updated_at
       where excluded.updated_at > briar_project_agent_sessions.updated_at`,
    )
    .bind(
      input.project_id,
      input.id,
      input.agent_id,
      input.status,
      input.session_type,
      input.payload_json,
      input.started_at,
      input.completed_at,
      input.updated_at,
      input.requested_by_user_id,
    ),
    upsertProjectAgentSessionSummaryStatement(db, input, false, true),
  ]);
  return db
    .prepare(
      `select project_id, id, agent_id, requested_by_user_id, status,
              session_type, payload_json,
              started_at, completed_at, updated_at
       from briar_project_agent_sessions
       where project_id = ? and id = ?`,
    )
    .bind(input.project_id, input.id)
    .first<ProjectAgentSessionRow>();
}
