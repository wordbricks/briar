import { create } from "@bufbuild/protobuf";
import { UploadFileMetadataSchema } from "@briar/contracts/gen/briar/types/v1/upload_pb";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  prepareCreateIssueAttachmentsApplication,
  prepareUpdateIssueAttachmentsApplication,
} from "./issue-attachment-upload-application";
import {
  createProjectIssue,
  updateProjectIssue,
} from "./issue-core-routes";
import { getHuntRunForProject, listIssueAttachments } from "./db";
import { updateIssueMutationStatements } from "./issue-create-update-repository";
import {
  decodeIssueInput,
  decodeIssueUpdateInput,
} from "./issue-request-contract";
import { uploadReservedFileApplication } from "./upload-application";
import {
  createIssueFromServerFilesApplication,
  type ServerIssueCreateApplicationServices,
} from "./server-issue-create-application";
import { processUploadCleanupQueue } from "./upload-repository";
import {
  createIsolatedTestDatabase,
  type IsolatedTestDatabase,
} from "./test-helpers/d1";

const organizationId = "a7100000-0000-4000-8000-000000000001";
const projectId = "b7100000-0000-4000-8000-000000000001";
const ownerId = "issue-attachment-owner";
const signingSecret = "issue-attachment-upload-secret".repeat(4);

const digest = (body: ArrayBuffer) =>
  Uint8Array.from(createHash("sha256").update(new Uint8Array(body)).digest());

describe("issue create and update attachment mutations", () => {
  let database: IsolatedTestDatabase;
  let db: D1Database;
  const objects = new Map<string, ArrayBuffer>();
  const bucket = {
    put: vi.fn(async (key: string, value: ArrayBuffer) => {
      objects.set(key, value.slice(0));
      return {};
    }),
  } as unknown as R2Bucket;

  beforeAll(async () => {
    database = await createIsolatedTestDatabase({
      suite: "issue-attachment-mutations",
    });
    db = database.db;
    const now = new Date().toISOString();
    await db.batch([
      db.prepare(
        `insert into "user" (
           id, name, email, emailVerified, createdAt, updatedAt
         ) values (?, 'Owner', 'issue-owner@example.com', 1, ?, ?)`,
      ).bind(ownerId, now, now),
      db.prepare(
        `insert into briar_organizations (
           id, name, handle, created_at, updated_at
         ) values (?, 'Issue Uploads', 'issue-uploads', ?, ?)`,
      ).bind(organizationId, now, now),
    ]);
    await db.batch([
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'owner', ?, ?)`,
      ).bind(organizationId, ownerId, now, now),
      db.prepare(
        `insert into briar_projects (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, 'Issue Project', ?, ?, ?)`,
      ).bind(projectId, ownerId, organizationId, "a".repeat(64), now, now),
    ]);
    await db.prepare(
      `insert into briar_project_settings (
         project_id, workflow_json, mandatory_checkpoints_json,
         created_at, updated_at
       ) values (?, ?, '[]', ?, ?)`,
    ).bind(projectId, JSON.stringify({
      version: 2,
      requirements: [],
      stages: [{ id: "implementing", label: "Implement", required: true }],
      execution: { checkpoints: [] },
      completion: { requiredStages: ["implementing"] },
    }), now, now).run();
  }, 60_000);

  afterAll(async () => database.dispose());

  const prepareAndUpload = async (input: {
    purpose: "create" | "update";
    mutationId: string;
    runId?: string;
    filename: string;
  }) => {
    const body = new TextEncoder().encode(`bytes:${input.filename}`).buffer;
    const request = {
      db,
      signingSecret,
      projectId,
      userId: ownerId,
      preparationRequestId: crypto.randomUUID(),
      mutationId: input.mutationId,
      attachments: [create(UploadFileMetadataSchema, {
        clientId: crypto.randomUUID(),
        filename: input.filename,
        contentType: "image/png",
        byteSize: BigInt(body.byteLength),
        sha256: digest(body),
      })],
    };
    const prepared = input.purpose === "create"
      ? await prepareCreateIssueAttachmentsApplication(request)
      : await prepareUpdateIssueAttachmentsApplication({
        ...request,
        runId: input.runId!,
      });
    const upload = prepared.uploads[0]!;
    await uploadReservedFileApplication({
      db,
      bucket,
      signingSecret,
      uploadId: upload.uploadId,
      capability: upload.uploadCapability,
      contentType: "image/png",
      body,
    });
    return upload.uploadId;
  };

  it("creates the canonical run, consumes its upload once, and exactly replays", async () => {
    const clientIssueId = crypto.randomUUID();
    const uploadId = await prepareAndUpload({
      purpose: "create",
      mutationId: clientIssueId,
      filename: "create.png",
    });
    const request = decodeIssueInput({
      title: "Prepared create",
      description: `![create](briar-attachment://${uploadId})`,
      status: "backlog",
      checkpoints: [],
      fullAuto: false,
    });
    const input = {
      db,
      projectId,
      userId: ownerId,
      clientIssueId,
      request,
      attachmentIds: [uploadId],
    };

    const created = await createProjectIssue(input);
    expect(created).toMatchObject({
      runId: clientIssueId,
      attachments: [{ id: uploadId }],
    });
    await expect(createProjectIssue(input)).resolves.toEqual(created);
    await expect(createProjectIssue({
      ...input,
      request: decodeIssueInput({ ...request, title: "Changed retry" }),
    })).rejects.toMatchObject({ status: 409 });

    const stored = await db.prepare(
      `select run.id, upload.consumer_kind, upload.consumer_id
       from briar_hunt_runs run
       join briar_uploads upload on upload.upload_id = ?
       where run.id = ?`,
    ).bind(uploadId, clientIssueId).first<{
      id: string;
      consumer_kind: string;
      consumer_id: string;
    }>();
    expect(stored).toEqual({
      id: clientIssueId,
      consumer_kind: "issue_create",
      consumer_id: clientIssueId,
    });
  });

  it("updates an exact attachment snapshot and durably queues removed bytes", async () => {
    const clientIssueId = crypto.randomUUID();
    const originalUploadId = await prepareAndUpload({
      purpose: "create",
      mutationId: clientIssueId,
      filename: "original.png",
    });
    const created = await createProjectIssue({
      db,
      projectId,
      userId: ownerId,
      clientIssueId,
      request: decodeIssueInput({
        title: "Before update",
        description: `![original](briar-attachment://${originalUploadId})`,
        status: "queued",
        checkpoints: [],
        fullAuto: false,
      }),
      attachmentIds: [originalUploadId],
    });
    const requestId = crypto.randomUUID();
    const replacementUploadId = await prepareAndUpload({
      purpose: "update",
      mutationId: requestId,
      runId: created.runId,
      filename: "replacement.png",
    });
    const request = decodeIssueUpdateInput({
      title: "After update",
      description: `![replacement](briar-attachment://${replacementUploadId})`,
      priority: 2,
      difficulty: "hard",
      assigneeUserId: null,
    });
    const input = {
      db,
      projectId,
      runId: created.runId,
      userId: ownerId,
      requestId,
      request,
      keptAttachmentIds: [],
      attachmentIds: [replacementUploadId],
    };

    const updated = await updateProjectIssue(input);
    expect(updated).toMatchObject({
      runId: created.runId,
      title: "After update",
      attachments: [{ id: replacementUploadId }],
    });
    await expect(updateProjectIssue(input)).resolves.toEqual(updated);
    await expect(updateProjectIssue({
      ...input,
      request: decodeIssueUpdateInput({ ...request, title: "Changed retry" }),
    })).rejects.toMatchObject({ status: 409 });

    const cleanup = await db.prepare(
      `select queue.object_key
       from briar_upload_cleanup_queue queue
       join briar_uploads upload on upload.object_key = queue.object_key
       where upload.upload_id = ?`,
    ).bind(originalUploadId).first<{ object_key: string }>();
    expect(cleanup?.object_key).toContain(originalUploadId);
    expect(await db.prepare(
      `select id from briar_issue_attachments where id = ?`,
    ).bind(originalUploadId).first()).toBeNull();

    await expect(updateProjectIssue({
      ...input,
      requestId: crypto.randomUUID(),
      attachmentIds: [],
      keptAttachmentIds: [crypto.randomUUID()],
    })).rejects.toMatchObject({ status: 400 });
  });

  it("leaves no aggregate when an upload belongs to another mutation", async () => {
    const reservedFor = crypto.randomUUID();
    const uploadId = await prepareAndUpload({
      purpose: "create",
      mutationId: reservedFor,
      filename: "scoped.png",
    });
    const attemptedId = crypto.randomUUID();
    await expect(createProjectIssue({
      db,
      projectId,
      userId: ownerId,
      clientIssueId: attemptedId,
      request: decodeIssueInput({
        title: "Wrong scope",
        description: `![scoped](briar-attachment://${uploadId})`,
        status: "backlog",
        checkpoints: [],
        fullAuto: false,
      }),
      attachmentIds: [uploadId],
    })).rejects.toMatchObject({ status: 409 });

    expect(await db.prepare(
      `select id from briar_hunt_runs where id = ?`,
    ).bind(attemptedId).first()).toBeNull();
    expect(await db.prepare(
      `select client_issue_id from briar_issue_create_mutation_receipts
       where client_issue_id = ?`,
    ).bind(attemptedId).first()).toBeNull();
    expect(await db.prepare(
      `select consumed_at from briar_uploads where upload_id = ?`,
    ).bind(uploadId).first<{ consumed_at: string | null }>()).toEqual({
      consumed_at: null,
    });
  });

  it("rolls back every update statement when the exact snapshot guard misses", async () => {
    const clientIssueId = crypto.randomUUID();
    const uploadId = await prepareAndUpload({
      purpose: "create",
      mutationId: clientIssueId,
      filename: "guarded.png",
    });
    await createProjectIssue({
      db,
      projectId,
      userId: ownerId,
      clientIssueId,
      request: decodeIssueInput({
        title: "Guarded original",
        description: `![guarded](briar-attachment://${uploadId})`,
        status: "queued",
        checkpoints: [],
        fullAuto: false,
      }),
      attachmentIds: [uploadId],
    });
    const run = (await getHuntRunForProject(db, projectId, clientIssueId))!;
    const attachments = await listIssueAttachments(db, projectId, clientIssueId);
    const requestId = crypto.randomUUID();
    const updatedAt = new Date(Date.parse(run.updated_at) + 1_000).toISOString();
    const statements = updateIssueMutationStatements(db, {
      organizationId,
      projectId,
      runId: clientIssueId,
      userId: ownerId,
      requestId,
      requestHash: "b".repeat(64),
      title: "Must roll back",
      description: null,
      priority: null,
      difficulty: null,
      assigneeUserId: null,
      previousUpdatedAt: "2000-01-01T00:00:00.000Z",
      updatedAt,
      previousAttachmentIds: attachments.map(({ id }) => id),
      keptAttachments: [],
      newUploads: [],
      removedAttachments: attachments,
      responseJson: JSON.stringify({ runId: clientIssueId }),
    });

    await expect(db.batch([
      statements.update,
      ...statements.cleanup,
      ...statements.removals,
      statements.receipt,
    ])).rejects.toThrow();
    expect((await getHuntRunForProject(db, projectId, clientIssueId))?.title)
      .toBe("Guarded original");
    expect(await db.prepare(
      `select id from briar_issue_attachments where id = ?`,
    ).bind(uploadId).first()).not.toBeNull();
    expect(await db.prepare(
      `select object_key from briar_upload_cleanup_queue
       where batch_request_id = ?`,
    ).bind(`issue-update:${requestId}`).first()).toBeNull();
    expect(await db.prepare(
      `select request_id from briar_issue_update_mutation_receipts
       where request_id = ?`,
    ).bind(requestId).first()).toBeNull();
  });

  it("durably retries provider-upload cleanup after issue finalization fails", async () => {
    const existingObjectKeys = new Set(objects.keys());
    const finalizeFailure = new Error("forced D1 issue finalize failure");
    const createIssue: ServerIssueCreateApplicationServices["createIssue"] = async () => {
      throw finalizeFailure;
    };

    await expect(createIssueFromServerFilesApplication({
      db,
      attachmentsBucket: bucket,
      signingSecret,
      projectId,
      userId: ownerId,
      sourceKey: `provider-create:${crypto.randomUUID()}`,
      request: {
        title: "Provider issue",
        status: "queued",
        checkpoints: [],
      },
      files: [new File(["provider bytes"], "provider.png", {
        type: "image/png",
      })],
      attribution: {
        actor: "provider:test",
        detail: "Provider-created issue",
        context: { origin: "provider-test" },
      },
    }, { createIssue })).rejects.toBe(finalizeFailure);

    const objectKey = [...objects.keys()].find(
      (key) => !existingObjectKeys.has(key),
    );
    expect(objectKey).toBeDefined();
    await expect(db.prepare(
      `select attempts, generation from briar_upload_cleanup_queue
       where object_key = ?`,
    ).bind(objectKey).first()).resolves.toEqual({ attempts: 0, generation: 1 });
    await expect(db.prepare(
      `select upload_id from briar_uploads where object_key = ?`,
    ).bind(objectKey).first()).resolves.toBeNull();

    let targetAttempts = 0;
    const deleteObject = vi.fn(async (key: string) => {
      if (key === objectKey && targetAttempts++ === 0) {
        throw new Error("temporary R2 failure");
      }
    });
    const firstAttemptAt = new Date(Date.now() + 1_000).toISOString();
    await expect(processUploadCleanupQueue(
      db,
      { delete: deleteObject },
      firstAttemptAt,
    )).resolves.toMatchObject({ failed: 1 });
    await expect(db.prepare(
      `select attempts, generation, last_error
       from briar_upload_cleanup_queue where object_key = ?`,
    ).bind(objectKey).first()).resolves.toEqual({
      attempts: 1,
      generation: 2,
      last_error: "temporary R2 failure",
    });

    await expect(processUploadCleanupQueue(
      db,
      { delete: deleteObject },
      new Date(Date.now() + 10_000).toISOString(),
    )).resolves.toMatchObject({ deleted: 1 });
    await expect(db.prepare(
      `select object_key from briar_upload_cleanup_queue where object_key = ?`,
    ).bind(objectKey).first()).resolves.toBeNull();
    expect(deleteObject).toHaveBeenLastCalledWith(objectKey);
  });
});
