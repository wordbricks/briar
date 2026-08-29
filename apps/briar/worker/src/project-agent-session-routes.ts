import {
  backfillArchivedProjectAgentSessionSummaries,
  getArchivedProjectAgentSession,
  listArchivedProjectAgentSessions,
} from "./archive";
import type { BriarAuth } from "./auth";
import { agentSkillExecutionApprovalTablesAvailable } from "./execution-approval-schema-repository";
import {
  corsHeaders,
  HttpError,
  json,
  privateNoStoreJson,
} from "./http-response";
import { hasOrganizationCapability } from "./organization-access";
import {
  projectAgentSessionJson,
  projectAgentSessionSummaryJson,
  projectAgentSessionSyncEtag,
  projectAgentSessionSyncJson,
} from "./project-agent-session-json";
import {
  getProjectAgentSession,
  getProjectAgentSessionSyncCursor,
  listProjectAgentSessionChanges,
  listProjectAgentSessions,
  listProjectAgentSessionSummaries,
  projectAgentSessionIsApprovalOwned,
  upsertProjectAgentSession,
} from "./project-agent-session-repository";
import { getProjectAgentScheduleCreatorId } from "./project-agent-schedule-repository";
import { getProject } from "./project-command-repository";
import { decodeProjectAgentSessionInput } from "./project-request-contract";
import { readJson } from "./request-readers";
import { scheduleProjectAgentSessionRealtimePublish } from "./realtime-scheduling";
import { requireSession } from "./session-auth";

export type ProjectAgentSessionRouteInput = {
  request: Request;
  url: URL;
  auth: BriarAuth;
  db: D1Database;
  env: Env;
  context?: ExecutionContext;
};

export async function handleProjectAgentSessionRoute(
  routeInput: ProjectAgentSessionRouteInput,
): Promise<Response | undefined> {
  const { request, url, auth, db, env, context } = routeInput;
  const { pathname } = url;

  const projectAgentSessionsMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/agent-sessions$/u,
  );
  const projectAgentSessionChangesMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/agent-sessions\/changes$/u,
  );
  if (projectAgentSessionChangesMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      projectAgentSessionChangesMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const rawCursor = url.searchParams.get("cursor");
    let cursor: number | null = null;
    if (rawCursor !== null) {
      if (!/^\d+$/u.test(rawCursor)) {
        throw new HttpError(400, "A non-negative Agent session cursor is required");
      }
      cursor = Number(rawCursor);
      if (!Number.isSafeInteger(cursor)) {
        throw new HttpError(400, "Agent session cursor is outside the safe range");
      }
    } else {
      // Historical archives predate the D1 summary projection. This bounded
      // one-time backfill is the only list path that may read those legacy R2
      // objects; later snapshots and every delta are D1-only.
      await backfillArchivedProjectAgentSessionSummaries(
        db,
        env.ARCHIVES,
        project.id,
      );
    }

    const currentCursor = await getProjectAgentSessionSyncCursor(db, project.id);
    const etag = projectAgentSessionSyncEtag(project.id, currentCursor);
    if (
      cursor === currentCursor &&
      request.headers.get("if-none-match") === etag
    ) {
      return new Response(null, {
        status: 304,
        headers: {
          ...corsHeaders,
          "Cache-Control": "private, no-cache",
          ETag: etag,
        },
      });
    }

    if (cursor === null) {
      const summaries = await listProjectAgentSessionSummaries(db, project.id);
      return projectAgentSessionSyncJson({
        cursor: currentCursor,
        hasMore: false,
        reset: true,
        sessions: summaries.map(projectAgentSessionSummaryJson),
        deletedSessionIds: [],
      }, etag);
    }

    const page = await listProjectAgentSessionChanges(db, project.id, cursor);
    if (page.expired) {
      return projectAgentSessionSyncJson({
        code: "project_agent_session_cursor_expired",
        message: "Agent session cursor expired; reload the summary snapshot",
      }, etag, 410);
    }
    const changedSessionIds = [...new Set(
      page.changes.map((change) => change.session_id),
    )];
    const summaries = await listProjectAgentSessionSummaries(
      db,
      project.id,
      changedSessionIds,
    );
    const existingIds = new Set(summaries.map((summary) => summary.session_id));
    return projectAgentSessionSyncJson({
      cursor: page.nextCursor,
      hasMore: page.hasMore,
      reset: false,
      sessions: summaries.map(projectAgentSessionSummaryJson),
      deletedSessionIds: changedSessionIds.filter((id) => !existingIds.has(id)),
    }, etag);
  }

  if (projectAgentSessionsMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      projectAgentSessionsMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const [hotSessions, archivedSessions] = await Promise.all([
      listProjectAgentSessions(db, project.id),
      listArchivedProjectAgentSessions(db, env.ARCHIVES, project.id),
    ]);
    const sessions = [
      ...new Map(
        [...archivedSessions, ...hotSessions].map((item) => [item.id, item]),
      ).values(),
    ]
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .slice(0, 200);
    return json({ sessions: sessions.map(projectAgentSessionJson) });
  }

  const projectAgentSessionMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/agent-sessions\/([A-Za-z0-9_-]{1,128})$/u,
  );
  if (projectAgentSessionMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      projectAgentSessionMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    const hot = await getProjectAgentSession(
      db,
      project.id,
      projectAgentSessionMatch[2],
    );
    if (hot) return privateNoStoreJson({ session: projectAgentSessionJson(hot) });
    const archived = await getArchivedProjectAgentSession(
      db,
      env.ARCHIVES,
      project.id,
      projectAgentSessionMatch[2],
    );
    if (!archived) throw new HttpError(404, "Agent session not found");
    return privateNoStoreJson({
      session: {
        ...projectAgentSessionJson(archived),
        archived: true,
      },
    });
  }
  if (projectAgentSessionMatch && request.method === "PUT") {
    const session = await requireSession(auth, request);
    const project = await getProject(
      db,
      projectAgentSessionMatch[1],
      session.user.id,
    );
    if (!project) throw new HttpError(404, "Project not found");
    if (!hasOrganizationCapability(project.member_role, "development:manage")) {
      throw new HttpError(403, "Development management permission required");
    }
    if (
      await agentSkillExecutionApprovalTablesAvailable(db) &&
      await projectAgentSessionIsApprovalOwned(
        db,
        project.id,
        projectAgentSessionMatch[2],
      )
    ) {
      throw new HttpError(
        409,
        "Approved Agent Skill execution sessions are updated by their assigned Worker",
        "AGENT_SKILL_EXECUTION_SESSION_SERVER_OWNED",
      );
    }
    const input = decodeProjectAgentSessionInput(await readJson(request));
    const observedAt = new Date().toISOString();
    const existing = await getProjectAgentSession(
      db,
      project.id,
      projectAgentSessionMatch[2],
    ) ?? await getArchivedProjectAgentSession(
      db,
      env.ARCHIVES,
      project.id,
      projectAgentSessionMatch[2],
    );
    let requestedByUserId: string | null;
    if (existing) {
      requestedByUserId = existing.requested_by_user_id;
    } else if (input.parentSessionId) {
      const parent = await getProjectAgentSession(
        db,
        project.id,
        input.parentSessionId,
      ) ?? await getArchivedProjectAgentSession(
        db,
        env.ARCHIVES,
        project.id,
        input.parentSessionId,
      );
      requestedByUserId = parent?.requested_by_user_id ?? null;
    } else if (input.trigger === "scheduled" && input.scheduleId) {
      requestedByUserId = await getProjectAgentScheduleCreatorId(
        db,
        project.id,
        input.scheduleId,
      );
    } else {
      requestedByUserId = session.user.id;
    }
    const row = await upsertProjectAgentSession(db, {
      project_id: project.id,
      id: projectAgentSessionMatch[2],
      agent_id: input.agentId,
      requested_by_user_id: requestedByUserId,
      status: input.status,
      session_type: input.sessionType,
      payload_json: JSON.stringify(input),
      started_at: input.startedAt,
      completed_at: input.completedAt,
      updated_at: input.updatedAt,
    }, observedAt);
    if (!row) throw new HttpError(409, "Agent session could not be synchronized");
    scheduleProjectAgentSessionRealtimePublish(
      env,
      db,
      project.id,
      context,
    );
    return json({ session: projectAgentSessionJson(row) });
  }
}
