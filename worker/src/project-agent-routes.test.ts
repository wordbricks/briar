import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import worker from "./index";
import { applyD1Migrations } from "./test-helpers/d1";

describe("project Agent routes", () => {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: "briar-project-agent-routes-test" },
  });
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const projectId = "22222222-2222-4222-8222-222222222222";
  const ownerId = "project-agent-route-owner";
  const sessionToken = "project-agent-route-session-token";
  const now = "2026-08-10T00:00:00.000Z";
  let db: D1Database;

  beforeAll(async () => {
    db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
    await applyD1Migrations(db);
    await db.prepare(
      `insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
       values (?, 'Owner', 'owner@example.com', 1, ?, ?)`,
    ).bind(ownerId, now, now).run();
    await db.prepare(
      `insert into "session" (
         id, expiresAt, token, createdAt, updatedAt, userId
       ) values ('project-agent-route-session', '2099-01-01T00:00:00.000Z',
                 ?, ?, ?, ?)`,
    ).bind(sessionToken, now, now, ownerId).run();
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

  it("uses the OpenCode label for default names on create and update", async () => {
    const input = {
      provider: "opencode",
      model: "vendor/custom-model",
      effort: "high",
      responsibility: "Run project work through OpenCode.",
    };
    const createdResponse = await worker.fetch(
      request(`/projects/${projectId}/agents`, "POST", input),
      env(),
    );

    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json<{
      agent: {
        id: string;
        name: string;
        provider: string;
        model: string | null;
      };
    }>();
    expect(created.agent).toMatchObject({
      name: "OpenCode Agent",
      provider: "opencode",
      model: "vendor/custom-model",
    });

    const updatedResponse = await worker.fetch(
      request(
        `/projects/${projectId}/agents/${created.agent.id}`,
        "PUT",
        { ...input, name: null },
      ),
      env(),
    );

    expect(updatedResponse.status).toBe(200);
    await expect(updatedResponse.json()).resolves.toMatchObject({
      agent: {
        id: created.agent.id,
        name: "OpenCode Agent",
        provider: "opencode",
        model: "vendor/custom-model",
      },
    });
  });

  it("persists 20000-character responsibility and five 20000-character Skills", async () => {
    const responsibility = "r".repeat(20_000);
    const instructions = "s".repeat(20_000);
    const skills = Array.from({ length: 5 }, (_, index) => ({
      name: `Boundary Skill ${index + 1}`,
      instructions,
      provider: "codex" as const,
      model: null,
      effort: null,
      kind: "custom" as const,
      position: index,
    }));
    const createdResponse = await worker.fetch(
      request(`/projects/${projectId}/agents`, "POST", {
        name: "Boundary Agent",
        provider: "codex",
        responsibility,
        skills,
      }),
      env(),
    );

    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json<{
      agent: { id: string; responsibility: string; skills: unknown[] };
    }>();
    expect(created.agent.responsibility).toHaveLength(20_000);
    expect(created.agent.skills).toHaveLength(5);

    const tooManyResponse = await worker.fetch(
      request(`/projects/${projectId}/agents/${created.agent.id}`, "PUT", {
        name: "Boundary Agent",
        provider: "codex",
        responsibility,
        skills: [
          ...skills,
          { ...skills[0], name: "Boundary Skill 6", position: 5 },
        ],
      }),
      env(),
    );
    expect(tooManyResponse.status).toBe(400);

    await expect(
      db.prepare(
        `insert into briar_agent_skills (
           id, agent_id, name, instructions, provider, model, effort, kind,
           is_default, position, created_at, updated_at
         ) values (?, ?, 'Boundary Skill 6', '', 'codex', null, null,
                   'custom', 0, 5, ?, ?)`,
      ).bind(crypto.randomUUID(), created.agent.id, now, now).run(),
    ).rejects.toThrow(/at most 5 Skills/u);
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
        summary: "Repository review complete.",
        events: [{ id: "event-1" }, { id: "event-2" }],
        detailLoaded: true,
      },
    });
  });
});
