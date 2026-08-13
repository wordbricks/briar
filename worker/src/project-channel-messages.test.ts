import { createHash } from "node:crypto";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import worker from "./index";
import {
  addChannelAgent,
  createChannel,
  createChannelMessage,
} from "./channels";
import { applyD1Migrations } from "./test-helpers/d1";

describe("Project Agent channel message history", () => {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: "briar-project-channel-messages-test" },
  });
  const organizationId = "11000000-0000-4000-8000-000000000001";
  const projectId = "22000000-0000-4000-8000-000000000001";
  const otherProjectId = "22000000-0000-4000-8000-000000000002";
  const ownerId = "project-channel-history-owner";
  const agentId = "33000000-0000-4000-8000-000000000001";
  const token = "briar_agent_project_channel_history";
  const channelId = "44000000-0000-4000-8000-000000000001";
  const forbiddenChannelId = "44000000-0000-4000-8000-000000000002";
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
    db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
    await applyD1Migrations(db);
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
    await createChannel(db, {
      id: forbiddenChannelId,
      organizationId,
      slug: "agent-forbidden",
      name: "Agent forbidden",
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

  const get = (project: string, channel: string, query = "") =>
    worker.fetch(
      new Request(
        `https://briar.example/projects/${project}/channels/${channel}/messages${query}`,
        { headers: { authorization: `Bearer ${token}` } },
      ),
      env(),
    );

  it("paginates roots with stable timestamp and ID boundaries", async () => {
    const firstResponse = await get(projectId, channelId, "?limit=2");
    expect(firstResponse.status).toBe(200);
    expect(firstResponse.headers.get("Cache-Control")).toBe("private, no-store");
    const first = await firstResponse.json<{
      messages: Array<{ id: string; document: unknown; attachments: unknown[] }>;
      nextCursor: string | null;
    }>();
    expect(first.messages.map((message) => message.id)).toEqual([
      rootIds[3],
      threadRootId,
    ]);
    expect(first.nextCursor).toBe(rootIds[3]);
    expect(first.messages[0]).toMatchObject({
      document: { messageId: rootIds[3], title: "History plan", projectId },
      attachments: [{
        filename: "history.png",
        contentType: "image/png",
        byteSize: 42,
      }],
    });

    const secondResponse = await get(
      projectId,
      channelId,
      `?limit=2&cursor=${first.nextCursor}`,
    );
    const second = await secondResponse.json<{
      messages: Array<{ id: string; document: unknown; attachments: unknown[] }>;
      nextCursor: string | null;
    }>();
    expect(second.messages.map((message) => message.id)).toEqual([
      rootIds[1],
      rootIds[2],
    ]);

    const thirdResponse = await get(
      projectId,
      channelId,
      `?limit=2&cursor=${second.nextCursor}`,
    );
    const third = await thirdResponse.json<{
      messages: Array<{ id: string }>;
      nextCursor: string | null;
    }>();
    expect(third.messages.map((message) => message.id)).toEqual([rootIds[0]]);
    expect(third.nextCursor).toBeNull();
  });

  it("paginates a thread independently and includes its root", async () => {
    const query = `?limit=2&parentMessageId=${threadRootId}`;
    const firstResponse = await get(projectId, channelId, query);
    const first = await firstResponse.json<{
      messages: Array<{ id: string }>;
      nextCursor: string | null;
    }>();
    expect(first.messages.map((message) => message.id)).toEqual([
      replyIds[1],
      replyIds[2],
    ]);

    const secondResponse = await get(
      projectId,
      channelId,
      `${query}&cursor=${first.nextCursor}`,
    );
    const second = await secondResponse.json<{
      messages: Array<{ id: string }>;
      nextCursor: string | null;
    }>();
    expect(second.messages.map((message) => message.id)).toEqual([
      threadRootId,
      replyIds[0],
    ]);
    expect(second.nextCursor).toBeNull();
  });

  it("distinguishes missing channels from channels outside the Agent roster", async () => {
    const forbidden = await get(projectId, forbiddenChannelId);
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toMatchObject({
      message: "No Project Agent for this project has access to the channel",
    });

    const missing = await get(
      projectId,
      "44000000-0000-4000-8000-000000000099",
    );
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({
      message: "Channel not found",
    });
  });

  it("revokes access as soon as the project's last roster Agent is removed", async () => {
    await db.prepare(
      `delete from briar_channel_agents where channel_id = ? and agent_id = ?`,
    ).bind(channelId, agentId).run();
    try {
      const revoked = await get(projectId, channelId);
      expect(revoked.status).toBe(403);
    } finally {
      await addChannelAgent(db, {
        channelId,
        agentId,
        addedByUserId: ownerId,
        createdAt: at(20),
      });
    }
  });

  it("rejects project mismatches and cursors outside the selected view", async () => {
    const wrongProject = await get(otherProjectId, channelId);
    expect(wrongProject.status).toBe(403);
    await expect(wrongProject.json()).resolves.toMatchObject({
      message: "Agent token is not valid for this project",
    });

    const wrongCursor = await get(
      projectId,
      channelId,
      `?parentMessageId=${threadRootId}&cursor=${rootIds[0]}`,
    );
    expect(wrongCursor.status).toBe(400);
    await expect(wrongCursor.json()).resolves.toMatchObject({
      message: "Cursor does not belong to this message view",
    });
  });
});
