import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import {
  listOrganizations,
  listProjectMembers,
} from "./organization-repository";
import {
  listOrganizationInboxProjects,
  listOrganizationProjects,
  listProjects,
} from "./project-repository";
import { executeD1Sql } from "./test-helpers/d1";

describe("organization and project repositories", () => {
  const db = env.DB;
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const projectId = "22222222-2222-4222-8222-222222222222";

  beforeAll(async () => {
    const now = "2026-08-20T00:00:00.000Z";
    await executeD1Sql(
      db,
      `
      insert into user (id, name, email, emailVerified, createdAt, updatedAt)
      values ('owner', 'Owner', 'owner@example.com', 1, '${now}', '${now}');
      insert into user (id, name, email, emailVerified, createdAt, updatedAt)
      values ('outsider', 'Outsider', 'outsider@example.com', 1, '${now}', '${now}');
      insert into user (id, name, email, emailVerified, createdAt, updatedAt)
      values ('member', 'Member', 'member@example.com', 1, '${now}', '${now}');
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
      insert into briar_organization_members (
        organization_id, user_id, role, created_at, updated_at
      ) values (
        '${organizationId}', 'member', 'developer', '${now}', '${now}'
      );
      insert into briar_teams (
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
        member_role: "viewer",
      }),
    ]);
    await expect(
      listOrganizationInboxProjects(db, organizationId, "owner"),
    ).resolves.toEqual([
      {
        id: projectId,
        name: "First project",
        issue_key_prefix: "AH",
      },
    ]);
  });

  it("limits regular members to explicitly assigned projects", async () => {
    await expect(listProjects(db, "member")).resolves.toEqual([]);
    await expect(
      listOrganizationInboxProjects(db, organizationId, "member"),
    ).resolves.toEqual([]);
    await expect(listProjectMembers(db, projectId)).resolves.toEqual([
      expect.objectContaining({ user_id: "owner", role: "owner" }),
    ]);

    const now = "2026-08-20T00:05:00.000Z";
    await db.prepare(
      `insert into briar_project_members (
         project_id, organization_id, user_id, created_at, updated_at
       ) values (?, ?, 'member', ?, ?)`,
    ).bind(projectId, organizationId, now, now).run();

    await expect(listProjects(db, "member")).resolves.toEqual([
      expect.objectContaining({ id: projectId, member_role: "developer" }),
    ]);
    await expect(
      listOrganizationInboxProjects(db, organizationId, "member"),
    ).resolves.toEqual([
      expect.objectContaining({ id: projectId }),
    ]);
    await expect(listProjectMembers(db, projectId)).resolves.toEqual([
      expect.objectContaining({ user_id: "owner", role: "owner" }),
      expect.objectContaining({ user_id: "member", role: "developer" }),
    ]);
  });
});
