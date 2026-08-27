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

  it("validates and preserves a project Agent Designated Worker", async () => {
    const workerId = "worker-designated-mac";
    const deviceId = "44444444-4444-4444-8444-444444444444";
    const otherProjectId = "55555555-5555-4555-8555-555555555555";
    const otherWorkerId = "worker-other-project-mac";
    const observedAt = new Date().toISOString();
    const capabilities = JSON.stringify({
      providerHealth: { codex: { healthy: true } },
      providerCapabilities: {
        codex: {
          models: [],
          defaultEfforts: [],
          allowCustomModels: true,
          error: null,
        },
      },
    });
    await db.batch([
      db.prepare(
        `insert into briar_execution_worker_devices (
           id, organization_id, owner_user_id, label, device_identity_hash,
           state, last_heartbeat_at, created_at, updated_at
         ) values (?, ?, ?, 'Designated Mac', ?, 'online', ?, ?, ?)`,
      ).bind(
        deviceId,
        organizationId,
        ownerId,
        "c".repeat(64),
        observedAt,
        observedAt,
        observedAt,
      ),
      db.prepare(
        `insert into briar_execution_worker_credentials (
           device_id, token_hash, created_at
         ) values (?, ?, ?)`,
      ).bind(deviceId, "d".repeat(64), observedAt),
      db.prepare(
        `insert into briar_execution_workers (
           id, project_id, device_id, label, host_fingerprint,
           agent_provider, capabilities_json, state, accepting_work,
           readiness_state, last_heartbeat_at, created_at, updated_at
         ) values (?, ?, ?, 'Designated Mac', ?, 'codex', ?, 'online', 1,
                   'ready', ?, ?, ?)`,
      ).bind(
        workerId,
        projectId,
        deviceId,
        "e".repeat(64),
        capabilities,
        observedAt,
        observedAt,
        observedAt,
      ),
      db.prepare(
        `insert into briar_projects (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, 'Other Project', ?, ?, ?)`,
      ).bind(
        otherProjectId,
        ownerId,
        organizationId,
        "f".repeat(64),
        observedAt,
        observedAt,
      ),
      db.prepare(
        `insert into briar_execution_workers (
           id, project_id, device_id, label, host_fingerprint,
           agent_provider, capabilities_json, state, accepting_work,
           readiness_state, last_heartbeat_at, created_at, updated_at
         ) values (?, ?, ?, 'Other Project Mac', ?, 'codex', ?, 'online', 1,
                   'ready', ?, ?, ?)`,
      ).bind(
        otherWorkerId,
        otherProjectId,
        deviceId,
        "1".repeat(64),
        capabilities,
        observedAt,
        observedAt,
        observedAt,
      ),
    ]);
    const agentInput = {
      name: "Pinned Agent",
      provider: "codex",
      model: null,
      effort: null,
      responsibility: "Keep channel execution on one Worker.",
      designatedWorkerId: workerId,
    };
    const created = await worker.fetch(
      request(`/projects/${projectId}/agents`, "POST", agentInput),
      env(),
    );
    expect(created.status).toBe(201);
    const createdBody = await created.json<{
      agent: {
        id: string;
        designatedWorkerId: string | null;
        designatedWorkerLabel: string | null;
      };
    }>();
    expect(createdBody.agent).toMatchObject({
      designatedWorkerId: workerId,
      designatedWorkerLabel: "Designated Mac",
    });

    const crossProject = await worker.fetch(
      request(`/projects/${projectId}/agents`, "POST", {
        ...agentInput,
        name: "Wrong project",
        designatedWorkerId: otherWorkerId,
      }),
      env(),
    );
    expect(crossProject.status).toBe(400);

    await db.prepare(
      `update briar_execution_workers set accepting_work = 0 where id = ?`,
    ).bind(workerId).run();
    const unavailable = await worker.fetch(
      request(
        `/projects/${projectId}/agents/${createdBody.agent.id}`,
        "PUT",
        agentInput,
      ),
      env(),
    );
    expect(unavailable.status).toBe(409);
    await expect(unavailable.json()).resolves.toMatchObject({
      message: expect.stringContaining("Designated Mac"),
    });

    await db.prepare(
      `update briar_execution_workers
       set accepting_work = 1, state = 'disabled' where id = ?`,
    ).bind(workerId).run();
    const disabled = await worker.fetch(
      request(
        `/projects/${projectId}/agents/${createdBody.agent.id}`,
        "PUT",
        agentInput,
      ),
      env(),
    );
    expect(disabled.status).toBe(409);
    await expect(db.prepare(
      `select designated_worker_id from briar_project_agents where id = ?`,
    ).bind(createdBody.agent.id).first()).resolves.toMatchObject({
      designated_worker_id: workerId,
    });
    await db.prepare(
      `update briar_execution_workers set state = 'online' where id = ?`,
    ).bind(workerId).run();

    await db.prepare(
      `insert into briar_project_execution_worker_policies (
         project_id, selection_mode, created_at, updated_at
       ) values (?, 'allowlist', ?, ?)`,
    ).bind(projectId, observedAt, observedAt).run();
    const deniedByPolicy = await worker.fetch(
      request(
        `/projects/${projectId}/agents/${createdBody.agent.id}`,
        "PUT",
        agentInput,
      ),
      env(),
    );
    expect(deniedByPolicy.status).toBe(409);

    await db.prepare(
      `insert into briar_project_execution_worker_allowlist (
         project_id, worker_id, created_at
       ) values (?, ?, ?)`,
    ).bind(projectId, workerId, observedAt).run();

    await db.prepare(
      `update briar_execution_workers set readiness_state = 'needs_attention'
       where id = ?`,
    ).bind(workerId).run();
    const needsAttention = await worker.fetch(
      request(
        `/projects/${projectId}/agents/${createdBody.agent.id}`,
        "PUT",
        agentInput,
      ),
      env(),
    );
    expect(needsAttention.status).toBe(409);
    await db.prepare(
      `update briar_execution_workers set readiness_state = 'ready'
       where id = ?`,
    ).bind(workerId).run();

    await db.prepare(
      `update briar_execution_worker_credentials set revoked_at = ?
       where device_id = ?`,
    ).bind(observedAt, deviceId).run();
    const revokedCredential = await worker.fetch(
      request(
        `/projects/${projectId}/agents/${createdBody.agent.id}`,
        "PUT",
        agentInput,
      ),
      env(),
    );
    expect(revokedCredential.status).toBe(409);
    await expect(db.prepare(
      `select designated_worker_id from briar_project_agents where id = ?`,
    ).bind(createdBody.agent.id).first()).resolves.toMatchObject({
      designated_worker_id: workerId,
    });
    await db.prepare(
      `update briar_execution_worker_credentials set revoked_at = null
       where device_id = ?`,
    ).bind(deviceId).run();

    await db.batch([
      db.prepare(
        `update briar_execution_workers set last_heartbeat_at = '2000-01-01T00:00:00.000Z'
         where id = ?`,
      ).bind(workerId),
      db.prepare(
        `update briar_execution_worker_devices
         set last_heartbeat_at = '2000-01-01T00:00:00.000Z'
         where id = ?`,
      ).bind(deviceId),
    ]);
    const staleHeartbeat = await worker.fetch(
      request(
        `/projects/${projectId}/agents/${createdBody.agent.id}`,
        "PUT",
        agentInput,
      ),
      env(),
    );
    expect(staleHeartbeat.status).toBe(409);
    await db.batch([
      db.prepare(
        `update briar_execution_workers set last_heartbeat_at = ? where id = ?`,
      ).bind(new Date().toISOString(), workerId),
      db.prepare(
        `update briar_execution_worker_devices set last_heartbeat_at = ? where id = ?`,
      ).bind(new Date().toISOString(), deviceId),
    ]);

    const updated = await worker.fetch(
      request(
        `/projects/${projectId}/agents/${createdBody.agent.id}`,
        "PUT",
        { ...agentInput, responsibility: "Remain pinned after edits." },
      ),
      env(),
    );
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      agent: {
        designatedWorkerId: workerId,
        designatedWorkerLabel: "Designated Mac",
        responsibility: "Remain pinned after edits.",
      },
    });
  });
});
