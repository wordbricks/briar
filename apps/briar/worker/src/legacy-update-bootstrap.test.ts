import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "./index";
import { executeD1Sql } from "./test-helpers/d1";

describe("Briar 1.2.174 update bootstrap", () => {
  const db = env.DB;
  const userId = "legacy-update-user";
  const token = "legacy-update-token";
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const projectId = "22222222-2222-4222-8222-222222222222";
  const observedAt = "2026-09-01T00:00:00.000Z";

  beforeAll(async () => {
    await executeD1Sql(db, `
      insert into "user" (
        id, username, name, email, emailVerified, image, createdAt, updatedAt
      ) values (
        '${userId}', 'legacy_user', 'Legacy User', 'legacy@example.com', 1,
        null, '${observedAt}', '${observedAt}'
      );
      insert into "session" (
        id, expiresAt, token, createdAt, updatedAt, userId
      ) values (
        'legacy-update-session', '2099-01-01T00:00:00.000Z', '${token}',
        '${observedAt}', '${observedAt}', '${userId}'
      );
      insert into briar_organizations (
        id, name, handle, created_at, updated_at
      ) values (
        '${organizationId}', 'Legacy Organization', 'legacy-organization',
        '${observedAt}', '${observedAt}'
      );
      insert into briar_organization_members (
        organization_id, user_id, role, created_at, updated_at
      ) values (
        '${organizationId}', '${userId}', 'owner',
        '${observedAt}', '${observedAt}'
      );
      insert into briar_teams (
        id, owner_user_id, organization_id, name, agent_token_hash,
        created_at, updated_at
      ) values (
        '${projectId}', '${userId}', '${organizationId}', 'Legacy Project',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '${observedAt}', '${observedAt}'
      );
    `);
  }, 60_000);

  const fetch = (pathname: string) =>
    worker.fetch(
      new Request(`https://briar.example${pathname}`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      {
        DB: db,
        ATTACHMENTS: {},
        ARCHIVES: {},
        BETTER_AUTH_SECRET:
          "briar-test-secret-that-is-at-least-32-characters",
        GOOGLE_CLIENT_ID: "google-client",
        GOOGLE_CLIENT_SECRET: "google-secret",
      } as never,
    );

  it("restores the session far enough to render the signed-update UI", async () => {
    const [me, organizations, projects] = await Promise.all([
      fetch("/me"),
      fetch("/organizations"),
      fetch("/projects"),
    ]);

    expect([me.status, organizations.status, projects.status]).toEqual([
      200,
      200,
      200,
    ]);
    await expect(me.json()).resolves.toEqual({
      user: {
        id: userId,
        username: "legacy_user",
        name: "Legacy User",
        email: "legacy@example.com",
        image: null,
      },
    });
    await expect(organizations.json()).resolves.toEqual({
      organizations: [{
        id: organizationId,
        name: "Legacy Organization",
        handle: "legacy-organization",
        logo: null,
        role: "owner",
        createdAt: observedAt,
      }],
    });
    await expect(projects.json()).resolves.toEqual({
      projects: [{
        id: projectId,
        workspaceId: organizationId,
        teamId: projectId,
        name: "Legacy Project",
        issueKeyPrefix: "AH",
        scheduleTabEnabled: true,
        icon: null,
        organizationId,
        organizationName: "Legacy Organization",
        role: "owner",
        createdAt: observedAt,
      }],
    });
  });
});
