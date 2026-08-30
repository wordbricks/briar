import { createHash } from "node:crypto";
import {
  WorkerExecutionService,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { Code, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import worker from "./index";
import {
  addChannelAgent,
  createChannel,
  createChannelMessage,
} from "./channels";
import { createIsolatedTestDatabase } from "./test-helpers/d1";

describe("Project Agent channel message history", () => {
  let miniflare: Miniflare;
  const organizationId = "11000000-0000-4000-8000-000000000001";
  const projectId = "22000000-0000-4000-8000-000000000001";
  const otherProjectId = "22000000-0000-4000-8000-000000000002";
  const ownerId = "project-channel-history-owner";
  const agentId = "33000000-0000-4000-8000-000000000001";
  const token = "briar_agent_project_channel_history";
  const channelId = "44000000-0000-4000-8000-000000000001";
  const rootIds = [
    "55000000-0000-4000-8000-000000000001",
    "55000000-0000-4000-8000-000000000002",
    "55000000-0000-4000-8000-000000000003",
    "55000000-0000-4000-8000-000000000004",
  ];
  const threadRootId = "66000000-0000-4000-8000-000000000001";
  const replyIds = [
    "77000000-0000-4000-8000-000000000001",
    "77000000-0000-4000-8000-000000000002",
    "77000000-0000-4000-8000-000000000003",
  ];
  let db: D1Database;

  const at = (minute: number) =>
    `2026-08-12T00:${String(minute).padStart(2, "0")}:00.000Z`;
  const tokenHash = (value: string) =>
    createHash("sha256").update(value).digest("hex");

  beforeAll(async () => {
    const database = await createIsolatedTestDatabase({
      suite: "project-channel-messages",
    });
    miniflare = database.miniflare;
    db = database.db;
    await db.batch([
      db.prepare(
        `insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
         values (?, 'History Owner', 'history@example.com', 1, ?, ?)`,
      ).bind(ownerId, at(0), at(0)),
      db.prepare(
        `insert into briar_organizations (id, name, handle, created_at, updated_at)
         values (?, 'History Organization', 'history-organization', ?, ?)`,
      ).bind(organizationId, at(0), at(0)),
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'owner', ?, ?)`,
      ).bind(organizationId, ownerId, at(0), at(0)),
      db.prepare(
        `insert into briar_projects (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, 'History Project', ?, ?, ?)`,
      ).bind(projectId, ownerId, organizationId, tokenHash(token), at(0), at(0)),
      db.prepare(
        `insert into briar_projects (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, 'Other Project', ?, ?, ?)`,
      ).bind(
        otherProjectId,
        ownerId,
        organizationId,
        "f".repeat(64),
        at(0),
        at(0),
      ),
      db.prepare(
        `insert into briar_project_agents (
           id, organization_id, project_id, name, provider,
           responsibility, created_at, updated_at
         ) values (?, ?, ?, 'History Agent', 'codex',
                   'Read authorized history', ?, ?)`,
      ).bind(agentId, organizationId, projectId, at(0), at(0)),
    ]);
    await createChannel(db, {
      id: channelId,
      organizationId,
      slug: "agent-history",
      name: "Agent history",
      topic: null,
      visibility: "public",
      defaultProjectId: projectId,
      createdByUserId: ownerId,
      createdAt: at(0),
    });
    await addChannelAgent(db, {
      channelId,
      agentId,
      addedByUserId: ownerId,
      createdAt: at(0),
    });

    for (const [index, id] of rootIds.entries()) {
      await createChannelMessage(db, {
        id,
        channelId,
        parentMessageId: null,
        authorUserId: ownerId,
        authorAgentId: null,
        authorAgentName: null,
        authorAgentProvider: null,
        body: `Root ${index + 1}`,
        mentionedUserIds: [],
        mentionedAgentIds: [],
        // IDs 2 and 3 deliberately share a timestamp to exercise the ID tie-break.
        createdAt: index === 2 ? at(2) : at(index + 1),
      });
    }
    await createChannelMessage(db, {
      id: threadRootId,
      channelId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: "Thread root",
      mentionedUserIds: [],
      mentionedAgentIds: [],
      createdAt: at(10),
    });
    for (const [index, id] of replyIds.entries()) {
      await createChannelMessage(db, {
        id,
        channelId,
        parentMessageId: threadRootId,
        authorUserId: ownerId,
        authorAgentId: null,
        authorAgentName: null,
        authorAgentProvider: null,
        body: `Reply ${index + 1}`,
        mentionedUserIds: [],
        mentionedAgentIds: [],
        createdAt: at(11 + index),
      });
    }
    await db.batch([
      db.prepare(
        `insert into briar_channel_message_documents (
           message_id, channel_id, project_id, title, markdown,
           created_at, updated_at
         ) values (?, ?, ?, 'History plan', '# Plan', ?, ?)`,
      ).bind(rootIds[3], channelId, projectId, at(4), at(4)),
      db.prepare(
        `insert into briar_channel_message_attachments (
           id, organization_id, channel_id, message_id, object_key,
           filename, content_type, byte_size, created_at
           ) values (?, ?, ?, ?, ?, 'history.png', 'image/png', 42, ?)`,
      ).bind(
        "88000000-0000-4000-8000-000000000001",
        organizationId,
        channelId,
        rootIds[3],
        `channel-attachments/${organizationId}/${channelId}/${rootIds[3]}/history.png`,
        at(4),
      ),
    ]);
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

  const client = () => createClient(
    WorkerExecutionService,
    createConnectTransport({
      baseUrl: "https://briar.example",
      useBinaryFormat: true,
      fetch: async (input, init) =>
        worker.fetch(new Request(input, init), env()),
    }),
  );

  const list = (
    project: string,
    channel: string,
    input: {
      limit?: number;
      cursor?: string;
      parentMessageId?: string;
    } = {},
  ) => client().listProjectChannelMessages(
    { projectId: project, channelId: channel, ...input },
    { headers: { authorization: `Bearer ${token}` } },
  );

  it("keeps root and thread cursors isolated while mapping rich messages", async () => {
    let responseHeaders: Headers | undefined;
    const first = await client().listProjectChannelMessages(
      { projectId, channelId, limit: 2 },
      {
        headers: { authorization: `Bearer ${token}` },
        onHeader: (headers) => {
          responseHeaders = headers;
        },
      },
    );
    expect(responseHeaders?.get("cache-control")).toBe("private, no-store");
    expect(first.messages.map((message) => message.id)).toEqual([
      rootIds[3],
      threadRootId,
    ]);
    expect(first.nextCursor).toBe(rootIds[3]);
    expect(first.channel).toMatchObject({
      id: channelId,
      name: "Agent history",
    });
    expect(first.messages[0]).toMatchObject({
      document: { messageId: rootIds[3], title: "History plan", projectId },
      attachments: [{
        filename: "history.png",
        contentType: "image/png",
        byteSize: BigInt(42),
      }],
    });

    const second = await list(projectId, channelId, {
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.messages.map((message) => message.id)).toEqual([
      rootIds[1],
      rootIds[2],
    ]);
    const third = await list(projectId, channelId, {
      limit: 2,
      cursor: second.nextCursor,
    });
    expect(third.messages.map((message) => message.id)).toEqual([rootIds[0]]);
    expect(third.nextCursor).toBeUndefined();

    const threadFirst = await list(projectId, channelId, {
      limit: 2,
      parentMessageId: threadRootId,
    });
    expect(threadFirst.messages.map((message) => message.id)).toEqual([
      replyIds[1],
      replyIds[2],
    ]);
    const threadSecond = await list(projectId, channelId, {
      limit: 2,
      parentMessageId: threadRootId,
      cursor: threadFirst.nextCursor,
    });
    expect(threadSecond.messages.map((message) => message.id)).toEqual([
      threadRootId,
      replyIds[0],
    ]);
    expect(threadSecond.nextCursor).toBeUndefined();

    await expect(list(projectId, channelId, {
      parentMessageId: threadRootId,
      cursor: rootIds[0],
    })).rejects.toMatchObject({ code: Code.InvalidArgument });
  });

  it("rejects project mismatch and revokes access with the final roster Agent", async () => {
    await expect(list(otherProjectId, channelId)).rejects.toMatchObject({
      code: Code.PermissionDenied,
    });

    await db.prepare(
      `delete from briar_channel_agents where channel_id = ? and agent_id = ?`,
    ).bind(channelId, agentId).run();
    try {
      await expect(list(projectId, channelId)).rejects.toMatchObject({
        code: Code.PermissionDenied,
      });
    } finally {
      await addChannelAgent(db, {
        channelId,
        agentId,
        addedByUserId: ownerId,
        createdAt: at(20),
      });
    }
  });
});
