import { ProjectRole } from "@briar/contracts/gen/briar/app/v1/common_pb";
import { OrganizationService } from "@briar/contracts/gen/briar/app/v1/organization_pb";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import worker from "./index";
import { createIsolatedTestDatabase } from "./test-helpers/d1";

describe("OrganizationService", () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const otherOrganizationId = "22222222-2222-4222-8222-222222222222";
  const projectId = "33333333-3333-4333-8333-333333333333";
  const otherProjectId = "44444444-4444-4444-8444-444444444444";
  const ownerId = "organization-connect-owner";
  const developerId = "organization-connect-developer";
  const inviteeId = "organization-connect-invitee";
  const mismatchId = "organization-connect-mismatch";
  const now = "2026-08-31T00:00:00.000Z";
  const tokens = {
    owner: "organization-connect-owner-token",
    developer: "organization-connect-developer-token",
    invitee: "organization-connect-invitee-token",
    mismatch: "organization-connect-mismatch-token",
  } as const;
  let miniflare: Miniflare;
  let db: D1Database;

  beforeAll(async () => {
    const database = await createIsolatedTestDatabase({
      suite: "app-connect-organization",
    });
    miniflare = database.miniflare;
    db = database.db;

    const users = [
      [ownerId, "Owner", "owner@example.com", tokens.owner],
      [developerId, "Developer", "developer@example.com", tokens.developer],
      [inviteeId, "Invitee", "invitee@example.com", tokens.invitee],
      [mismatchId, "Mismatch", "mismatch@example.com", tokens.mismatch],
    ] as const;
    for (const [userId, name, email, token] of users) {
      await db.batch([
        db.prepare(
          `insert into "user" (
             id, name, email, emailVerified, createdAt, updatedAt
           ) values (?, ?, ?, 1, ?, ?)`,
        ).bind(userId, name, email, now, now),
        db.prepare(
          `insert into "session" (
             id, expiresAt, token, createdAt, updatedAt, userId
           ) values (?, '2099-01-01T00:00:00.000Z', ?, ?, ?, ?)`,
        ).bind(`session-${userId}`, token, now, now, userId),
      ]);
    }
    await db.batch([
      db.prepare(
        `insert into briar_organizations (id, name, handle, created_at, updated_at)
         values (?, 'Connect Organization', 'connect-organization', ?, ?)`,
      ).bind(organizationId, now, now),
      db.prepare(
        `insert into briar_organizations (id, name, handle, created_at, updated_at)
         values (?, 'Other Organization', 'other-organization', ?, ?)`,
      ).bind(otherOrganizationId, now, now),
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'owner', ?, ?)`,
      ).bind(organizationId, ownerId, now, now),
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'developer', ?, ?)`,
      ).bind(organizationId, developerId, now, now),
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'owner', ?, ?)`,
      ).bind(otherOrganizationId, ownerId, now, now),
      db.prepare(
        `insert into briar_projects (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, 'Invitation Project', ?, ?, ?)`,
      ).bind(projectId, ownerId, organizationId, "a".repeat(64), now, now),
      db.prepare(
        `insert into briar_projects (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, 'Other Project', ?, ?, ?)`,
      ).bind(
        otherProjectId,
        ownerId,
        otherOrganizationId,
        "b".repeat(64),
        now,
        now,
      ),
    ]);
  }, 60_000);

  afterAll(async () => {
    await miniflare.dispose();
  });

  const client = () =>
    createClient(
      OrganizationService,
      createConnectTransport({
        baseUrl: "https://briar.example",
        fetch: async (input, init) =>
          worker.fetch(new Request(input, init), {
            DB: db,
            ATTACHMENTS: {},
            ARCHIVES: {},
            BETTER_AUTH_SECRET:
              "briar-test-secret-that-is-at-least-32-characters",
            GOOGLE_CLIENT_ID: "google-client",
            GOOGLE_CLIENT_SECRET: "google-secret",
          } as never),
      }),
    );

  const options = (token: string) => ({
    headers: { authorization: `Bearer ${token}` },
  });

  const errorCode = async (operation: Promise<unknown>) => {
    const error = await operation.catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ConnectError);
    return (error as ConnectError).code;
  };

  it("keeps invitations private, capability-scoped, idempotent, and project-scoped", async () => {
    const organization = client();
    expect(
      await errorCode(organization.createOrganizationInvitation(
        {
          organizationId,
          email: "invitee@example.com",
          role: ProjectRole.EDITOR,
          initialProjectId: projectId,
        },
        options(tokens.developer),
      )),
    ).toBe(Code.PermissionDenied);
    expect(
      await errorCode(organization.createOrganizationInvitation(
        {
          organizationId,
          email: "invitee@example.com",
          role: ProjectRole.OWNER,
          initialProjectId: projectId,
        },
        options(tokens.owner),
      )),
    ).toBe(Code.InvalidArgument);
    expect(
      await errorCode(organization.updateOrganizationLogo(
        { organizationId },
        options(tokens.owner),
      )),
    ).toBe(Code.InvalidArgument);

    const created = await organization.createOrganizationInvitation(
      {
        organizationId,
        email: " Invitee@Example.com ",
        role: ProjectRole.EDITOR,
        initialProjectId: projectId,
      },
      options(tokens.owner),
    );
    expect(created.invitation).toMatchObject({
      organizationId,
      email: "invitee@example.com",
      role: ProjectRole.EDITOR,
    });
    const invitationToken = created.invitePath.split("/").at(-1);
    expect(invitationToken).toMatch(/^briar_invite_[0-9a-f]{64}$/u);

    const preview = await organization.getOrganizationInvitation({
      token: invitationToken!,
    });
    expect(preview.invitation).toMatchObject({
      organizationId,
      emailHint: "i***@example.com",
    });
    expect(preview.invitation).not.toHaveProperty("email");

    expect(
      await errorCode(organization.acceptOrganizationInvitation(
        { token: invitationToken! },
        options(tokens.mismatch),
      )),
    ).toBe(Code.FailedPrecondition);
    const accepted = await organization.acceptOrganizationInvitation(
      { token: invitationToken! },
      options(tokens.invitee),
    );
    expect(accepted.alreadyAccepted).toBe(false);
    const repeated = await organization.acceptOrganizationInvitation(
      { token: invitationToken! },
      options(tokens.invitee),
    );
    expect(repeated.alreadyAccepted).toBe(true);

    const members = await organization.listOrganizationMembers(
      { organizationId },
      options(tokens.owner),
    );
    expect(
      members.members.find((member) => member.userId === inviteeId),
    ).toMatchObject({
      role: ProjectRole.EDITOR,
      projectIds: [projectId],
    });
    expect(
      await errorCode(organization.updateOrganizationMemberProjects(
        {
          organizationId,
          userId: inviteeId,
          projectIds: [otherProjectId],
        },
        options(tokens.owner),
      )),
    ).toBe(Code.InvalidArgument);
    expect(
      await errorCode(organization.updateOrganizationMemberRole(
        {
          organizationId,
          userId: inviteeId,
          role: ProjectRole.VIEWER,
        },
        options(tokens.developer),
      )),
    ).toBe(Code.PermissionDenied);
  });
});
