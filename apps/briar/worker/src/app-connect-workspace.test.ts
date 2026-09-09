import { ProjectRole } from "@briar/contracts/gen/briar/app/v1/common_pb";
import { WorkspaceService as WorkspaceService} from "@briar/contracts/gen/briar/app/v1/workspace_pb";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "./index";

describe("WorkspaceService", () => {
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const otherWorkspaceId = "22222222-2222-4222-8222-222222222222";
  const projectId = "33333333-3333-4333-8333-333333333333";
  const otherProjectId = "44444444-4444-4444-8444-444444444444";
  const ownerId = "workspace-connect-owner";
  const developerId = "workspace-connect-developer";
  const inviteeId = "workspace-connect-invitee";
  const mismatchId = "workspace-connect-mismatch";
  const now = "2026-08-31T00:00:00.000Z";
  const tokens = {
    owner: "workspace-connect-owner-token",
    developer: "workspace-connect-developer-token",
    invitee: "workspace-connect-invitee-token",
    mismatch: "workspace-connect-mismatch-token",
  } as const;
  const db = env.DB;

  beforeAll(async () => {
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
         values (?, 'Connect Workspace', 'connect-workspace', ?, ?)`,
      ).bind(workspaceId, now, now),
      db.prepare(
        `insert into briar_organizations (id, name, handle, created_at, updated_at)
         values (?, 'Other Workspace', 'other-workspace', ?, ?)`,
      ).bind(otherWorkspaceId, now, now),
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'owner', ?, ?)`,
      ).bind(workspaceId, ownerId, now, now),
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'developer', ?, ?)`,
      ).bind(workspaceId, developerId, now, now),
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'owner', ?, ?)`,
      ).bind(otherWorkspaceId, ownerId, now, now),
      db.prepare(
        `insert into briar_projects (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, 'Invitation Project', ?, ?, ?)`,
      ).bind(projectId, ownerId, workspaceId, "a".repeat(64), now, now),
      db.prepare(
        `insert into briar_projects (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, 'Other Project', ?, ?, ?)`,
      ).bind(
        otherProjectId,
        ownerId,
        otherWorkspaceId,
        "b".repeat(64),
        now,
        now,
      ),
    ]);
  }, 60_000);

  const client = () =>
    createClient(
      WorkspaceService,
      createConnectTransport({
        baseUrl: "https://briar.example",
        fetch: async (input, init) =>
          worker.fetch(new Request(input, { ...init, redirect: "manual" }), {
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
    const workspace = client();
    expect(
      await errorCode(workspace.createWorkspaceInvitation(
        {
          workspaceId: workspaceId,
          email: "invitee@example.com",
          role: ProjectRole.EDITOR,
          initialProjectId: projectId,
        },
        options(tokens.developer),
      )),
    ).toBe(Code.PermissionDenied);
    expect(
      await errorCode(workspace.createWorkspaceInvitation(
        {
          workspaceId: workspaceId,
          email: "invitee@example.com",
          role: ProjectRole.OWNER,
          initialProjectId: projectId,
        },
        options(tokens.owner),
      )),
    ).toBe(Code.InvalidArgument);
    expect(
      await errorCode(workspace.updateWorkspaceLogo(
        { workspaceId: workspaceId },
        options(tokens.owner),
      )),
    ).toBe(Code.InvalidArgument);

    const created = await workspace.createWorkspaceInvitation(
      {
        workspaceId: workspaceId,
        email: " Invitee@Example.com ",
        role: ProjectRole.EDITOR,
        initialProjectId: projectId,
      },
      options(tokens.owner),
    );
    expect(created.invitation).toMatchObject({
      workspaceId: workspaceId,
      email: "invitee@example.com",
      role: ProjectRole.EDITOR,
    });
    const invitationToken = created.invitePath.split("/").at(-1);
    expect(invitationToken).toMatch(/^briar_invite_[0-9a-f]{64}$/u);

    const preview = await workspace.getWorkspaceInvitation({
      token: invitationToken!,
    });
    expect(preview.invitation).toMatchObject({
      workspaceId: workspaceId,
      emailHint: "i***@example.com",
    });
    expect(preview.invitation).not.toHaveProperty("email");

    expect(
      await errorCode(workspace.acceptWorkspaceInvitation(
        { token: invitationToken! },
        options(tokens.mismatch),
      )),
    ).toBe(Code.FailedPrecondition);
    const accepted = await workspace.acceptWorkspaceInvitation(
      { token: invitationToken! },
      options(tokens.invitee),
    );
    expect(accepted.alreadyAccepted).toBe(false);
    const repeated = await workspace.acceptWorkspaceInvitation(
      { token: invitationToken! },
      options(tokens.invitee),
    );
    expect(repeated.alreadyAccepted).toBe(true);

    const members = await workspace.listWorkspaceMembers(
      { workspaceId: workspaceId },
      options(tokens.owner),
    );
    expect(
      members.members.find((member) => member.userId === inviteeId),
    ).toMatchObject({
      role: ProjectRole.EDITOR,
      projectIds: [projectId],
    });
    expect(
      await errorCode(workspace.updateWorkspaceMemberProjects(
        {
          workspaceId: workspaceId,
          userId: inviteeId,
          projectIds: [otherProjectId],
        },
        options(tokens.owner),
      )),
    ).toBe(Code.InvalidArgument);
    expect(
      await errorCode(workspace.updateWorkspaceMemberRole(
        {
          workspaceId: workspaceId,
          userId: inviteeId,
          role: ProjectRole.VIEWER,
        },
        options(tokens.developer),
      )),
    ).toBe(Code.PermissionDenied);
  });
});
