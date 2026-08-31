import { create } from "@bufbuild/protobuf";
import { UploadFileMetadataSchema } from "@briar/contracts/gen/briar/types/v1/upload_pb";
import { createHash } from "node:crypto";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import type { HuntEventInput } from "./db";
import {
  createIssueMessage,
  createProjectAgent,
  recordHuntEvent,
} from "./db";
import { resolveIssueAttachmentUploads } from "./issue-attachment-upload-repository";
import { prepareIssueMessageAttachmentsApplication } from "./issue-attachment-upload-application";
import { createProjectIssueMessage } from "./issue-conversation-routes";
import { commitIssueMessageMutation } from "./issue-message-mutation-repository";
import { decodeIssueMessageInput } from "./issue-request-contract";
import { uploadReservedFileApplication } from "./upload-application";

const organizationId = "a7000000-0000-4000-8000-000000000001";
const projectId = "b7000000-0000-4000-8000-000000000001";
const ownerId = "issue-message-owner";
const memberId = "issue-message-member";
const signingSecret = "issue-message-upload-secret".repeat(4);

const digest = (body: ArrayBuffer) =>
  Uint8Array.from(createHash("sha256").update(new Uint8Array(body)).digest());

const huntEvent = (sourceKey: string): HuntEventInput => ({
  source: "issue",
  sourceKey,
  title: "Issue message mutation",
  stage: "queued",
  status: "backlog",
  workflowStage: null,
  eventKey: `${sourceKey}:backlog`,
  occurredAt: new Date().toISOString(),
  actor: "issue-message-test",
  repository: "Issue message",
  detail: null,
  priority: null,
  branch: null,
  commitSha: null,
  tracker: null,
  issueDescription: null,
  resultSummary: null,
  structuredResult: null,
  pullRequestUrls: [],
  targetSha: null,
  sourceCreatedAt: new Date().toISOString(),
  qaStatus: null,
  stagingQaDetail: null,
  productionQaDetail: null,
  context: null,
});

describe("issue message mutation", () => {
  const db = env.DB;
  const bucket = env.ATTACHMENTS;
  let runId: string;
  let agentIds: string[];

  beforeAll(async () => {
    const now = new Date().toISOString();
    await db.batch([
      db.prepare(
        `insert into "user" (
           id, name, email, emailVerified, createdAt, updatedAt
         ) values (?, 'Owner', 'message-owner@example.com', 1, ?, ?)`,
      ).bind(ownerId, now, now),
      db.prepare(
        `insert into "user" (
           id, name, email, emailVerified, createdAt, updatedAt
         ) values (?, 'Member', 'message-member@example.com', 1, ?, ?)`,
      ).bind(memberId, now, now),
      db.prepare(
        `insert into briar_organizations (
           id, name, handle, created_at, updated_at
         ) values (?, 'Issue Messages', 'issue-messages', ?, ?)`,
      ).bind(organizationId, now, now),
    ]);
    await db.batch([
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'owner', ?, ?)`,
      ).bind(organizationId, ownerId, now, now),
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'viewer', ?, ?)`,
      ).bind(organizationId, memberId, now, now),
      db.prepare(
        `insert into briar_projects (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, 'Message Project', ?, ?, ?)`,
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
    runId = await recordHuntEvent(db, projectId, huntEvent("message-run"));
    agentIds = await Promise.all(
      ["Alpha", "Beta"].map(async (name, index) =>
        (await createProjectAgent(db, projectId, {
          name,
          provider: index === 0 ? "codex" : "claude",
          model: null,
          effort: null,
          responsibility: `Reply as ${name}.`,
          calendarColor: index === 0 ? "#123456" : "#654321",
        })).id
      ),
    );
  }, 60_000);

  const prepareAndUpload = async (
    messageId: string,
    files: readonly string[],
  ) => {
    const bodies = files.map((filename) =>
      new TextEncoder().encode(`bytes:${filename}`).buffer
    );
    const prepared = await prepareIssueMessageAttachmentsApplication({
      db,
      signingSecret,
      projectId,
      runId,
      userId: ownerId,
      preparationRequestId: crypto.randomUUID(),
      mutationId: messageId,
      attachments: files.map((filename, index) =>
        create(UploadFileMetadataSchema, {
          clientId: `client-${index}`,
          filename,
          contentType: "image/png",
          byteSize: BigInt(bodies[index]!.byteLength),
          sha256: digest(bodies[index]!),
        })
      ),
    });
    await Promise.all(prepared.uploads.map((upload, index) =>
      uploadReservedFileApplication({
        db,
        bucket,
        signingSecret,
        uploadId: upload.uploadId,
        capability: upload.uploadCapability,
        contentType: "image/png",
        body: bodies[index]!,
      })
    ));
    return prepared.uploads.map((upload) => upload.uploadId);
  };

  it("commits attachments, mentions, every Agent job, and an exact replay receipt once", async () => {
    const messageId = crypto.randomUUID();
    const uploadIds = await prepareAndUpload(messageId, ["one.png", "two.png"]);
    const existingAttachmentId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.prepare(
      `insert into briar_issue_attachments (
         id, run_id, project_id, object_key, filename, content_type,
         byte_size, created_at
       ) values (?, ?, ?, ?, 'existing.png', 'image/png', 4, ?)`,
    ).bind(
      existingAttachmentId,
      runId,
      projectId,
      `issue-attachments/${projectId}/${runId}/${existingAttachmentId}`,
      now,
    ).run();
    const body = [existingAttachmentId, uploadIds[0]!]
      .map((id) => `![attachment](briar-attachment://${id})`)
      .join("\n");
    const request = decodeIssueMessageInput({
      clientMessageId: messageId,
      body,
      parentMessageId: null,
      mentionedUserIds: [memberId],
      mentionedAgentIds: agentIds,
      agentConversationId: null,
    });
    const input = {
      db,
      projectId,
      runId,
      userId: ownerId,
      request,
      attachmentIds: uploadIds,
    };

    const created = await createProjectIssueMessage(input);
    expect(created.message.attachments.map((attachment) => attachment.id))
      .toEqual(expect.arrayContaining([existingAttachmentId, uploadIds[0]]));
    expect(created.message.attachments.map((attachment) => attachment.id))
      .not.toContain(uploadIds[1]);
    expect(created.agentReplies.map((reply) => reply.agentId).sort())
      .toEqual([...agentIds].sort());
    expect(created.agentReply).toBeNull();
    await expect(createProjectIssueMessage(input)).resolves.toEqual(created);

    await expect(createProjectIssueMessage({
      ...input,
      attachmentIds: [...uploadIds].reverse(),
    })).rejects.toMatchObject({ status: 409 });
    await expect(createProjectIssueMessage({
      ...input,
      request: decodeIssueMessageInput({ ...request, body: `${body}\nchanged` }),
    })).rejects.toMatchObject({ status: 409 });

    await expect(db.prepare(
      `select
         (select count(*) from briar_issue_messages where id = ?) as messages,
         (select count(*) from briar_issue_message_mentions
          where message_id = ?) as mentions,
         (select count(*) from briar_issue_agent_reply_jobs
          where trigger_message_id = ?) as jobs,
         (select count(*) from briar_issue_message_mutation_receipts
          where message_id = ?) as receipts,
         (select count(*) from briar_uploads
          where consumer_kind = 'issue_message' and consumer_id = ?) as consumed`,
    ).bind(messageId, messageId, messageId, messageId, messageId).first())
      .resolves.toEqual({
        messages: 1,
        mentions: 1,
        jobs: 2,
        receipts: 1,
        consumed: 2,
      });
  });

  it("rejects an upload reserved for another message without partial state", async () => {
    const reservedMessageId = crypto.randomUUID();
    const attemptedMessageId = crypto.randomUUID();
    const [uploadId] = await prepareAndUpload(reservedMessageId, ["scoped.png"]);
    const request = decodeIssueMessageInput({
      clientMessageId: attemptedMessageId,
      body: `![scoped](briar-attachment://${uploadId})`,
      mentionedAgentIds: [agentIds[0]!],
    });

    await expect(createProjectIssueMessage({
      db,
      projectId,
      runId,
      userId: ownerId,
      request,
      attachmentIds: [uploadId!],
    })).rejects.toMatchObject({ status: 409 });
    await expect(db.prepare(
      `select
         (select count(*) from briar_issue_messages where id = ?) as messages,
         (select count(*) from briar_issue_agent_reply_jobs
          where trigger_message_id = ?) as jobs,
         (select count(*) from briar_issue_attachments where id = ?) as attachments,
         (select count(*) from briar_issue_message_mutation_receipts
          where message_id = ?) as receipts,
         (select count(*) from briar_uploads
          where upload_id = ? and consumed_at is null) as available`,
    ).bind(
      attemptedMessageId,
      attemptedMessageId,
      uploadId,
      attemptedMessageId,
      uploadId,
    ).first()).resolves.toEqual({
      messages: 0,
      jobs: 0,
      attachments: 0,
      receipts: 0,
      available: 1,
    });
  });

  it("rolls back when a same-run attachment disappears after preflight", async () => {
    const messageId = crypto.randomUUID();
    const parentMessageId = crypto.randomUUID();
    const existingAttachmentId = crypto.randomUUID();
    const raceMemberId = `race-member-${messageId}`;
    const createdAt = new Date().toISOString();
    await db.batch([
      db.prepare(
        `insert into "user" (
           id, name, email, emailVerified, createdAt, updatedAt
         ) values (?, 'Race Member', ?, 1, ?, ?)`,
      ).bind(
        raceMemberId,
        `${messageId}@example.com`,
        createdAt,
        createdAt,
      ),
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'viewer', ?, ?)`,
      ).bind(organizationId, raceMemberId, createdAt, createdAt),
    ]);
    await createIssueMessage(db, {
      id: parentMessageId,
      projectId,
      runId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentProvider: null,
      body: "Parent before the race.",
      createdAt,
    });
    await db.prepare(
      `insert into briar_issue_attachments (
         id, run_id, project_id, object_key, filename, content_type,
         byte_size, created_at
       ) values (?, ?, ?, ?, 'existing.png', 'image/png', 4, ?)`,
    ).bind(
      existingAttachmentId,
      runId,
      projectId,
      `issue-attachments/${projectId}/${runId}/${existingAttachmentId}`,
      createdAt,
    ).run();
    const [uploadId] = await prepareAndUpload(messageId, ["race.png"]);
    const committedAt = new Date().toISOString();
    const uploads = await resolveIssueAttachmentUploads(db, {
      purpose: "issue_message",
      organizationId,
      projectId,
      runId,
      userId: ownerId,
      mutationId: messageId,
      uploadIds: [uploadId!],
      observedAt: committedAt,
    });
    expect(uploads).toHaveLength(1);
    await db.prepare(`delete from briar_issue_attachments where id = ?`)
      .bind(existingAttachmentId)
      .run();

    await expect(commitIssueMessageMutation(db, {
      organizationId,
      projectId,
      runId,
      userId: ownerId,
      messageId,
      parentMessageId,
      authorAgentProvider: null,
      body: `![old](briar-attachment://${existingAttachmentId})`,
      mentionedUserIds: [raceMemberId],
      targetAgentIds: [agentIds[0]!],
      attachments: uploads!.map((upload) => ({
        id: upload.upload_id,
        run_id: runId,
        project_id: projectId,
        object_key: upload.object_key,
        filename: upload.filename,
        content_type: upload.content_type,
        byte_size: upload.byte_size,
        created_at: committedAt,
      })),
      uploadIds: [uploadId!],
      existingAttachmentIds: [existingAttachmentId],
      replies: [{
        id: crypto.randomUUID(),
        replyMessageId: crypto.randomUUID(),
        agentId: agentIds[0]!,
        agentName: "Alpha",
        agentResponsibility: "Reply as Alpha.",
        preferredWorkerId: null,
        preferredProvider: "codex",
        requiresPreferredWorker: false,
      }],
      requestHash: "f".repeat(64),
      responseJson: "{}",
      committedAt,
    })).rejects.toBeDefined();
    await expect(db.prepare(
      `select
         (select count(*) from briar_issue_messages where id = ?) as messages,
         (select count(*) from briar_issue_agent_reply_jobs
          where trigger_message_id = ?) as jobs,
         (select count(*) from briar_issue_attachments where id = ?) as attachments,
         (select count(*) from briar_issue_message_mutation_receipts
          where message_id = ?) as receipts,
         (select count(*) from briar_uploads
          where upload_id = ? and consumed_at is null) as available`,
    ).bind(messageId, messageId, uploadId, messageId, uploadId).first())
      .resolves.toEqual({
        messages: 0,
        jobs: 0,
        attachments: 0,
        receipts: 0,
        available: 1,
      });
  });
});
