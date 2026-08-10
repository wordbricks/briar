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

  const request = (pathname: string, method: "POST" | "PUT", body: unknown) =>
    new Request(`https://briar.example${pathname}`, {
      method,
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
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
      agent: { id: string; name: string; provider: string; model: string | null };
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
});
