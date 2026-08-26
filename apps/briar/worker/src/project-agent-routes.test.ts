import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import worker from "./index";
import { createIsolatedTestDatabase } from "./test-helpers/d1";

describe("project Agent routes", () => {
  let miniflare: Miniflare;
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const projectId = "22222222-2222-4222-8222-222222222222";
  const ownerId = "project-agent-route-owner";
  const memberId = "project-agent-route-member";
  const sessionToken = "project-agent-route-session-token";
  const memberSessionToken = "project-agent-route-member-session-token";
  const now = "2026-08-10T00:00:00.000Z";
  let db: D1Database;

  beforeAll(async () => {
    const database = await createIsolatedTestDatabase({
      suite: "project-agent-routes",
    });
    miniflare = database.miniflare;
    db = database.db;
    await db.prepare(
      `insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
       values (?, 'Owner', 'owner@example.com', 1, ?, ?)`,
    ).bind(ownerId, now, now).run();
    await db.prepare(
      `insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
       values (?, 'Member', 'member@example.com', 1, ?, ?)`,
    ).bind(memberId, now, now).run();
    await db.prepare(
      `insert into "session" (
         id, expiresAt, token, createdAt, updatedAt, userId
       ) values ('project-agent-route-session', '2099-01-01T00:00:00.000Z',
                 ?, ?, ?, ?)`,
    ).bind(sessionToken, now, now, ownerId).run();
    await db.prepare(
      `insert into "session" (
         id, expiresAt, token, createdAt, updatedAt, userId
       ) values ('project-agent-route-member-session',
                 '2099-01-01T00:00:00.000Z', ?, ?, ?, ?)`,
    ).bind(memberSessionToken, now, now, memberId).run();
    await db.prepare(
      `insert into briar_organizations (id, name, handle, created_at, updated_at)
       values (?, 'Agent Routes', 'agent-routes', ?, ?)`,
    ).bind(organizationId, now, now).run();
    await db.prepare(
      `insert into briar_organization_members (
         organization_id, user_id, role, created_at, updated_at
       ) values (?, ?, 'owner', ?, ?)`,
    ).bind(organizationId, ownerId, now, now).run();
    await db.prepare(
      `insert into briar_organization_members (
         organization_id, user_id, role, created_at, updated_at
       ) values (?, ?, 'member', ?, ?)`,
    ).bind(organizationId, memberId, now, now).run();
    await db.prepare(
      `insert into briar_projects (
         id, owner_user_id, organization_id, name, agent_token_hash,
         created_at, updated_at
       ) values (?, ?, ?, 'Agent Routes', ?, ?, ?)`,
    ).bind(
      projectId,
      ownerId,
      organizationId,
      "a".repeat(64),
      now,
      now,
    ).run();
    await db.prepare(
      `insert into briar_project_members (
         project_id, organization_id, user_id, created_at, updated_at
       ) values (?, ?, ?, ?, ?)`,
    ).bind(projectId, organizationId, memberId, now, now).run();
  }, 60_000);

  afterAll(async () => {
    await miniflare.dispose();
  });

  const env = () => ({
    DB: db,
    BETTER_AUTH_SECRET: "briar-test-secret-that-is-at-least-32-characters",
    GOOGLE_CLIENT_ID: "google-client",
    GOOGLE_CLIENT_SECRET: "google-secret",
  }) as never;

  const request = (
    pathname: string,
    method: "GET" | "POST" | "PUT",
    body?: unknown,
    headers?: Record<string, string>,
  ) =>
    new Request(`https://briar.example${pathname}`, {
      method,
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it("syncs lightweight summaries with cursors and loads detail on demand", async () => {
    const sessionId = "session-sync-1";
    const startedAt = "2026-08-10T01:00:00.000Z";
    const input = {
      dispatchGroupId: sessionId,
      agentId: null,
      agentName: "Repository Agent",
      skillId: null,
      sessionType: "task",
      trigger: "manual",
      scheduleId: null,
      scheduleRunId: null,
      parentSessionId: null,
      request: "Review the repository",
      followUps: [],
      status: "running",
      issues: [],
      startedAt,
      completedAt: null,
      conversationId: null,
      summary: null,
      error: null,
      requestedWorkerId: null,
      workerId: null,
      events: [{ id: "event-1", type: "started", occurredAt: startedAt }],
      updatedAt: startedAt,
    } as const;
    const created = await worker.fetch(
      request(
        `/projects/${projectId}/agent-sessions/${sessionId}`,
        "PUT",
        input,
      ),
      env(),
    );
    expect(created.status).toBe(200);
    await expect(created.clone().json()).resolves.toMatchObject({
      session: { requestedByUserId: ownerId },
    });

    const snapshot = await worker.fetch(
      request(`/projects/${projectId}/agent-sessions/changes`, "GET"),
      env(),
    );
    expect(snapshot.status).toBe(200);
    const etag = snapshot.headers.get("ETag");
    const snapshotBody = await snapshot.json<{
      cursor: number;
      reset: boolean;
      sessions: Array<Record<string, unknown>>;
    }>();
    expect(snapshotBody).toMatchObject({
      reset: true,
      sessions: [{
        id: sessionId,
        request: "Review the repository",
        events: [],
        summary: null,
        detailLoaded: false,
      }],
    });
    expect(etag).toBeTruthy();

    const unchanged = await worker.fetch(
      request(
        `/projects/${projectId}/agent-sessions/changes?cursor=${snapshotBody.cursor}`,
        "GET",
        undefined,
        { "if-none-match": etag! },
      ),
      env(),
    );
    expect(unchanged.status).toBe(304);

    const completedAt = "2026-08-10T01:05:00.000Z";
    const updated = await worker.fetch(
      request(
        `/projects/${projectId}/agent-sessions/${sessionId}`,
        "PUT",
        {
          ...input,
          status: "completed",
          completedAt,
          summary: "Repository review complete.",
          events: [
            ...input.events,
            { id: "event-2", type: "completed", occurredAt: completedAt },
          ],
          updatedAt: completedAt,
        },
        { authorization: `Bearer ${memberSessionToken}` },
      ),
      env(),
    );
    expect(updated.status).toBe(200);

    const delta = await worker.fetch(
      request(
        `/projects/${projectId}/agent-sessions/changes?cursor=${snapshotBody.cursor}`,
        "GET",
        undefined,
        { "if-none-match": etag! },
      ),
      env(),
    );
    expect(delta.status).toBe(200);
    await expect(delta.json()).resolves.toMatchObject({
      reset: false,
      sessions: [{
        id: sessionId,
        status: "completed",
        summary: null,
        events: [],
        detailLoaded: false,
      }],
      deletedSessionIds: [],
    });

    const detail = await worker.fetch(
      request(`/projects/${projectId}/agent-sessions/${sessionId}`, "GET"),
      env(),
    );
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      session: {
        id: sessionId,
        requestedByUserId: ownerId,
        summary: "Repository review complete.",
        events: [{ id: "event-1" }, { id: "event-2" }],
        detailLoaded: true,
      },
    });

    const childSessionId = "session-sync-child";
    const child = await worker.fetch(
      request(
        `/projects/${projectId}/agent-sessions/${childSessionId}`,
        "PUT",
        {
          ...input,
          dispatchGroupId: childSessionId,
          parentSessionId: sessionId,
          startedAt: "2026-08-10T01:06:00.000Z",
          updatedAt: "2026-08-10T01:06:00.000Z",
        },
        { authorization: `Bearer ${memberSessionToken}` },
      ),
      env(),
    );
    expect(child.status).toBe(200);
    await expect(child.json()).resolves.toMatchObject({
      session: {
        id: childSessionId,
        parentSessionId: sessionId,
        requestedByUserId: ownerId,
      },
    });

    const scheduledAgentResponse = await worker.fetch(
      request(`/projects/${projectId}/agents`, "POST", {
        name: "Scheduled Agent",
        provider: "codex",
        responsibility: "Run scheduled work.",
      }),
      env(),
    );
    const scheduledAgent = await scheduledAgentResponse.json<{
      agent: { id: string };
    }>();
    const scheduleResponse = await worker.fetch(
      request(`/projects/${projectId}/agent-schedules`, "POST", {
        agentId: scheduledAgent.agent.id,
        name: "Owner schedule",
        recurrence: "daily",
        timeOfDay: "09:00",
        dayOfWeek: null,
        notificationLevel: "important_updates",
        timeZone: "Asia/Seoul",
      }),
      env(),
    );
    expect(scheduleResponse.status).toBe(201);
    const schedule = await scheduleResponse.json<{ schedule: { id: string } }>();
    const scheduledSessionId = "session-sync-scheduled";
    const scheduledSession = await worker.fetch(
      request(
        `/projects/${projectId}/agent-sessions/${scheduledSessionId}`,
        "PUT",
        {
          ...input,
          dispatchGroupId: scheduledSessionId,
          agentId: scheduledAgent.agent.id,
          trigger: "scheduled",
          scheduleId: schedule.schedule.id,
          scheduleRunId: "schedule-run-1",
          startedAt: "2026-08-10T01:07:00.000Z",
          updatedAt: "2026-08-10T01:07:00.000Z",
        },
        { authorization: `Bearer ${memberSessionToken}` },
      ),
      env(),
    );
    expect(scheduledSession.status).toBe(200);
    await expect(scheduledSession.json()).resolves.toMatchObject({
      session: {
        id: scheduledSessionId,
        trigger: "scheduled",
        requestedByUserId: ownerId,
      },
    });
  });
});
