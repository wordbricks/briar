import { createHash } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import { UploadFileMetadataSchema } from "@briar/contracts/gen/briar/types/v1/upload_pb";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { issueAttachmentMarkdown } from "../../src/lib/issue-markdown";
import { decodeChannelMessageApplicationInput } from "./app-mutation-request-mappers";
import { prepareChannelMessageAttachmentsApplication } from "./channel-message-upload-application";
import {
  createWorkspaceChannelMessage,
  listWorkspaceChannelMessages,
} from "./channel-message-routes";
import { createChannel, getChannelMessageAttachment } from "./channels";
import { channelAttachmentResponse } from "./channel-attachment-response";
import { uploadReservedFileApplication } from "./upload-application";

const workspaceId = "a9000000-0000-4000-8000-000000000001";
const ownerId = "channel-pdf-owner";
const channelId = "e9000000-0000-4000-8000-000000000001";
const otherChannelId = "e9000000-0000-4000-8000-000000000002";
const publicChannelId = "e9000000-0000-4000-8000-000000000003";
const signingSecret = "channel-message-pdf-secret".repeat(4);
const now = "2026-09-03T00:00:00.000Z";

const digest = (body: ArrayBuffer) =>
  Uint8Array.from(createHash("sha256").update(new Uint8Array(body)).digest());

describe("channel and DM PDF messages", () => {
  const db = env.DB;
  const bucket = env.ATTACHMENTS;

  beforeAll(async () => {
    await db.batch([
      db.prepare(
        `insert into "user" (
           id, name, email, emailVerified, createdAt, updatedAt
         ) values (?, 'PDF Owner', 'channel-pdf@example.com', 1, ?, ?)`,
      ).bind(ownerId, now, now),
      db.prepare(
        `insert into briar_organizations (
           id, name, handle, created_at, updated_at
         ) values (?, 'Channel PDF', 'channel-pdf', ?, ?)`,
      ).bind(workspaceId, now, now),
    ]);
    await db.prepare(
      `insert into briar_organization_members (
         organization_id, user_id, role, created_at, updated_at
       ) values (?, ?, 'owner', ?, ?)`,
    ).bind(workspaceId, ownerId, now, now).run();
    for (const [id, slug, kind] of [
      [channelId, "pdf-dm", "dm"],
      [otherChannelId, "other-pdf-dm", "dm"],
      [publicChannelId, "pdf-channel", "channel"],
    ] as const) {
      await createChannel(db, {
        id,
        workspaceId,
        slug,
        name: slug,
        topic: null,
        visibility: "private",
        defaultProjectId: null,
        createdByUserId: ownerId,
        createdAt: now,
        ...(kind === "dm"
          ? { kind, dmKey: `user:${ownerId}:${id}` }
          : { kind, dmKey: null }),
      });
    }
  });

  async function prepareAndUploadPdf(
    targetChannelId: string,
    messageId: string,
    filename: string,
    contentType = "application/pdf",
    contents = `%PDF-1.7\n${filename}`,
  ) {
    const body = new TextEncoder().encode(contents).buffer;
    const clientId = crypto.randomUUID();
    const prepared = await prepareChannelMessageAttachmentsApplication({
      db,
      signingSecret,
      workspaceId,
      channelId: targetChannelId,
      userId: ownerId,
      messageId,
      requestId: crypto.randomUUID(),
      attachments: [create(UploadFileMetadataSchema, {
        clientId,
        filename,
        contentType,
        byteSize: BigInt(body.byteLength),
        sha256: digest(body),
      })],
    });
    const upload = prepared.uploads[0]!;
    await uploadReservedFileApplication({
      db,
      bucket,
      signingSecret,
      uploadId: upload.uploadId,
      capability: upload.uploadCapability,
      contentType: filename.toLowerCase().endsWith(".md") ? "text/markdown" : filename.toLowerCase().endsWith(".txt") ? "text/plain" : "application/pdf",
      body,
    });
    return upload.uploadId;
  }

  async function createPdfMessage(input: {
    channelId: string;
    messageId: string;
    parentMessageId: string | null;
    uploadId: string;
    filename: string;
  }) {
    return createWorkspaceChannelMessage({
      db,
      workspaceId,
      channelId: input.channelId,
      userId: ownerId,
      request: decodeChannelMessageApplicationInput({
        clientMessageId: input.messageId,
        body: issueAttachmentMarkdown(input.uploadId, input.filename),
        parentMessageId: input.parentMessageId,
        mentionedUserIds: [],
        mentionedAgentIds: [],
        skillId: null,
        preferredDeviceId: null,
      }),
      attachmentIds: [input.uploadId],
    });
  }

  it.each([
    ["설계.MD", "text/x-markdown", "text/markdown"],
    ["메모.txt", "", "text/plain"],
  ])("persists %s bytes and downloads after reopening DM and channel", async (filename, contentType, expectedType) => {
    const contents = "# 원본\r\n<script>alert('never execute')</script>\n끝\n";
    for (const targetChannelId of [channelId, publicChannelId]) {
      const messageId = crypto.randomUUID();
      const uploadId = await prepareAndUploadPdf(targetChannelId, messageId, filename, contentType, contents);
      await expect(createPdfMessage({ channelId: otherChannelId, messageId, parentMessageId: null, uploadId, filename })).rejects.toMatchObject({ status: 409 });
      await createPdfMessage({ channelId: targetChannelId, messageId, parentMessageId: null, uploadId, filename });
      const reopened = await listWorkspaceChannelMessages({ db, workspaceId, channelId: targetChannelId, userId: ownerId });
      expect(reopened.messages).toContainEqual(expect.objectContaining({ id: messageId, attachments: [expect.objectContaining({ filename, contentType: expectedType })] }));
      const metadata = await getChannelMessageAttachment(db, workspaceId, targetChannelId, messageId, uploadId);
      expect(metadata).not.toBeNull();
      const object = await bucket.get(metadata!.object_key);
      expect(object).not.toBeNull();
      const response = channelAttachmentResponse(metadata!, object!, object!.body);
      expect(response.headers.get("Content-Type")).toBe(expectedType);
      expect(response.headers.get("Content-Disposition")).toContain("attachment; filename*=UTF-8''");
      expect(response.headers.get("Content-Disposition")).toContain(encodeURIComponent(filename));
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(await response.text()).toBe(contents);
      await expect(listWorkspaceChannelMessages({ db, workspaceId, channelId: targetChannelId, userId: "not-a-member" })).rejects.toMatchObject({ status: 404 });
    }
  });

  it("creates and reads PDFs in a DM, thread reply, and public channel", async () => {
    const rootId = crypto.randomUUID();
    const rootUploadId = await prepareAndUploadPdf(
      channelId,
      rootId,
      "root brief.pdf",
    );

    await expect(createPdfMessage({
      channelId: otherChannelId,
      messageId: rootId,
      parentMessageId: null,
      uploadId: rootUploadId,
      filename: "root brief.pdf",
    })).rejects.toMatchObject({ status: 409 });

    const root = await createPdfMessage({
      channelId,
      messageId: rootId,
      parentMessageId: null,
      uploadId: rootUploadId,
      filename: "root brief.pdf",
    });
    expect(root.message.attachments).toEqual([
      expect.objectContaining({
        id: rootUploadId,
        filename: "root brief.pdf",
        contentType: "application/pdf",
      }),
    ]);

    const replyId = crypto.randomUUID();
    const replyUploadId = await prepareAndUploadPdf(
      channelId,
      replyId,
      "reply brief.pdf",
    );
    const reply = await createPdfMessage({
      channelId,
      messageId: replyId,
      parentMessageId: rootId,
      uploadId: replyUploadId,
      filename: "reply brief.pdf",
    });
    expect(reply.message.parentMessageId).toBe(rootId);
    expect(reply.message.attachments[0]).toMatchObject({
      id: replyUploadId,
      contentType: "application/pdf",
    });

    const thread = await listWorkspaceChannelMessages({
      db,
      workspaceId,
      channelId,
      userId: ownerId,
      parentMessageId: rootId,
    });
    expect(thread.messages).toContainEqual(
      expect.objectContaining({
        id: replyId,
        attachments: [expect.objectContaining({ id: replyUploadId })],
      }),
    );
    await expect(getChannelMessageAttachment(
      db,
      workspaceId,
      channelId,
      replyId,
      replyUploadId,
    )).resolves.toMatchObject({
      filename: "reply brief.pdf",
      content_type: "application/pdf",
    });

    const channelMessageId = crypto.randomUUID();
    const channelUploadId = await prepareAndUploadPdf(
      publicChannelId,
      channelMessageId,
      "channel brief.pdf",
    );
    const channelMessage = await createPdfMessage({
      channelId: publicChannelId,
      messageId: channelMessageId,
      parentMessageId: null,
      uploadId: channelUploadId,
      filename: "channel brief.pdf",
    });
    expect(channelMessage.message.attachments[0]).toMatchObject({
      id: channelUploadId,
      contentType: "application/pdf",
    });
    await expect(getChannelMessageAttachment(
      db,
      workspaceId,
      publicChannelId,
      channelMessageId,
      channelUploadId,
    )).resolves.toMatchObject({ content_type: "application/pdf" });
  });
});
