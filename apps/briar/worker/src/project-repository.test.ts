import type { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listOrganizations } from "./organization-repository";
import {
  listOrganizationInboxProjects,
  listOrganizationProjects,
  listProjects,
} from "./project-repository";
import {
  createIsolatedTestDatabase,
  executeD1Sql,
} from "./test-helpers/d1";

describe("organization and project repositories", () => {
  let miniflare: Miniflare;
  let db: D1Database;
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const projectId = "22222222-2222-4222-8222-222222222222";

  beforeAll(async () => {
    const database = await createIsolatedTestDatabase({
      suite: "project-repository",
    });
    miniflare = database.miniflare;
    db = database.db;
    const now = "2026-08-20T00:00:00.000Z";
    await executeD1Sql(
      db,
      `
      insert into user (id, name, email, emailVerified, createdAt, updatedAt)
      values ('owner', 'Owner', 'owner@example.com', 1, '${now}', '${now}');
      insert into user (id, name, email, emailVerified, createdAt, updatedAt)
      values ('outsider', 'Outsider', 'outsider@example.com', 1, '${now}', '${now}');
      insert into briar_organizations (
        id, name, handle, created_at, updated_at
      ) values (
        '${organizationId}', 'Briar', 'briar', '${now}', '${now}'
      );
      insert into briar_organization_members (
        organization_id, user_id, role, created_at, updated_at
      ) values (
        '${organizationId}', 'owner', 'owner', '${now}', '${now}'
      );
      insert into briar_projects (
        id, owner_user_id, organization_id, name, agent_token_hash,
        created_at, updated_at
      ) values (
        '${projectId}', 'owner', '${organizationId}', 'First project',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '${now}', '${now}'
      );
      `,
    );
  });

  afterAll(async () => {
    await miniflare.dispose();
  });

  it("decodes organizations with the caller membership role", async () => {
    await expect(listOrganizations(db, "owner")).resolves.toEqual([
      {
        id: organizationId,
        name: "Briar",
        handle: "briar",
        logo: null,
        role: "owner",
        created_at: "2026-08-20T00:00:00.000Z",
      },
    ]);
    await expect(listOrganizations(db, "outsider")).resolves.toEqual([]);
  });

  it("decodes membership and organization-scoped project views", async () => {
    await expect(listProjects(db, "owner")).resolves.toEqual([
      expect.objectContaining({
        id: projectId,
        organization_id: organizationId,
        organization_name: "Briar",
        member_role: "owner",
      }),
    ]);
    await expect(listProjects(db, "outsider")).resolves.toEqual([]);
    await expect(
      listOrganizationProjects(db, organizationId),
    ).resolves.toEqual([
      expect.objectContaining({
        id: projectId,
        member_role: "member",
      }),
    ]);
    await expect(
      listOrganizationInboxProjects(db, organizationId),
    ).resolves.toEqual([
      {
        id: projectId,
        name: "First project",
        issue_key_prefix: "AH",
      },
    ]);
  });
});
