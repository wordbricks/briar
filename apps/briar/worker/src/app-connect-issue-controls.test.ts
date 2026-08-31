import { IssueService } from "@briar/contracts/gen/briar/app/v1/issue_pb";
import { WorkflowCheckpoint_Position } from "@briar/contracts/gen/briar/types/v1/workflow_pb";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createIssueAttachments,
  createIssueMessage,
  getIssueMessage,
  listIssueAttachments,
} from "./db";
import worker from "./index";
import {
  createIsolatedTestDatabase,
  type IsolatedTestDatabase,
} from "./test-helpers/d1";

describe("IssueService controls", () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const projectId = "22222222-2222-4222-8222-222222222222";
  const checkpointRunId = "33333333-3333-4333-8333-333333333333";
  const messageRunId = "44444444-4444-4444-8444-444444444444";
  const messageId = "55555555-5555-4555-8555-555555555555";
  const attachmentId = "66666666-6666-4666-8666-666666666666";
  const ownerId = "issue-connect-owner";
  const developerId = "issue-connect-developer";
  const editorId = "issue-connect-editor";
  const now = "2026-08-31T00:00:00.000Z";
  const tokens = {
    owner: "issue-connect-owner-token",
    developer: "issue-connect-developer-token",
    editor: "issue-connect-editor-token",
  } as const;
  const attachmentObjectKey =
    `issue-attachments/${projectId}/${messageRunId}/${attachmentId}`;
  const deleteAttachmentObjects = vi.fn().mockResolvedValue(undefined);
  let database: IsolatedTestDatabase;
  let db: D1Database;

  const workflow = {
    version: 2,
    requirements: [],
    stages: [{ id: "implementing", label: "Implement", required: true }],
    completion: { requiredStages: ["implementing"] },
    execution: { checkpoints: [] },
  } as const;

  beforeAll(async () => {
    database = await createIsolatedTestDatabase({
      suite: "app-connect-issue-controls",
    });
    db = database.db;
    const users = [
      [ownerId, "Owner", "owner@example.com", "owner", tokens.owner],
      [
        developerId,
        "Developer",
        "developer@example.com",
        "developer",
        tokens.developer,
      ],
      [editorId, "Editor", "editor@example.com", "editor", tokens.editor],
    ] as const;
    await db.batch([
      ...users.flatMap(([id, name, email, role, token]) => [
        db
          .prepare(
            `insert into "user" (
             id, name, email, emailVerified, createdAt, updatedAt
           ) values (?, ?, ?, 1, ?, ?)`,
          )
          .bind(id, name, email, now, now),
        db
          .prepare(
            `insert into "session" (
             id, expiresAt, token, createdAt, updatedAt, userId
           ) values (?, '2099-01-01T00:00:00.000Z', ?, ?, ?, ?)`,
          )
          .bind(`session-${role}`, token, now, now, id),
      ]),
      db
        .prepare(
          `insert into briar_organizations (
           id, name, handle, created_at, updated_at
         ) values (?, 'Issue Controls', 'issue-controls', ?, ?)`,
        )
        .bind(organizationId, now, now),
      ...users.map(([id, _name, _email, role]) =>
        db
          .prepare(
            `insert into briar_organization_members (
             organization_id, user_id, role, created_at, updated_at
           ) values (?, ?, ?, ?, ?)`,
          )
          .bind(organizationId, id, role, now, now)
      ),
      db
        .prepare(
          `insert into briar_projects (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, 'Issue Controls', ?, ?, ?)`,
        )
        .bind(projectId, ownerId, organizationId, "a".repeat(64), now, now),
      ...[developerId, editorId].map((id) =>
        db
          .prepare(
            `insert into briar_project_members (
             project_id, organization_id, user_id, created_at, updated_at
           ) values (?, ?, ?, ?, ?)`,
          )
          .bind(projectId, organizationId, id, now, now)
      ),
    ]);

    const insertRun = `insert into briar_hunt_runs (
      id, project_id, source, source_key, title, stage, status,
      workflow_stage, workflow_snapshot_json, issue_checkpoints_json,
      repository, started_at, last_event_at, created_at, updated_at
    ) values (?, ?, 'issue', ?, ?, ?, ?, ?, ?, '[]',
      'briar/issue-controls', ?, ?, ?, ?)`;
    await db.batch([
      db
        .prepare(insertRun)
        .bind(
          checkpointRunId,
          projectId,
          "issue-checkpoint-controls",
          "Checkpoint controls",
          "queued",
          "queued",
          null,
          JSON.stringify(workflow),
          now,
          now,
          now,
          now,
        ),
      db
        .prepare(insertRun)
        .bind(
          messageRunId,
          projectId,
          "issue-message-controls",
          "Message controls",
          "implementing",
          "running",
          "implementing",
          JSON.stringify(workflow),
          now,
          now,
          now,
          now,
        ),
    ]);
    await createIssueAttachments(db, projectId, messageRunId, [
      {
        id: attachmentId,
        object_key: attachmentObjectKey,
        filename: "draft.png",
        content_type: "image/png",
        byte_size: 12,
      },
    ]);
    await createIssueMessage(db, {
      id: messageId,
      projectId,
      runId: messageRunId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentProvider: null,
      body: `Keep ![draft](briar-attachment://${attachmentId})`,
      createdAt: now,
    });
  }, 60_000);

  afterAll(async () => database.dispose());

  const client = (token: string) =>
    createClient(
      IssueService,
      createConnectTransport({
        baseUrl: "https://briar.example",
        fetch: async (input, init) =>
          worker.fetch(new Request(input, init), {
            DB: db,
            ATTACHMENTS: { delete: deleteAttachmentObjects },
            ARCHIVES: { get: vi.fn().mockResolvedValue(null) },
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

  it("enforces checkpoint capability and pre-execution eligibility", async () => {
    const request = {
      projectId,
      runId: checkpointRunId,
      checkpoints: [
        {
          key: "before-implementing",
          stage: "implementing",
          position: WorkflowCheckpoint_Position.BEFORE,
        },
      ],
    };
    expect(
      await errorCode(
        client(tokens.editor).updateIssueCheckpoints(
          request,
          options(tokens.editor),
        ),
      ),
    ).toBe(Code.PermissionDenied);

    await expect(
      client(tokens.owner).updateIssueCheckpoints(
        request,
        options(tokens.owner),
      ),
    ).resolves.toMatchObject({
      runId: checkpointRunId,
      checkpoints: [
        {
          key: "before-implementing",
          position: WorkflowCheckpoint_Position.BEFORE,
        },
      ],
    });
    await db
      .prepare(
        `update briar_hunt_runs set status = 'running', stage = 'implementing'
       where id = ?`,
      )
      .bind(checkpointRunId)
      .run();
    expect(
      await errorCode(
        client(tokens.owner).updateIssueCheckpoints(
          request,
          options(tokens.owner),
        ),
      ),
    ).toBe(Code.FailedPrecondition);
  });

  it("keeps message ownership and run attachment lifecycle inside the application boundary", async () => {
    const developer = client(tokens.developer);
    expect(
      await errorCode(
        developer.updateIssueMessage(
          {
            projectId,
            runId: messageRunId,
            messageId,
            body: "Unauthorized edit",
          },
          options(tokens.developer),
        ),
      ),
    ).toBe(Code.PermissionDenied);

    const owner = client(tokens.owner);
    await expect(
      owner.updateIssueMessage(
        {
          projectId,
          runId: messageRunId,
          messageId,
          body: "Inline reference removed",
        },
        options(tokens.owner),
      ),
    ).resolves.toMatchObject({
      message: { id: messageId, body: "Inline reference removed" },
    });
    await expect(listIssueAttachments(db, projectId, messageRunId)).resolves
      .toEqual([expect.objectContaining({
        id: attachmentId,
        object_key: attachmentObjectKey,
      })]);
    expect(deleteAttachmentObjects).not.toHaveBeenCalled();

    await expect(
      owner.deleteIssueMessage(
        { projectId, runId: messageRunId, messageId },
        options(tokens.owner),
      ),
    ).resolves.toMatchObject({ deleted: true });
    await expect(getIssueMessage(db, projectId, messageRunId, messageId))
      .resolves.toBeNull();
    await expect(listIssueAttachments(db, projectId, messageRunId)).resolves
      .toEqual([expect.objectContaining({
        id: attachmentId,
        object_key: attachmentObjectKey,
      })]);
    expect(deleteAttachmentObjects).not.toHaveBeenCalled();
  });
});
