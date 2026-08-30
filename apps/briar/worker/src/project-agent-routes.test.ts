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
  const editorId = "project-agent-route-editor";
  const viewerId = "project-agent-route-viewer";
  const sessionToken = "project-agent-route-session-token";
  const memberSessionToken = "project-agent-route-member-session-token";
  const editorSessionToken = "project-agent-route-editor-session-token";
  const viewerSessionToken = "project-agent-route-viewer-session-token";
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
      `insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
       values
         (?, 'Editor', 'editor@example.com', 1, ?, ?),
         (?, 'Viewer', 'viewer@example.com', 1, ?, ?)`,
    ).bind(editorId, now, now, viewerId, now, now).run();
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
      `insert into "session" (
         id, expiresAt, token, createdAt, updatedAt, userId
       ) values
         ('project-agent-route-editor-session', '2099-01-01T00:00:00.000Z',
          ?, ?, ?, ?),
         ('project-agent-route-viewer-session', '2099-01-01T00:00:00.000Z',
          ?, ?, ?, ?)`,
    ).bind(
      editorSessionToken,
      now,
      now,
      editorId,
      viewerSessionToken,
      now,
      now,
      viewerId,
    ).run();
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
       ) values (?, ?, 'developer', ?, ?)`,
    ).bind(organizationId, memberId, now, now).run();
    await db.prepare(
      `insert into briar_organization_members (
         organization_id, user_id, role, created_at, updated_at
       ) values
         (?, ?, 'editor', ?, ?),
         (?, ?, 'viewer', ?, ?)`,
    ).bind(
      organizationId,
      editorId,
      now,
      now,
      organizationId,
      viewerId,
      now,
      now,
    ).run();
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
    await db.prepare(
      `insert into briar_project_members (
         project_id, organization_id, user_id, created_at, updated_at
       ) values
         (?, ?, ?, ?, ?),
         (?, ?, ?, ?, ?)`,
    ).bind(
      projectId,
      organizationId,
      editorId,
      now,
      now,
      projectId,
      organizationId,
      viewerId,
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

  it("allows developers and rejects editor or viewer development changes", async () => {
    const input = {
      name: "Capability Agent",
      provider: "codex",
      responsibility: "Verify development authorization.",
    };
    const developerResponse = await worker.fetch(
      request(`/projects/${projectId}/agents`, "POST", input, {
        authorization: `Bearer ${memberSessionToken}`,
      }),
      env(),
    );
    expect(developerResponse.status).toBe(201);

    for (const token of [editorSessionToken, viewerSessionToken]) {
      const response = await worker.fetch(
        request(`/projects/${projectId}/agents`, "POST", input, {
          authorization: `Bearer ${token}`,
        }),
        env(),
      );
      expect(response.status).toBe(403);
    }
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
