import { createHash } from "node:crypto";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  channelReplyClaimTokenHeader,
  channelReplyNoAvailableWorkerError,
} from "../../src/lib/channels-contract";
import apiWorker from "./index";
import {
  addChannelAgent,
  addChannelMember,
  claimNextChannelAgentReply,
  completeChannelReply,
  createChannel,
  createChannelMessage,
  createChannelWebhook,
  createIncomingChannelWebhookMessage,
  deleteChannel,
  enqueueChannelAgentReplies,
  failChannelReply,
  getChannelById,
  getActiveOrganizationChannelReplyContextClaim,
  getClaimedChannelReply,
  getClaimedChannelReplyAttachment,
  getChannelActionProposal,
  getChannelAgentReplyJob,
  getChannelMessage,
  getChannelMessageAttachment,
  getChannelMessageDocument,
  getChannelSyncCursor,
  getIncomingChannelWebhook,
  listChannelAgents,
  listChannelMessagePage,
  listChannelRootMessages,
  listChannelThreadMessages,
  listChannelThreadSubscriptions,
  listChannels,
  listChannelWebhooks,
  loadChannelDelta,
  markChannelRead,
  consumeChannelWebhookRateLimit,
  renewChannelReplyLease,
  revokeChannelWebhook,
  rotateChannelWebhook,
  subscribeChannelThread,
  toggleChannelMessageReaction,
  unsubscribeChannelThread,
} from "./channels";
import { listChannelConversationNotifications } from "./db";
import { processArchiveCleanupQueue } from "./archive";
import {
  createOrganizationAgent,
  listOrganizationAgents,
} from "./organization-agents";
import { createIsolatedTestDatabase } from "./test-helpers/d1";

const organizationId = "a0000000-0000-4000-8000-000000000001";
const otherOrganizationId = "a0000000-0000-4000-8000-000000000002";
const projectId = "b0000000-0000-4000-8000-000000000001";
const deviceId = "c0000000-0000-4000-8000-000000000001";
const boundWorkerId = "d0000000-0000-4000-8000-000000000001";
const otherProjectId = "b0000000-0000-4000-8000-000000000002";
const otherWorkerId = "d0000000-0000-4000-8000-000000000002";
const ownerId = "owner";
const outsiderId = "outsider";
const contextWorkerToken = "briar_worker_channels-context-test";
const ownerSessionToken = "channels-owner-session-token";
const outsiderSessionToken = "channels-outsider-session-token";
const sha256Hex = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const at = (minute: number) =>
  new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();

describe("organization channels", () => {
  let miniflare: Miniflare;
  let db: D1Database;
  let archives: R2Bucket;

  beforeAll(async () => {
    const database = await createIsolatedTestDatabase({
      suite: "channels",
      miniflareOptions: {
        modules: true,
        script: "export default { fetch() { return new Response('ok') } }",
        r2Buckets: ["ARCHIVES"],
      },
    });
    miniflare = database.miniflare;
    db = database.db;
    archives = await miniflare.getR2Bucket("ARCHIVES") as unknown as R2Bucket;

    for (const [id, name] of [
      [ownerId, "Owner"],
      [outsiderId, "Outsider"],
    ]) {
      await db
        .prepare(
          `insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
           values (?, ?, ?, 1, ?, ?)`,
        )
        .bind(id, name, `${id}@example.com`, at(0), at(0))
        .run();
    }
    await db.prepare(
      `insert into "session" (
         id, expiresAt, token, createdAt, updatedAt, userId
       ) values ('channels-owner-session', '2099-01-01T00:00:00.000Z', ?, ?, ?, ?)`,
    ).bind(ownerSessionToken, at(0), at(0), ownerId).run();
    await db.prepare(
      `insert into "session" (
         id, expiresAt, token, createdAt, updatedAt, userId
       ) values ('channels-outsider-session', '2099-01-01T00:00:00.000Z', ?, ?, ?, ?)`,
    ).bind(outsiderSessionToken, at(0), at(0), outsiderId).run();
    for (const id of [organizationId, otherOrganizationId]) {
      await db
        .prepare(
          `insert into briar_organizations (id, name, handle, created_at, updated_at)
           values (?, ?, ?, ?, ?)`,
        )
        .bind(id, `Org ${id.slice(-1)}`, `org-${id.slice(-1)}`, at(0), at(0))
        .run();
      await db
        .prepare(
          `insert into briar_organization_members (
             organization_id, user_id, role, created_at, updated_at
           ) values (?, ?, 'owner', ?, ?)`,
        )
        .bind(id, ownerId, at(0), at(0))
        .run();
    }
    await db
      .prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'member', ?, ?)`,
      )
      .bind(organizationId, outsiderId, at(0), at(0))
      .run();
    await db
      .prepare(
        `insert into briar_projects (
           id, owner_user_id, name, agent_token_hash, organization_id,
           created_at, updated_at
         ) values (?, ?, 'Project', ?, ?, ?, ?)`,
      )
      .bind(projectId, ownerId, "f".repeat(64), organizationId, at(0), at(0))
      .run();
    await db
      .prepare(
        `insert into briar_execution_worker_devices (
           id, organization_id, owner_user_id, label, device_identity_hash,
           state, last_heartbeat_at, created_at, updated_at
         ) values (?, ?, ?, 'Device', ?, 'online', ?, ?, ?)`,
      )
      .bind(deviceId, organizationId, ownerId, "a".repeat(64), at(0), at(0), at(0))
      .run();
    await db.prepare(
      `insert into briar_execution_worker_credentials (
         device_id, token_hash, created_at
       ) values (?, ?, ?)`,
    ).bind(deviceId, sha256Hex(contextWorkerToken), at(0)).run();
    await db.batch([
      db.prepare(
        `insert into briar_projects (
           id, owner_user_id, name, agent_token_hash, organization_id,
           created_at, updated_at
         ) values (?, ?, 'Other Project', ?, ?, ?, ?)`,
      ).bind(
        otherProjectId,
        ownerId,
        "e".repeat(64),
        organizationId,
        at(0),
        at(0),
      ),
      db.prepare(
        `insert into briar_execution_workers (
           id, project_id, label, host_fingerprint, agent_provider, state,
           last_heartbeat_at, created_at, updated_at, device_id
         ) values (?, ?, 'Other Worker', ?, 'claude', 'online', ?, ?, ?, ?)`,
      ).bind(
        otherWorkerId,
        otherProjectId,
        "c".repeat(64),
        at(0),
        at(0),
        at(0),
        deviceId,
      ),
    ]);
  }, 60_000);

  afterAll(async () => {
    await miniflare.dispose();
  });

  const bindWorkerToProject = async () => {
    await db
      .prepare(
        `insert into briar_execution_workers (
           id, project_id, label, host_fingerprint, agent_provider, state,
           last_heartbeat_at, created_at, updated_at, device_id
         ) values (?, ?, 'Worker', ?, 'claude', 'online', ?, ?, ?, ?)
         on conflict (id) do nothing`,
      )
      .bind(boundWorkerId, projectId, "b".repeat(64), at(0), at(0), at(0), deviceId)
      .run();
  };

  it("hides a private channel from members who were not added", async () => {
    const channelId = "e0000000-0000-4000-8000-000000000001";
    await createChannel(db, {
      id: channelId,
      organizationId,
      slug: "private-room",
      name: "Private room",
      topic: null,
      visibility: "private",
      defaultProjectId: null,
      createdByUserId: ownerId,
      createdAt: at(1),
    });

    expect(
      (await listChannels(db, organizationId, ownerId)).map((row) => row.id),
    ).toContain(channelId);
    expect(
      (await listChannels(db, organizationId, outsiderId)).map((row) => row.id),
    ).not.toContain(channelId);

    await addChannelMember(db, {
      channelId,
      userId: outsiderId,
      role: "member",
      createdAt: at(2),
    });
    expect(
      (await listChannels(db, organizationId, outsiderId)).map((row) => row.id),
    ).toContain(channelId);
  });

  it("marks a channel unread for others until the member reads it", async () => {
    const channelId = "e0000000-0000-4000-8000-0000000000b1";
    await createChannel(db, {
      id: channelId,
      organizationId,
      slug: "alerts",
      name: "Alerts",
      topic: null,
      visibility: "public",
      defaultProjectId: null,
      createdByUserId: ownerId,
      createdAt: at(70),
    });
    const before = await loadChannelDelta(db, organizationId, outsiderId, 0);
    await createChannelMessage(db, {
      id: "f0000000-0000-4000-8000-0000000000b1",
      channelId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: "Standup in five",
      mentionedUserIds: [],
      mentionedAgentIds: [],
      createdAt: at(71),
    });

    const listed = await listChannels(db, organizationId, outsiderId);
    expect(listed.find((row) => row.id === channelId)).toMatchObject({
      last_message_at: at(71),
      last_unread_message_at: at(71),
      last_read_at: null,
    });
    expect(
      listed.find((row) => row.id === channelId),
    ).toEqual(expect.objectContaining({ last_unread_message_at: at(71) }));

    const ownerListed = await listChannels(db, organizationId, ownerId);
    expect(ownerListed.find((row) => row.id === channelId)?.last_unread_message_at)
      .toBeNull();

    const delta = await loadChannelDelta(
      db,
      organizationId,
      outsiderId,
      before.cursor,
    );
    expect(delta.channels.find((channel) => channel.id === channelId)).toMatchObject({
      hasUnread: true,
      lastMessageAt: at(71),
      lastReadAt: null,
    });

    await markChannelRead(db, {
      userId: outsiderId,
      channelId,
      lastReadAt: at(72),
    });
    const afterRead = await listChannels(db, organizationId, outsiderId);
    expect(afterRead.find((row) => row.id === channelId)).toMatchObject({
      last_read_at: at(72),
      last_unread_message_at: at(71),
    });
    expect(afterRead.find((row) => row.id === channelId)?.last_unread_message_at)
      .toBe(at(71));
    expect(
      (afterRead.find((row) => row.id === channelId)?.last_read_at ?? "")
        > (afterRead.find((row) => row.id === channelId)?.last_unread_message_at ?? ""),
    ).toBe(true);
  });

  it("threads messages and returns the structured mentions that were stored", async () => {
    const channelId = "e0000000-0000-4000-8000-000000000002";
    await createChannel(db, {
      id: channelId,
      organizationId,
      slug: "general",
      name: "General",
      topic: "Everything",
      visibility: "public",
      defaultProjectId: projectId,
      createdByUserId: ownerId,
      createdAt: at(3),
    });
    const rootId = "f0000000-0000-4000-8000-000000000001";
    await createChannelMessage(db, {
      id: rootId,
      channelId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: "Kick off",
      mentionedUserIds: [outsiderId],
      mentionedAgentIds: [],
      createdAt: at(4),
    });
    const cursorBeforeReply = await getChannelSyncCursor(db, organizationId);
    const replyId = "f0000000-0000-4000-8000-000000000002";
    await createChannelMessage(db, {
      id: replyId,
      channelId,
      parentMessageId: rootId,
      authorUserId: outsiderId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: "On it",
      mentionedUserIds: [],
      mentionedAgentIds: [],
      createdAt: at(5),
    });

    const roots = await listChannelRootMessages(db, channelId);
    expect(roots).toHaveLength(1);
    expect(roots[0]).toMatchObject({
      id: rootId,
      replyCount: 1,
      lastReplyAt: at(5),
      mentionedUserIds: [outsiderId],
    });
    expect(roots[0]?.author).toMatchObject({ type: "user", id: ownerId });
    expect(roots[0]?.replyAuthors).toEqual([
      expect.objectContaining({ type: "user", id: outsiderId, name: "Outsider" }),
    ]);

    const delta = await loadChannelDelta(
      db,
      organizationId,
      ownerId,
      cursorBeforeReply,
    );
    expect(delta.messages.find((message) => message.id === rootId)).toMatchObject({
      replyCount: 1,
      lastReplyAt: at(5),
      replyAuthors: [expect.objectContaining({ id: outsiderId })],
    });

    const thread = await listChannelThreadMessages(db, channelId, rootId);
    expect(thread.map((message) => message.id)).toEqual([rootId, replyId]);
    expect(thread[0]?.subscribers).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: ownerId }),
      expect.objectContaining({ userId: outsiderId }),
    ]));
    expect(thread[0]?.subscribers).toHaveLength(2);
  });

  it("auto-subscribes thread participants and notifies other subscribers", async () => {
    const channelId = "e2000000-0000-4000-8000-000000000001";
    const rootId = "e2000000-0000-4000-8000-000000000010";
    const replyId = "e2000000-0000-4000-8000-000000000011";
    const laterReplyId = "e2000000-0000-4000-8000-000000000012";
    const participantNotificationId =
      "e2000000-0000-4000-8000-000000000013";
    await createChannel(db, {
      id: channelId,
      organizationId,
      slug: "thread-subscribe",
      name: "Thread subscribe",
      topic: null,
      visibility: "public",
      defaultProjectId: null,
      createdByUserId: ownerId,
      createdAt: at(40),
    });
    await createChannelMessage(db, {
      id: rootId,
      channelId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: "Root for subscribers",
      mentionedUserIds: [],
      mentionedAgentIds: [],
      createdAt: at(41),
    });
    await createChannelMessage(db, {
      id: replyId,
      channelId,
      parentMessageId: rootId,
      authorUserId: outsiderId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: "Joining this thread",
      mentionedUserIds: [],
      mentionedAgentIds: [],
      createdAt: at(42),
    });
    await expect(
      listChannelThreadSubscriptions(db, channelId, rootId),
    ).resolves.toEqual([
      expect.objectContaining({ userId: ownerId }),
      expect.objectContaining({ userId: outsiderId }),
    ]);
    await expect(
      listChannelConversationNotifications(db, organizationId, ownerId),
    ).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: replyId,
        notification_reason: "thread_reply",
      }),
    ]));

    await unsubscribeChannelThread(db, channelId, rootId, ownerId);
    await subscribeChannelThread(
      db,
      channelId,
      rootId,
      ownerId,
      at(43),
    );
    await createChannelMessage(db, {
      id: laterReplyId,
      channelId,
      parentMessageId: rootId,
      authorUserId: outsiderId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: "A later update for subscribers",
      mentionedUserIds: [],
      mentionedAgentIds: [],
      createdAt: at(44),
    });
    await expect(
      listChannelConversationNotifications(db, organizationId, ownerId),
    ).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: laterReplyId,
        notification_reason: "thread_reply",
      }),
    ]));
    await expect(
      listChannelConversationNotifications(db, organizationId, outsiderId),
    ).resolves.not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: laterReplyId }),
    ]));

    await createChannelMessage(db, {
      id: participantNotificationId,
      channelId,
      parentMessageId: rootId,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: "A reply for the participating subscriber",
      mentionedUserIds: [],
      mentionedAgentIds: [],
      createdAt: at(45),
    });
    await expect(
      listChannelConversationNotifications(db, organizationId, outsiderId),
    ).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: participantNotificationId,
        notification_reason: "subscription",
      }),
    ]));
  });

  it("pages root messages from the newest twenty toward older history", async () => {
    const channelId = "e1000000-0000-4000-8000-000000000001";
    await createChannel(db, {
      id: channelId,
      organizationId,
      slug: "paged-history",
      name: "Paged history",
      topic: null,
      visibility: "public",
      defaultProjectId: null,
      createdByUserId: ownerId,
      createdAt: at(6),
    });
    const messageIds: string[] = [];
    for (let index = 1; index <= 25; index += 1) {
      const id = `f1000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
      messageIds.push(id);
      await createChannelMessage(db, {
        id,
        channelId,
        parentMessageId: null,
        authorUserId: ownerId,
        authorAgentId: null,
        authorAgentName: null,
        authorAgentProvider: null,
        body: `Message ${index}`,
        mentionedUserIds: [],
        mentionedAgentIds: [],
        createdAt: at(6 + index),
      });
    }

    const newest = await listChannelMessagePage(db, {
      channelId,
      parentMessageId: null,
      cursor: null,
      limit: 20,
    });
    expect(newest?.messages.map((message) => message.id)).toEqual(
      messageIds.slice(5),
    );
    expect(newest?.nextCursor).toBe(messageIds[5]);

    const earlier = await listChannelMessagePage(db, {
      channelId,
      parentMessageId: null,
      cursor: newest?.nextCursor ?? null,
      limit: 20,
    });
    expect(earlier?.messages.map((message) => message.id)).toEqual(
      messageIds.slice(0, 5),
    );
    expect(earlier?.nextCursor).toBeNull();
  });

  it("authenticates, rate limits, deduplicates, rotates, and revokes incoming webhooks", async () => {
    const channelId = "e0000000-0000-4000-8000-000000000060";
    const webhookId = "f0000000-0000-4000-8000-000000000060";
    const firstSecret = "s".repeat(43);
    const secondSecret = "t".repeat(43);
    const firstSecretHash = sha256Hex(firstSecret);
    const secondSecretHash = sha256Hex(secondSecret);
    await createChannel(db, {
      id: channelId,
      organizationId,
      slug: "incoming-webhooks",
      name: "Incoming webhooks",
      topic: null,
      visibility: "public",
      defaultProjectId: null,
      createdByUserId: ownerId,
      createdAt: at(56),
    });
    await createChannelWebhook(db, {
      id: webhookId,
      channelId,
      name: "Deploy notifier",
      secretHash: firstSecretHash,
      createdByUserId: ownerId,
      createdAt: at(57),
    });

    expect(await listChannelWebhooks(db, channelId)).toMatchObject([
      { id: webhookId, name: "Deploy notifier", revoked_at: null },
    ]);
    expect(await getIncomingChannelWebhook(db, webhookId, firstSecretHash))
      .toMatchObject({ id: webhookId, channel_id: channelId });
    expect(await getIncomingChannelWebhook(db, webhookId, sha256Hex("wrong")))
      .toBeNull();

    for (let request = 0; request < 60; request += 1) {
      await expect(consumeChannelWebhookRateLimit(
        db,
        webhookId,
        at(57),
        at(56),
      )).resolves.toBe(true);
    }
    await expect(consumeChannelWebhookRateLimit(
      db,
      webhookId,
      at(57),
      at(56),
    )).resolves.toBe(false);
    await expect(consumeChannelWebhookRateLimit(
      db,
      webhookId,
      at(59),
      at(58),
    )).resolves.toBe(true);

    const webhookUrl =
      `https://briar-api.example/hooks/channels/${webhookId}/${firstSecret}`;
    const apiEnv = { DB: db } as unknown as Env;
    const unsupported = await apiWorker.fetch(new Request(webhookUrl, {
      method: "POST",
      body: JSON.stringify({ text: "Production deployed" }),
    }), apiEnv);
    expect(unsupported.status).toBe(415);
    const malformed = await apiWorker.fetch(new Request(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "" }),
    }), apiEnv);
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({
      message: "Invalid request",
      issues: expect.arrayContaining([
        expect.objectContaining({ path: ["text"] }),
      ]),
    });
    const post = () => apiWorker.fetch(new Request(webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "route-deploy-42",
      },
      body: JSON.stringify({ text: "Production deployed through the API" }),
    }), apiEnv);
    const createdResponse = await post();
    expect(createdResponse.status).toBe(201);
    await expect(createdResponse.json()).resolves.toMatchObject({
      duplicate: false,
      message: {
        body: "Production deployed through the API",
        author: { type: "webhook", id: webhookId, name: "Deploy notifier" },
      },
    });
    const duplicateResponse = await post();
    expect(duplicateResponse.status).toBe(200);
    await expect(duplicateResponse.json()).resolves.toMatchObject({
      duplicate: true,
      message: { body: "Production deployed through the API" },
    });

    const blockResponse = await apiWorker.fetch(new Request(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        blocks: [
          {
            type: "header",
            text: { type: "plain_text", text: "Deploy complete" },
          },
          {
            type: "section",
            text: { type: "mrkdwn", text: "*Production* is healthy." },
          },
          { type: "divider" },
        ],
      }),
    }), apiEnv);
    expect(blockResponse.status).toBe(201);
    await expect(blockResponse.json()).resolves.toMatchObject({
      duplicate: false,
      message: {
        body: "Deploy complete\n*Production* is healthy.",
        blocks: [
          { type: "header" },
          { type: "section" },
          { type: "divider" },
        ],
        author: { type: "webhook", id: webhookId, name: "Deploy notifier" },
      },
    });

    const first = await createIncomingChannelWebhookMessage(db, {
      id: "f1000000-0000-4000-8000-000000000060",
      webhookId,
      channelId,
      webhookName: "Deploy notifier",
      eventId: "deploy-42",
      body: "Production deployed",
      blocks: null,
      createdAt: at(59),
    });
    expect(first).toMatchObject({
      created: true,
      message: {
        body: "Production deployed",
        author: { type: "webhook", id: webhookId, name: "Deploy notifier" },
      },
    });
    const duplicate = await createIncomingChannelWebhookMessage(db, {
      id: "f2000000-0000-4000-8000-000000000060",
      webhookId,
      channelId,
      webhookName: "Deploy notifier",
      eventId: "deploy-42",
      body: "This duplicate is ignored",
      blocks: null,
      createdAt: at(60),
    });
    expect(duplicate).toMatchObject({
      created: false,
      message: { id: first?.message?.id, body: "Production deployed" },
    });
    await expect(db.prepare(
      `select count(*) as count from briar_channel_agent_reply_jobs
       where trigger_message_id = ?`,
    ).bind(first?.message?.id).first()).resolves.toEqual({ count: 0 });

    await rotateChannelWebhook(db, {
      channelId,
      webhookId,
      secretHash: secondSecretHash,
      updatedAt: at(61),
    });
    expect(await getIncomingChannelWebhook(db, webhookId, firstSecretHash))
      .toBeNull();
    expect(await getIncomingChannelWebhook(db, webhookId, secondSecretHash))
      .not.toBeNull();

    await revokeChannelWebhook(db, {
      channelId,
      webhookId,
      revokedAt: at(62),
    });
    expect(await getIncomingChannelWebhook(db, webhookId, secondSecretHash))
      .toBeNull();
    expect((await listChannelRootMessages(db, channelId))[0]?.author)
      .toEqual({ type: "webhook", id: webhookId, name: "Deploy notifier" });
  });

  it("rejects a thread reply that points at another channel's message", async () => {
    const channelId = "e0000000-0000-4000-8000-000000000003";
    await createChannel(db, {
      id: channelId,
      organizationId,
      slug: "other-room",
      name: "Other room",
      topic: null,
      visibility: "public",
      defaultProjectId: null,
      createdByUserId: ownerId,
      createdAt: at(6),
    });
    const foreignParentId = "f0000000-0000-4000-8000-000000000001";
    const created = await createChannelMessage(db, {
      id: "f0000000-0000-4000-8000-000000000003",
      channelId,
      parentMessageId: foreignParentId,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: "Should not land",
      mentionedUserIds: [],
      mentionedAgentIds: [],
      createdAt: at(7),
    });
    expect(created).toBeNull();
  });

  it("stores channel image metadata with the message and returns an authenticated URL", async () => {
    const channelId = "e0000000-0000-4000-8000-000000000013";
    const messageId = "f0000000-0000-4000-8000-000000000013";
    const attachmentId = "fa000000-0000-4000-8000-000000000013";
    await createChannel(db, {
      id: channelId,
      organizationId,
      slug: "image-room",
      name: "Image room",
      topic: null,
      visibility: "public",
      defaultProjectId: null,
      createdByUserId: ownerId,
      createdAt: at(7),
    });

    const created = await createChannelMessage(db, {
      id: messageId,
      channelId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: `Screenshot\n\n![screen.png](briar-attachment://${attachmentId})`,
      mentionedUserIds: [],
      mentionedAgentIds: [],
      attachments: [{
        id: attachmentId,
        organization_id: organizationId,
        object_key: `channel-attachments/${organizationId}/${channelId}/${messageId}/${attachmentId}`,
        filename: "screen.png",
        content_type: "image/png",
        byte_size: 5,
      }],
      createdAt: at(8),
    });

    expect(created?.attachments).toEqual([{
      id: attachmentId,
      filename: "screen.png",
      contentType: "image/png",
      byteSize: 5,
      url: `/organizations/${organizationId}/channels/${channelId}/messages/${messageId}/attachments/${attachmentId}`,
    }]);
    await expect(
      getChannelMessageAttachment(
        db,
        organizationId,
        channelId,
        messageId,
        attachmentId,
      ),
    ).resolves.toMatchObject({ object_key: expect.stringContaining(attachmentId) });
  });

  it("returns a channel document body only through the authenticated document route", async () => {
    const channelId = "e0000000-0000-4000-8000-000000000150";
    const messageId = "f0000000-0000-4000-8000-000000000150";
    await createChannel(db, {
      id: channelId,
      organizationId,
      slug: "document-room",
      name: "Document room",
      topic: null,
      visibility: "public",
      defaultProjectId: null,
      createdByUserId: ownerId,
      createdAt: at(7),
    });
    await createChannelMessage(db, {
      id: messageId,
      channelId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: "Attached the plan.",
      mentionedUserIds: [],
      mentionedAgentIds: [],
      createdAt: at(8),
    });
    await db.prepare(
      `insert into briar_channel_message_documents (
         message_id, channel_id, project_id, title, markdown, created_at, updated_at
       ) values (?, ?, null, 'Rollout plan', '# Rollout\n\n- Verify access', ?, ?)`,
    ).bind(messageId, channelId, at(8), at(8)).run();

    await expect(getChannelMessageDocument(db, channelId, messageId))
      .resolves.toMatchObject({
        message_id: messageId,
        title: "Rollout plan",
        markdown: "# Rollout\n\n- Verify access",
      });

    const apiEnv = {
      DB: db,
      ARCHIVES: archives,
      BETTER_AUTH_SECRET: "channels-document-test-channels-document-test",
      GOOGLE_CLIENT_ID: "google-client-test",
      GOOGLE_CLIENT_SECRET: "google-secret-test",
    } as unknown as Env;
    const response = await apiWorker.fetch(new Request(
      `https://briar-api.example/organizations/${organizationId}/channels/${channelId}/messages/${messageId}/document`,
      { headers: { authorization: `Bearer ${ownerSessionToken}` } },
    ), apiEnv);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      document: {
        messageId,
        title: "Rollout plan",
        markdown: "# Rollout\n\n- Verify access",
        projectId: null,
      },
    });
  });

  it("atomically queues channel attachments for retryable deletion", async () => {
    const channelId = "e0000000-0000-4000-8000-000000000016";
    const messageId = "f0000000-0000-4000-8000-000000000016";
    const attachmentId = "fa000000-0000-4000-8000-000000000016";
    const objectKey =
      `channel-attachments/${organizationId}/${channelId}/${messageId}/${attachmentId}`;
    await createChannel(db, {
      id: channelId,
      organizationId,
      slug: "delete-image-room",
      name: "Delete image room",
      topic: null,
      visibility: "public",
      defaultProjectId: null,
      createdByUserId: ownerId,
      createdAt: at(8),
    });
    await createChannelMessage(db, {
      id: messageId,
      channelId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: "Delete this image",
      mentionedUserIds: [],
      mentionedAgentIds: [],
      attachments: [{
        id: attachmentId,
        organization_id: organizationId,
        object_key: objectKey,
        filename: "delete.png",
        content_type: "image/png",
        byte_size: 5,
      }],
      createdAt: at(8),
    });
    await archives.put(objectKey, "image");

    await expect(
      deleteChannel(db, organizationId, channelId, ownerId, at(9)),
    ).resolves.toBe(true);
    await expect(
      db
        .prepare(
          `select project_id, run_id from briar_archive_cleanup_queue
           where bucket = 'attachments' and object_key = ?`,
        )
        .bind(objectKey)
        .first(),
    ).resolves.toEqual({ project_id: `channel:${channelId}`, run_id: null });

    await expect(
      processArchiveCleanupQueue(db, archives, archives, at(9), 10),
    ).resolves.toEqual({ deleted: 1, failed: 0 });
    await expect(archives.head(objectKey)).resolves.toBeNull();
  });

  it("does not delete or queue attachments after an admin role is removed", async () => {
    const channelId = "e0000000-0000-4000-8000-000000000017";
    const messageId = "f0000000-0000-4000-8000-000000000017";
    const attachmentId = "fa000000-0000-4000-8000-000000000017";
    const objectKey =
      `channel-attachments/${organizationId}/${channelId}/${messageId}/${attachmentId}`;
    await db
      .prepare(
        `update briar_organization_members
         set role = 'admin', updated_at = ?
         where organization_id = ? and user_id = ?`,
      )
      .bind(at(8), organizationId, outsiderId)
      .run();
    await createChannel(db, {
      id: channelId,
      organizationId,
      slug: "role-race-room",
      name: "Role race room",
      topic: null,
      visibility: "public",
      defaultProjectId: null,
      createdByUserId: ownerId,
      createdAt: at(8),
    });
    await createChannelMessage(db, {
      id: messageId,
      channelId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: "Keep this image",
      mentionedUserIds: [],
      mentionedAgentIds: [],
      attachments: [{
        id: attachmentId,
        organization_id: organizationId,
        object_key: objectKey,
        filename: "keep.png",
        content_type: "image/png",
        byte_size: 5,
      }],
      createdAt: at(8),
    });

    const apiEnv = {
      DB: db,
      ARCHIVES: archives,
      BETTER_AUTH_SECRET: "channels-admin-delete-test-admin-delete-test",
      GOOGLE_CLIENT_ID: "google-client-test",
      GOOGLE_CLIENT_SECRET: "google-secret-test",
    } as unknown as Env;
    const adminResponse = await apiWorker.fetch(new Request(
      `https://briar-api.example/organizations/${organizationId}/channels/${channelId}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${outsiderSessionToken}` },
      },
    ), apiEnv);
    expect(adminResponse.status).toBe(403);

    await expect(
      deleteChannel(db, organizationId, channelId, outsiderId, at(8)),
    ).resolves.toBe(false);
    await expect(getChannelById(db, organizationId, channelId))
      .resolves.toMatchObject({ id: channelId });

    // The route may have observed the prior admin role. The deletion batch must
    // authorize again after the downgrade and leave both D1 resources intact.
    await db
      .prepare(
        `update briar_organization_members
         set role = 'member', updated_at = ?
         where organization_id = ? and user_id = ?`,
      )
      .bind(at(9), organizationId, outsiderId)
      .run();

    await expect(
      deleteChannel(db, organizationId, channelId, outsiderId, at(9)),
    ).resolves.toBe(false);
    await expect(
      getChannelById(db, organizationId, channelId),
    ).resolves.toMatchObject({ id: channelId });
    await expect(
      getChannelMessageAttachment(
        db,
        organizationId,
        channelId,
        messageId,
        attachmentId,
      ),
    ).resolves.toMatchObject({ object_key: objectKey });
    await expect(
      db
        .prepare(
          `select object_key from briar_archive_cleanup_queue
           where bucket = 'attachments' and object_key = ?`,
        )
        .bind(objectKey)
        .first(),
    ).resolves.toBeNull();
  });

  it("lets a channel creator delete through the authenticated API route", async () => {
    const channelId = "e0000000-0000-4000-8000-000000000019";
    await createChannel(db, {
      id: channelId,
      organizationId,
      slug: "creator-api-delete-room",
      name: "Creator API delete room",
      topic: null,
      visibility: "public",
      defaultProjectId: null,
      createdByUserId: outsiderId,
      createdAt: at(12),
    });
    const apiEnv = {
      DB: db,
      ARCHIVES: archives,
      BETTER_AUTH_SECRET: "channels-creator-delete-test-creator-delete-test",
      GOOGLE_CLIENT_ID: "google-client-test",
      GOOGLE_CLIENT_SECRET: "google-secret-test",
    } as unknown as Env;

    const response = await apiWorker.fetch(new Request(
      `https://briar-api.example/organizations/${organizationId}/channels/${channelId}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${outsiderSessionToken}` },
      },
    ), apiEnv);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deleted: true });
    await expect(getChannelById(db, organizationId, channelId)).resolves.toBeNull();
  });

  it("limits a claimed reply image to its device, token, and trigger message", async () => {
    const channelId = "e0000000-0000-4000-8000-000000000014";
    const triggerId = "f0000000-0000-4000-8000-000000000014";
    const attachmentId = "fa000000-0000-4000-8000-000000000014";
    const otherMessageId = "f0000000-0000-4000-8000-000000000015";
    const otherAttachmentId = "fa000000-0000-4000-8000-000000000015";
    const claimTokenHash = "4".repeat(64);
    await createChannel(db, {
      id: channelId,
      organizationId,
      slug: "vision-room",
      name: "Vision room",
      topic: null,
      visibility: "private",
      defaultProjectId: null,
      createdByUserId: ownerId,
      createdAt: at(8),
    });
    const agent = await createOrganizationAgent(db, {
      id: "aa000000-0000-4000-8000-000000000014",
      organizationId,
      name: "Vision",
      provider: "grok",
      model: null,
      responsibility: "Inspect images",
      effort: null,
      createdAt: at(8),
    });
    await addChannelAgent(db, {
      channelId,
      agentId: agent!.id,
      addedByUserId: ownerId,
      createdAt: at(8),
    });
    await createChannelMessage(db, {
      id: triggerId,
      channelId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: "@vision inspect this image",
      mentionedUserIds: [],
      mentionedAgentIds: [agent!.id],
      attachments: [{
        id: attachmentId,
        organization_id: organizationId,
        object_key: `channel-attachments/${organizationId}/${channelId}/${triggerId}/${attachmentId}`,
        filename: "trigger.png",
        content_type: "image/png",
        byte_size: 5,
      }],
      createdAt: at(8),
    });
    await createChannelMessage(db, {
      id: otherMessageId,
      channelId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: "Private unrelated image",
      mentionedUserIds: [],
      mentionedAgentIds: [],
      attachments: [{
        id: otherAttachmentId,
        organization_id: organizationId,
        object_key: `channel-attachments/${organizationId}/${channelId}/${otherMessageId}/${otherAttachmentId}`,
        filename: "other.png",
        content_type: "image/png",
        byte_size: 5,
      }],
      createdAt: at(8),
    });
    await enqueueChannelAgentReplies(db, {
      organizationId,
      channelId,
      triggerMessageId: triggerId,
      parentMessageId: triggerId,
      agents: [{ id: agent!.id, projectId: null, provider: "grok" }],
      createdAt: at(8),
    });
    const claimRequestedAt = new Date().toISOString();
    await db.prepare(
      `update briar_execution_workers
       set capabilities_json = ?, last_heartbeat_at = ? where id = ?`,
    ).bind(
      JSON.stringify({
        providerHealth: { claude: { healthy: true } },
        organizationAgentContext: { protocol: 1 },
      }),
      claimRequestedAt,
      otherWorkerId,
    ).run();
    const claimed = await claimNextChannelAgentReply(db, organizationId, {
      deviceId,
      workerId: otherWorkerId,
      providers: ["grok"],
      supportsOrganizationAgentContext: true,
      claimTokenHash,
      claimedAt: at(9),
      leaseExpiresAt: at(19),
    });
    expect(claimed).not.toBeNull();

    const lookup = (overrides: Partial<Parameters<typeof getClaimedChannelReplyAttachment>[1]> = {}) =>
      getClaimedChannelReplyAttachment(db, {
        organizationId,
        jobId: claimed!.id,
        deviceId,
        claimTokenHash,
        attachmentId,
        observedAt: at(10),
        ...overrides,
      });
    await expect(lookup()).resolves.toMatchObject({
      id: attachmentId,
      message_id: triggerId,
    });
    await expect(lookup({ deviceId: "c0000000-0000-4000-8000-000000000099" }))
      .resolves.toBeNull();
    await expect(lookup({ claimTokenHash: "9".repeat(64) })).resolves.toBeNull();
    await expect(lookup({ attachmentId: otherAttachmentId })).resolves.toBeNull();
    await expect(lookup({ observedAt: at(20) })).resolves.toBeNull();
    await db.prepare(
      `update briar_execution_workers set state = 'disabled' where id = ?`,
    ).bind(otherWorkerId).run();
    await expect(lookup()).resolves.toBeNull();
    await db.prepare(
      `update briar_execution_workers set state = 'online' where id = ?`,
    ).bind(otherWorkerId).run();
    await completeChannelReply(db, claimed!, {
      jobId: claimed!.id,
      deviceId,
      workerId: otherWorkerId,
      claimTokenHash,
      body: "I inspected the image.",
      document: null,
      issueProposal: null,
      executionProposal: null,
      agentName: "Vision",
      agentProvider: "grok",
      completedAt: at(10),
    });
  });

  it("keeps a claimed organization Agent reply in the trigger thread", async () => {
    const channelId = "e0000000-0000-4000-8000-000000000004";
    await createChannel(db, {
      id: channelId,
      organizationId,
      slug: "ideation",
      name: "Ideation",
      topic: null,
      visibility: "public",
      defaultProjectId: null,
      createdByUserId: ownerId,
      createdAt: at(8),
    });
    const agent = await createOrganizationAgent(db, {
      id: "aa000000-0000-4000-8000-000000000001",
      organizationId,
      name: "Honey",
      provider: "claude",
      model: null,
      description: "Helps the team write and refine content.",
      responsibility: "Writing partner",
      effort: null,
      skills: [
        {
          id: "ab000000-0000-4000-8000-000000000001",
          name: "Writing",
          description: "Use for concise channel responses.",
          body: "Write concise channel responses.",
          provider: "claude",
          model: null,
          effort: null,
          kind: "custom",
          position: 0,
        },
        {
          id: "ab000000-0000-4000-8000-000000000002",
          name: "Product planning",
          description: "Use for product planning requests.",
          body: "Create implementation plans.",
          provider: "grok",
          model: null,
          effort: "high",
          kind: "custom",
          position: 1,
        },
      ],
      createdAt: at(8),
    });
    expect(agent?.skills).toHaveLength(2);
    expect(agent).toMatchObject({
      name: "Honey",
      description: "Helps the team write and refine content.",
      project_id: null,
    });
    const avatar = "data:image/png;base64,large-agent-avatar";
    await db.prepare(
      `update briar_project_agents set avatar = ? where id = ?`,
    ).bind(avatar, agent!.id).run();
    await addChannelAgent(db, {
      channelId,
      agentId: agent!.id,
      addedByUserId: ownerId,
      createdAt: at(8),
    });

    const triggerId = "f0000000-0000-4000-8000-000000000004";
    await createChannelMessage(db, {
      id: triggerId,
      channelId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: "@Honey write the plan",
      mentionedUserIds: [],
      mentionedAgentIds: [agent!.id],
      createdAt: at(9),
    });
    const agentReplyId = "f5000000-0000-4000-8000-000000000004";
    await createChannelMessage(db, {
      id: agentReplyId,
      channelId,
      parentMessageId: triggerId,
      authorUserId: null,
      authorAgentId: agent!.id,
      authorAgentName: agent!.name,
      authorAgentProvider: "claude",
      body: "I can write that plan.",
      mentionedUserIds: [],
      mentionedAgentIds: [],
      createdAt: at(9),
    });
    const jobs = await enqueueChannelAgentReplies(db, {
      organizationId,
      channelId,
      triggerMessageId: triggerId,
      parentMessageId: triggerId,
      agents: [{
        id: agent!.id,
        projectId: null,
        skillId: agent!.skills[0].id,
        provider: "claude",
      }],
      createdAt: at(9),
    });
    expect(jobs).toHaveLength(1);

    // Organization work still requires the exact host binding to be enabled at
    // the atomic claim boundary.
    await db.prepare(
      `update briar_execution_workers set capabilities_json = '{}' where id = ?`,
    ).bind(otherWorkerId).run();
    await db.prepare(
      `update briar_execution_workers set state = 'disabled' where id = ?`,
    ).bind(otherWorkerId).run();
    await expect(
      claimNextChannelAgentReply(db, organizationId, {
        deviceId,
        workerId: otherWorkerId,
        providers: ["claude"],
        supportsOrganizationAgentContext: true,
        claimTokenHash: "0".repeat(64),
        claimedAt: at(9),
        leaseExpiresAt: at(19),
      }),
    ).resolves.toBeNull();
    await db.prepare(
      `update briar_execution_workers set state = 'online' where id = ?`,
    ).bind(otherWorkerId).run();

    await expect(
      claimNextChannelAgentReply(db, organizationId, {
        deviceId,
        workerId: otherWorkerId,
        providers: ["claude"],
        supportsOrganizationAgentContext: true,
        claimTokenHash: "0".repeat(64),
        claimedAt: at(10),
        leaseExpiresAt: at(20),
      }),
    ).resolves.toBeNull();
    await db.prepare(
      `update briar_execution_workers set capabilities_json = ? where id = ?`,
    ).bind(
      JSON.stringify({ organizationAgentContext: { protocol: true } }),
      otherWorkerId,
    ).run();
    await expect(
      claimNextChannelAgentReply(db, organizationId, {
        deviceId,
        workerId: otherWorkerId,
        providers: ["claude"],
        supportsOrganizationAgentContext: true,
        claimTokenHash: "0".repeat(64),
        claimedAt: at(10),
        leaseExpiresAt: at(20),
      }),
    ).resolves.toBeNull();
    const claimRequestedAt = new Date().toISOString();
    await db.prepare(
      `update briar_execution_workers
       set capabilities_json = ?, last_heartbeat_at = ? where id = ?`,
    ).bind(
      JSON.stringify({
        providerHealth: { claude: { healthy: true } },
        organizationAgentContext: { protocol: 1 },
      }),
      claimRequestedAt,
      otherWorkerId,
    ).run();
    await expect(
      claimNextChannelAgentReply(db, organizationId, {
        deviceId,
        workerId: otherWorkerId,
        providers: ["claude"],
        supportsOrganizationAgentContext: false,
        claimTokenHash: "0".repeat(64),
        claimedAt: at(10),
        leaseExpiresAt: at(20),
      }),
    ).resolves.toBeNull();
    // A normal execution may occupy the Worker while a reply still claims
    // the same provider; replies must not consume the regular slot.
    await db.prepare(
      `update briar_execution_workers set readiness_state = 'busy' where id = ?`,
    ).bind(otherWorkerId).run();

    const apiEnv = {
      DB: db,
      ARCHIVES: archives,
      BETTER_AUTH_SECRET: "channels-context-test-secret-channels-context-test",
      GOOGLE_CLIENT_ID: "google-client-test",
      GOOGLE_CLIENT_SECRET: "google-secret-test",
    } as unknown as Env;
    const claimResponse = await apiWorker.fetch(
      new Request("https://briar-api.example/channel-reply-claims", {
        method: "POST",
        headers: {
          authorization: `Bearer ${contextWorkerToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ organizationId, workerId: otherWorkerId }),
      }),
      apiEnv,
    );
    expect(claimResponse.status).toBe(200);
    const claimPayload = await claimResponse.json() as {
      work: {
        workId: string;
        claimToken: string;
        claimedAt: string;
        leaseExpiresAt: string;
        organizationContext: { schemaVersion: 1; snapshotAt: string };
        snapshot: {
          projectTargets: Array<{ id: string; name: string }>;
          messages: Array<Record<string, unknown>>;
        };
      };
    };
    expect(claimPayload.work).toMatchObject({
      workId: jobs[0].id,
      organizationContext: {
        schemaVersion: 1,
        snapshotAt: claimPayload.work.claimedAt,
      },
      snapshot: { projectTargets: [] },
    });
    expect(claimPayload.work.snapshot.messages).toHaveLength(2);
    expect(claimPayload.work.snapshot.messages[1]).toMatchObject({
      id: agentReplyId,
      parentMessageId: triggerId,
      author: { type: "agent", id: agent!.id, name: "Honey" },
      body: "I can write that plan.",
    });
    expect(Object.keys(claimPayload.work.snapshot.messages[1]!.author as object))
      .toEqual(["type", "id", "name"]);
    const serializedReplyContext = JSON.stringify(
      claimPayload.work.snapshot.messages,
    );
    expect(serializedReplyContext).not.toContain(avatar);
    expect(serializedReplyContext).not.toContain("owner@example.com");
    expect(serializedReplyContext).not.toContain("replyAuthors");
    expect(serializedReplyContext).not.toContain("reactions");
    expect(serializedReplyContext).not.toContain("blocks");
    const claimed = await getChannelAgentReplyJob(
      db,
      organizationId,
      claimPayload.work.workId,
    );
    expect(claimed).toMatchObject({
      agent_id: agent!.id,
      skill_id: agent!.skills[0].id,
      project_id: null,
      status: "running",
    });

    const contextClaim = (overrides: Partial<Parameters<
      typeof getActiveOrganizationChannelReplyContextClaim
    >[1]> = {}) =>
      getActiveOrganizationChannelReplyContextClaim(db, {
        organizationId,
        jobId: claimed!.id,
        deviceId,
        workerId: otherWorkerId,
        claimTokenHash: sha256Hex(claimPayload.work.claimToken),
        observedAt: claimPayload.work.claimedAt,
        ...overrides,
      });
    // Claim-time capability gating is repeated for every context page.
    await db.prepare(
      `update briar_execution_workers set capabilities_json = ? where id = ?`,
    ).bind(
      JSON.stringify({ organizationAgentContext: { protocol: true } }),
      otherWorkerId,
    ).run();
    await expect(contextClaim()).resolves.toBeNull();
    await db.prepare(
      `update briar_execution_workers set capabilities_json = ? where id = ?`,
    ).bind(
      JSON.stringify({ organizationAgentContext: { protocol: 2 } }),
      otherWorkerId,
    ).run();
    await expect(contextClaim()).resolves.toBeNull();
    await db.prepare(
      `update briar_execution_workers set capabilities_json = ? where id = ?`,
    ).bind(
      JSON.stringify({ organizationAgentContext: { protocol: 1 } }),
      otherWorkerId,
    ).run();
    await expect(contextClaim()).resolves.toMatchObject({ id: claimed!.id });
    await expect(contextClaim({
      organizationId: otherOrganizationId,
    })).resolves.toBeNull();
    await expect(contextClaim({
      claimTokenHash: "9".repeat(64),
    })).resolves.toBeNull();
    await expect(contextClaim({
      observedAt: claimPayload.work.leaseExpiresAt,
    })).resolves.toBeNull();

    const contextResponse = await apiWorker.fetch(
      new Request(
        `https://briar-api.example/organizations/${organizationId}/channel-reply-claims/${claimed!.id}/organization-context/projects?workerId=${otherWorkerId}&limit=1`,
        {
          headers: {
            authorization: `Bearer ${contextWorkerToken}`,
            [channelReplyClaimTokenHeader]: claimPayload.work.claimToken,
          },
        },
      ),
      apiEnv,
    );
    expect(contextResponse.status).toBe(200);
    expect(contextResponse.headers.get("Cache-Control")).toBe(
      "private, no-store",
    );
    await expect(contextResponse.json()).resolves.toMatchObject({
      schemaVersion: 1,
      organizationId,
      workId: claimed!.id,
      resource: "projects",
      snapshotAt: claimPayload.work.claimedAt,
      total: 2,
      items: [{ id: projectId }],
      complete: false,
    });

    const manifestUrl =
      `https://briar-api.example/organizations/${organizationId}/channel-reply-claims/${claimed!.id}/organization-context/manifest?workerId=${otherWorkerId}`;
    const manifestResponse = await apiWorker.fetch(
      new Request(manifestUrl, {
        headers: {
          authorization: `Bearer ${contextWorkerToken}`,
          [channelReplyClaimTokenHeader]: claimPayload.work.claimToken,
        },
      }),
      apiEnv,
    );
    expect(manifestResponse.status).toBe(200);
    expect(manifestResponse.headers.get("ETag")).toMatch(
      /^"[0-9a-f]{64}"$/u,
    );
    await expect(manifestResponse.json()).resolves.toMatchObject({
      schemaVersion: 2,
      organizationId,
      workId: claimed!.id,
      projects: expect.arrayContaining([
        expect.objectContaining({ id: projectId }),
      ]),
      loadedQueries: [],
    });
    const unchangedManifest = await apiWorker.fetch(
      new Request(manifestUrl, {
        headers: {
          authorization: `Bearer ${contextWorkerToken}`,
          [channelReplyClaimTokenHeader]: claimPayload.work.claimToken,
          "If-None-Match": manifestResponse.headers.get("ETag")!,
        },
      }),
      apiEnv,
    );
    expect(unchangedManifest.status).toBe(304);

    const lookupResponse = await apiWorker.fetch(
      new Request(
        `https://briar-api.example/organizations/${organizationId}/channel-reply-claims/${claimed!.id}/organization-context/lookup`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${contextWorkerToken}`,
            "content-type": "application/json",
            [channelReplyClaimTokenHeader]: claimPayload.work.claimToken,
          },
          body: JSON.stringify({
            workerId: otherWorkerId,
            requests: [{ resource: "project-settings", projectId }],
          }),
        },
      ),
      apiEnv,
    );
    expect(lookupResponse.status).toBe(200);
    await expect(lookupResponse.json()).resolves.toMatchObject({
      schemaVersion: 2,
      results: [{
        request: { resource: "project-settings", projectId },
        data: { id: projectId, settings: expect.any(Object) },
      }],
    });

    const completed = await completeChannelReply(db, claimed!, {
      jobId: claimed!.id,
      deviceId,
      workerId: otherWorkerId,
      claimTokenHash: sha256Hex(claimPayload.work.claimToken),
      body: "Here is the plan.",
      document: {
        title: "Onboarding plan",
        markdown: "# Onboarding\n\nSteps.",
        projectId: null,
      },
      issueProposal: {
        projectId,
        executeAfterCreate: false,
        issue: {
          title: "Build onboarding",
          description: null,
          priority: null,
          status: "backlog",
        },
      },
      executionProposal: null,
      agentName: "Honey",
      agentProvider: "claude",
      completedAt: new Date(
        Date.parse(claimPayload.work.claimedAt) + 1_000,
      ).toISOString(),
    });
    expect(completed).toMatchObject({ status: "completed" });

    const reply = await getChannelMessage(db, channelId, claimed!.reply_message_id);
    expect(reply?.author).toMatchObject({ type: "agent", name: "Honey" });
    expect(reply?.parentMessageId).toBe(triggerId);
    expect(
      (await listChannelThreadMessages(db, channelId, triggerId)).map(
        (message) => message.id,
      ),
    ).toContain(claimed!.reply_message_id);
    expect(
      (await listChannelRootMessages(db, channelId)).map((message) => message.id),
    ).not.toContain(claimed!.reply_message_id);
    // A plan document with no project stays organization-wide until a member
    // decides where the work belongs.
    expect(reply?.document).toMatchObject({
      messageId: claimed!.reply_message_id,
      title: "Onboarding plan",
      projectId: null,
    });
    expect(reply?.proposal).toMatchObject({
      actionType: "request_issue_create",
      status: "pending",
      projectId,
    });
    await expect(
      getChannelActionProposal(db, channelId, reply!.proposal!.id),
    ).resolves.toMatchObject({
      reply_author_agent_id: agent!.id,
      reply_author_agent_organization_id: organizationId,
      reply_author_agent_project_id: null,
    });

    const stored = await db
      .prepare(
        `select channel_id, project_id, markdown
         from briar_channel_message_documents where message_id = ?`,
      )
      .bind(claimed!.reply_message_id)
      .first<{ channel_id: string; project_id: string | null; markdown: string }>();
    expect(stored).toMatchObject({
      channel_id: channelId,
      project_id: null,
      markdown: "# Onboarding\n\nSteps.",
    });
  });

  it("stores reply images on the completed agent message", async () => {
    const channelId = "e0000000-0000-4000-8000-000000000070";
    await createChannel(db, {
      id: channelId,
      organizationId,
      slug: "reply-images",
      name: "Reply images",
      topic: null,
      visibility: "public",
      defaultProjectId: null,
      createdByUserId: ownerId,
      createdAt: at(70),
    });
    const agent = await createOrganizationAgent(db, {
      id: "aa000000-0000-4000-8000-000000000070",
      organizationId,
      name: "Screenshoter",
      provider: "claude",
      model: null,
      responsibility: "Show captured screens",
      effort: null,
      createdAt: at(70),
    });
    await addChannelAgent(db, {
      channelId,
      agentId: agent!.id,
      addedByUserId: ownerId,
      createdAt: at(70),
    });
    const threadRootId = "f0000000-0000-4000-8000-000000000069";
    await createChannelMessage(db, {
      id: threadRootId,
      channelId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: "Show me modal examples",
      mentionedUserIds: [],
      mentionedAgentIds: [],
      createdAt: at(70),
    });
    const triggerId = "f0000000-0000-4000-8000-000000000070";
    await createChannelMessage(db, {
      id: triggerId,
      channelId,
      parentMessageId: threadRootId,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: "@screenshoter show the modal",
      mentionedUserIds: [],
      mentionedAgentIds: [agent!.id],
      createdAt: at(71),
    });
    await enqueueChannelAgentReplies(db, {
      organizationId,
      channelId,
      triggerMessageId: triggerId,
      parentMessageId: threadRootId,
      agents: [{ id: agent!.id, projectId: null, provider: "claude" }],
      createdAt: at(71),
    });
    await db.prepare(
      `update briar_execution_workers
       set capabilities_json = ?, last_heartbeat_at = ? where id = ?`,
    ).bind(
      JSON.stringify({
        providerHealth: { claude: { healthy: true } },
        organizationAgentContext: { protocol: 1 },
      }),
      at(72),
      otherWorkerId,
    ).run();
    const claimed = await claimNextChannelAgentReply(db, organizationId, {
      deviceId,
      workerId: otherWorkerId,
      providers: ["claude"],
      supportsOrganizationAgentContext: true,
      claimTokenHash: "7".repeat(64),
      claimedAt: at(72),
      leaseExpiresAt: at(82),
    });
    expect(claimed).not.toBeNull();
    const attachmentId = "fa000000-0000-4000-8000-000000000070";
    const objectKey =
      `channel-attachments/${organizationId}/${channelId}/${claimed!.reply_message_id}/${attachmentId}`;
    const completed = await completeChannelReply(db, claimed!, {
      jobId: claimed!.id,
      deviceId,
      workerId: otherWorkerId,
      claimTokenHash: "7".repeat(64),
      body: "Here is the captured screen.",
      document: null,
      issueProposal: null,
      executionProposal: null,
      agentName: "Screenshoter",
      agentProvider: "claude",
      completedAt: at(73),
      attachments: [{
        id: attachmentId,
        organization_id: organizationId,
        object_key: objectKey,
        filename: "screenshot.png",
        content_type: "image/png",
        byte_size: 4,
      }],
    });
    expect(completed).toMatchObject({ status: "completed" });
    const reply = await getChannelMessage(
      db,
      channelId,
      claimed!.reply_message_id,
    );
    expect(reply?.parentMessageId).toBe(threadRootId);
    expect(
      (await listChannelThreadMessages(db, channelId, threadRootId)).map(
        (message) => message.id,
      ),
    ).toContain(claimed!.reply_message_id);
    expect(
      (await listChannelRootMessages(db, channelId)).map((message) => message.id),
    ).not.toContain(claimed!.reply_message_id);
    expect(reply?.attachments).toEqual([{
      id: attachmentId,
      filename: "screenshot.png",
      contentType: "image/png",
      byteSize: 4,
      url:
        `/organizations/${organizationId}/channels/${channelId}/messages/${claimed!.reply_message_id}/attachments/${attachmentId}`,
    }]);
  });

  it("keeps a project Agent reply unclaimable until the device is bound to that project", async () => {
    const channelId = "e0000000-0000-4000-8000-000000000005";
    await createChannel(db, {
      id: channelId,
      organizationId,
      slug: "project-room",
      name: "Project room",
      topic: null,
      visibility: "public",
      defaultProjectId: projectId,
      createdByUserId: ownerId,
      createdAt: at(12),
    });
    const agentId = "aa000000-0000-4000-8000-000000000002";
    await db
      .prepare(
        `insert into briar_project_agents (
           id, organization_id, project_id, name, avatar, provider,
           responsibility, created_at, updated_at
         ) values (?, ?, ?, 'Bumble', ?, 'claude', 'Research', ?, ?)`,
      )
      .bind(
        agentId,
        organizationId,
        projectId,
        "data:image/png;base64,cHJvamVjdC1hdmF0YXI=",
        at(12),
        at(12),
      )
      .run();
    await addChannelAgent(db, {
      channelId,
      agentId,
      addedByUserId: ownerId,
      createdAt: at(12),
    });
    expect(
      await listOrganizationAgents(db, organizationId, { projectId }),
    ).toEqual([
      expect.objectContaining({
        id: agentId,
        avatar: "data:image/png;base64,cHJvamVjdC1hdmF0YXI=",
        project_id: projectId,
        project_name: "Project",
      }),
    ]);
    const triggerId = "f0000000-0000-4000-8000-000000000005";
    await createChannelMessage(db, {
      id: triggerId,
      channelId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: "@bumble look into this",
      mentionedUserIds: [],
      mentionedAgentIds: [agentId],
      createdAt: at(13),
    });
    await enqueueChannelAgentReplies(db, {
      organizationId,
      channelId,
      triggerMessageId: triggerId,
      parentMessageId: triggerId,
      agents: [{ id: agentId, projectId, provider: "claude" }],
      createdAt: at(13),
    });

    expect(
      await claimNextChannelAgentReply(db, organizationId, {
        deviceId,
        workerId: otherWorkerId,
        providers: ["claude"],
        supportsOrganizationAgentContext: false,
        claimTokenHash: "2".repeat(64),
        claimedAt: at(14),
        leaseExpiresAt: at(24),
      }),
    ).toBeNull();

    await bindWorkerToProject();
    const claimed = await claimNextChannelAgentReply(db, organizationId, {
      deviceId,
      workerId: boundWorkerId,
      providers: ["claude"],
      supportsOrganizationAgentContext: false,
      claimTokenHash: "2".repeat(64),
      claimedAt: at(15),
      leaseExpiresAt: at(25),
    });
    expect(claimed).toMatchObject({
      agent_id: agentId,
      project_id: projectId,
      claimed_worker_id: boundWorkerId,
    });
    // A pre-scope claim or a deleted binding leaves claimed_worker_id null.
    // It must expire and requeue; another binding can never adopt its token.
    await db.prepare(
      `update briar_channel_agent_reply_jobs
       set claimed_worker_id = null where id = ?`,
    ).bind(claimed!.id).run();

    await expect(
      failChannelReply(db, {
        jobId: claimed!.id,
        deviceId,
        workerId: otherWorkerId,
        claimTokenHash: "2".repeat(64),
        error: "wrong project loop",
        updatedAt: at(16),
      }),
    ).resolves.toBeNull();

    await expect(
      renewChannelReplyLease(db, {
        jobId: claimed!.id,
        deviceId,
        workerId: boundWorkerId,
        claimTokenHash: "2".repeat(64),
        observedAt: at(16),
        leaseExpiresAt: at(26),
      }),
    ).resolves.toBeNull();
    await db.prepare(
      `update briar_channel_agent_reply_jobs
       set claimed_worker_id = ? where id = ?`,
    ).bind(boundWorkerId, claimed!.id).run();

    await expect(
      getClaimedChannelReply(db, {
        jobId: claimed!.id,
        deviceId,
        workerId: boundWorkerId,
        claimTokenHash: "2".repeat(64),
        observedAt: at(26),
      }),
    ).resolves.toBeNull();
    await expect(
      renewChannelReplyLease(db, {
        jobId: claimed!.id,
        deviceId,
        workerId: boundWorkerId,
        claimTokenHash: "2".repeat(64),
        observedAt: at(26),
        leaseExpiresAt: at(36),
      }),
    ).resolves.toBeNull();
    await expect(
      failChannelReply(db, {
        jobId: claimed!.id,
        deviceId,
        workerId: boundWorkerId,
        claimTokenHash: "2".repeat(64),
        error: "expired claim",
        updatedAt: at(26),
      }),
    ).resolves.toBeNull();
    await expect(
      completeChannelReply(db, claimed!, {
        jobId: claimed!.id,
        deviceId,
        workerId: boundWorkerId,
        claimTokenHash: "2".repeat(64),
        body: "Expired Worker output",
        document: null,
        issueProposal: null,
        executionProposal: null,
        agentName: "Bumble",
        agentProvider: "claude",
        completedAt: at(26),
      }),
    ).resolves.toBeNull();

    await db.prepare(
      `update briar_execution_workers set state = 'disabled' where id = ?`,
    ).bind(boundWorkerId).run();
    await expect(
      getClaimedChannelReply(db, {
        jobId: claimed!.id,
        deviceId,
        workerId: boundWorkerId,
        claimTokenHash: "2".repeat(64),
        observedAt: at(16),
      }),
    ).resolves.toBeNull();
    await expect(
      renewChannelReplyLease(db, {
        jobId: claimed!.id,
        deviceId,
        workerId: boundWorkerId,
        claimTokenHash: "2".repeat(64),
        observedAt: at(16),
        leaseExpiresAt: at(27),
      }),
    ).resolves.toBeNull();
    await expect(
      completeChannelReply(db, claimed!, {
        jobId: claimed!.id,
        deviceId,
        workerId: boundWorkerId,
        claimTokenHash: "2".repeat(64),
        body: "Disabled Worker output",
        document: null,
        issueProposal: null,
        executionProposal: null,
        agentName: "Bumble",
        agentProvider: "claude",
        completedAt: at(16),
      }),
    ).resolves.toBeNull();
    await db.prepare(
      `update briar_execution_workers set state = 'online' where id = ?`,
    ).bind(boundWorkerId).run();

    await expect(
      completeChannelReply(db, claimed!, {
        jobId: claimed!.id,
        deviceId,
        workerId: boundWorkerId,
        claimTokenHash: "2".repeat(64),
        body: "I cannot target another project.",
        document: null,
        issueProposal: {
          projectId: otherProjectId,
          executeAfterCreate: false,
          issue: {
            title: "Wrong project",
            description: null,
            priority: null,
            status: "backlog",
          },
        },
        executionProposal: null,
        agentName: "Bumble",
        agentProvider: "claude",
        completedAt: at(16),
      }),
    ).rejects.toThrow("must target its claimed project");

    await db.prepare(
      `update briar_channel_agent_reply_jobs
       set claim_token_hash = ? where id = ?`,
    ).bind("9".repeat(64), claimed!.id).run();
    await expect(
      completeChannelReply(db, claimed!, {
        jobId: claimed!.id,
        deviceId,
        workerId: boundWorkerId,
        claimTokenHash: "2".repeat(64),
        body: "Stale claimant output",
        document: null,
        issueProposal: null,
        executionProposal: null,
        agentName: "Bumble",
        agentProvider: "claude",
        completedAt: at(16),
      }),
    ).resolves.toBeNull();
    await expect(
      getChannelMessage(db, channelId, claimed!.reply_message_id),
    ).resolves.toBeNull();
    await db.prepare(
      `update briar_channel_agent_reply_jobs
       set claim_token_hash = ? where id = ?`,
    ).bind("2".repeat(64), claimed!.id).run();

    const failed = await failChannelReply(db, {
      jobId: claimed!.id,
      deviceId,
      workerId: boundWorkerId,
      claimTokenHash: "2".repeat(64),
      error: "provider unavailable",
      updatedAt: at(16),
    });
    // The first failure returns the job to the queue rather than burning it.
    expect(failed).toMatchObject({
      status: "queued",
      attempts: 1,
      claimed_device_id: null,
      claimed_worker_id: null,
    });
  });

  it("reserves a project reply for a compatible preferred device, then releases preference on retry and policy fallback", async () => {
    const channelId = "e0000000-0000-4000-8000-000000000109";
    const agentId = "aa000000-0000-4000-8000-000000000109";
    const triggerId = "f0000000-0000-4000-8000-000000000109";
    const fallbackDeviceId = "c0000000-0000-4000-8000-000000000109";
    const fallbackWorkerId = "d0000000-0000-4000-8000-000000000109";
    const observedAt = new Date().toISOString();
    const leaseExpiresAt = new Date(Date.parse(observedAt) + 60_000).toISOString();
    const capabilities = JSON.stringify({
      providerHealth: { claude: { healthy: true } },
      providerCapabilities: {
        claude: {
          models: [{
            id: "claude-sonnet-local",
            label: "Claude Sonnet Local",
            efforts: [{ id: "high", label: "High" }],
          }],
          defaultEfforts: [],
          allowCustomModels: false,
          error: null,
        },
      },
    });
    // The preceding lease lifecycle test intentionally leaves its historical
    // job queued. Close that fixture so this test observes only its own job.
    await db.prepare(
      `update briar_channel_agent_reply_jobs
       set status = 'failed', completed_at = ?, updated_at = ?
       where project_id = ? and status = 'queued'`,
    ).bind(observedAt, observedAt, projectId).run();
    await createChannel(db, {
      id: channelId,
      organizationId,
      slug: "project-local-preference",
      name: "Project local preference",
      topic: null,
      visibility: "public",
      defaultProjectId: projectId,
      createdByUserId: ownerId,
      createdAt: observedAt,
    });
    await db.batch([
      db.prepare(
        `insert into briar_project_agents (
           id, organization_id, project_id, name, provider, model,
           responsibility, effort, created_at, updated_at
         ) values (?, ?, ?, 'Local Project Agent', 'claude',
                   'claude-sonnet-local', 'Use the project Worker', 'high', ?, ?)`,
      ).bind(agentId, organizationId, projectId, observedAt, observedAt),
      db.prepare(
        `insert into briar_execution_worker_devices (
           id, organization_id, owner_user_id, label, device_identity_hash,
           state, last_heartbeat_at, created_at, updated_at
         ) values (?, ?, ?, 'Fallback device', ?, 'online', ?, ?, ?)`,
      ).bind(
        fallbackDeviceId,
        organizationId,
        ownerId,
        "8".repeat(64),
        observedAt,
        observedAt,
        observedAt,
      ),
      db.prepare(
        `insert into briar_execution_worker_credentials (
           device_id, token_hash, created_at
         ) values (?, ?, ?)`,
      ).bind(fallbackDeviceId, "9".repeat(64), observedAt),
      db.prepare(
        `insert into briar_execution_workers (
           id, project_id, device_id, label, host_fingerprint,
           agent_provider, capabilities_json, state, accepting_work,
           readiness_state, last_heartbeat_at, created_at, updated_at
         ) values (?, ?, ?, 'Fallback binding', ?, 'claude', ?, 'online', 1,
                   'ready', ?, ?, ?)`,
      ).bind(
        fallbackWorkerId,
        projectId,
        fallbackDeviceId,
        "9".repeat(64),
        capabilities,
        observedAt,
        observedAt,
        observedAt,
      ),
      db.prepare(
        `update briar_execution_worker_devices
         set state = 'online', last_heartbeat_at = ?, updated_at = ?
         where id = ?`,
      ).bind(observedAt, observedAt, deviceId),
      db.prepare(
        `update briar_execution_workers
         set capabilities_json = ?, state = 'online', accepting_work = 1,
             readiness_state = 'ready', last_heartbeat_at = ?, updated_at = ?
         where id = ?`,
      ).bind(capabilities, observedAt, observedAt, boundWorkerId),
    ]);
    await addChannelAgent(db, {
      channelId,
      agentId,
      addedByUserId: ownerId,
      createdAt: observedAt,
    });
    await createChannelMessage(db, {
      id: triggerId,
      channelId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: "@Local-Project-Agent run locally",
      mentionedUserIds: [],
      mentionedAgentIds: [agentId],
      createdAt: observedAt,
    });
    const [job] = await enqueueChannelAgentReplies(db, {
      organizationId,
      channelId,
      triggerMessageId: triggerId,
      parentMessageId: triggerId,
      agents: [{ id: agentId, projectId, provider: "claude" }],
      preferredDeviceId: deviceId,
      createdAt: observedAt,
    });
    expect(job.preferred_device_id).toBe(deviceId);

    const claim = (overrides: {
      deviceId?: string;
      workerId?: string;
      claimTokenHash?: string;
    } = {}) => claimNextChannelAgentReply(db, organizationId, {
      deviceId: overrides.deviceId ?? fallbackDeviceId,
      workerId: overrides.workerId ?? fallbackWorkerId,
      providers: ["claude"],
      workerAgentProvider: "claude",
      workerCapabilitiesJson: capabilities,
      supportsOrganizationAgentContext: false,
      claimTokenHash: overrides.claimTokenHash ?? "1".repeat(64),
      claimedAt: observedAt,
      leaseExpiresAt,
    });
    await expect(claim()).resolves.toBeNull();
    const localClaim = await claim({
      deviceId,
      workerId: boundWorkerId,
      claimTokenHash: "2".repeat(64),
    });
    expect(localClaim).toMatchObject({
      id: job.id,
      claimed_device_id: deviceId,
      claimed_worker_id: boundWorkerId,
    });
    const requeued = await failChannelReply(db, {
      jobId: job.id,
      deviceId,
      workerId: boundWorkerId,
      claimTokenHash: "2".repeat(64),
      error: "local execution failed",
      updatedAt: observedAt,
    });
    expect(requeued).toMatchObject({
      status: "queued",
      preferred_device_id: null,
    });
    const retryClaim = await claim({ claimTokenHash: "3".repeat(64) });
    expect(retryClaim).toMatchObject({
      id: job.id,
      claimed_device_id: fallbackDeviceId,
    });
    await completeChannelReply(db, retryClaim!, {
      jobId: retryClaim!.id,
      deviceId: fallbackDeviceId,
      workerId: fallbackWorkerId,
      claimTokenHash: "3".repeat(64),
      body: "Fallback completed the retry.",
      document: null,
      issueProposal: null,
      executionProposal: null,
      agentName: "Local Project Agent",
      agentProvider: "claude",
      completedAt: observedAt,
    });

    const policyTriggerId = "f0000000-0000-4000-8000-000000000110";
    await createChannelMessage(db, {
      id: policyTriggerId,
      channelId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: "@Local-Project-Agent obey the allowlist",
      mentionedUserIds: [],
      mentionedAgentIds: [agentId],
      createdAt: observedAt,
    });
    const [policyJob] = await enqueueChannelAgentReplies(db, {
      organizationId,
      channelId,
      triggerMessageId: policyTriggerId,
      parentMessageId: policyTriggerId,
      agents: [{ id: agentId, projectId, provider: "claude" }],
      preferredDeviceId: deviceId,
      createdAt: observedAt,
    });
    await db.batch([
      db.prepare(
        `insert into briar_project_execution_worker_policies (
           project_id, selection_mode, created_at, updated_at
         ) values (?, 'allowlist', ?, ?)
         on conflict (project_id) do update set selection_mode = 'allowlist'`,
      ).bind(projectId, observedAt, observedAt),
      db.prepare(
        `insert into briar_project_execution_worker_allowlist (
           project_id, worker_id, created_at
         ) values (?, ?, ?)`,
      ).bind(projectId, fallbackWorkerId, observedAt),
    ]);
    const policyClaim = await claim({ claimTokenHash: "4".repeat(64) });
    expect(policyClaim).toMatchObject({
      id: policyJob.id,
      claimed_device_id: fallbackDeviceId,
    });
    await completeChannelReply(db, policyClaim!, {
      jobId: policyClaim!.id,
      deviceId: fallbackDeviceId,
      workerId: fallbackWorkerId,
      claimTokenHash: "4".repeat(64),
      body: "The allowlisted Worker handled this reply.",
      document: null,
      issueProposal: null,
      executionProposal: null,
      agentName: "Local Project Agent",
      agentProvider: "claude",
      completedAt: observedAt,
    });
    await db.batch([
      db.prepare(
        `delete from briar_project_execution_worker_allowlist
         where project_id = ? and worker_id = ?`,
      ).bind(projectId, fallbackWorkerId),
      db.prepare(
        `delete from briar_project_execution_worker_policies where project_id = ?`,
      ).bind(projectId),
    ]);
  });

  it("skips a provider the claiming device cannot run", async () => {
    const channelId = "e0000000-0000-4000-8000-000000000006";
    await createChannel(db, {
      id: channelId,
      organizationId,
      slug: "codex-room",
      name: "Codex room",
      topic: null,
      visibility: "public",
      defaultProjectId: null,
      createdByUserId: ownerId,
      createdAt: at(17),
    });
    const agent = await createOrganizationAgent(db, {
      id: "aa000000-0000-4000-8000-000000000003",
      organizationId,
      name: "Fizz",
      provider: "codex",
      model: null,
      responsibility: "Coordination",
      effort: null,
      createdAt: at(17),
    });
    await addChannelAgent(db, {
      channelId,
      agentId: agent!.id,
      addedByUserId: ownerId,
      createdAt: at(17),
    });
    const triggerId = "f0000000-0000-4000-8000-000000000006";
    await createChannelMessage(db, {
      id: triggerId,
      channelId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: "@fizz hello",
      mentionedUserIds: [],
      mentionedAgentIds: [agent!.id],
      createdAt: at(18),
    });
    const jobs = await enqueueChannelAgentReplies(db, {
      organizationId,
      channelId,
      triggerMessageId: triggerId,
      parentMessageId: triggerId,
      agents: [{ id: agent!.id, projectId: null, provider: "codex" }],
      createdAt: at(18),
    });
    expect(jobs).toHaveLength(1);

    expect(
      await claimNextChannelAgentReply(db, organizationId, {
        deviceId,
        workerId: otherWorkerId,
        providers: ["grok"],
        supportsOrganizationAgentContext: true,
        claimTokenHash: "3".repeat(64),
        claimedAt: at(19),
        leaseExpiresAt: at(29),
      }),
    ).toBeNull();
  });

  it("falls back immediately when the preferred device lacks organization Agent context support", async () => {
    const channelId = "e0000000-0000-4000-8000-000000000111";
    const agentId = "aa000000-0000-4000-8000-000000000111";
    const triggerId = "f0000000-0000-4000-8000-000000000111";
    const fallbackDeviceId = "c0000000-0000-4000-8000-000000000111";
    const fallbackWorkerId = "d0000000-0000-4000-8000-000000000111";
    const observedAt = new Date().toISOString();
    const capabilities = JSON.stringify({
      providerHealth: { claude: { healthy: true } },
      organizationAgentContext: { protocol: 1 },
    });
    await createChannel(db, {
      id: channelId,
      organizationId,
      slug: "organization-context-fallback",
      name: "Organization context fallback",
      topic: null,
      visibility: "public",
      defaultProjectId: null,
      createdByUserId: ownerId,
      createdAt: observedAt,
    });
    await createOrganizationAgent(db, {
      id: agentId,
      organizationId,
      name: "Organization Fallback",
      provider: "claude",
      model: null,
      responsibility: "Use organization context",
      effort: null,
      createdAt: observedAt,
    });
    await addChannelAgent(db, {
      channelId,
      agentId,
      addedByUserId: ownerId,
      createdAt: observedAt,
    });
    await db.batch([
      db.prepare(
        `update briar_execution_worker_devices
         set state = 'online', last_heartbeat_at = ?, updated_at = ? where id = ?`,
      ).bind(observedAt, observedAt, deviceId),
      db.prepare(
        `update briar_execution_workers
         set state = 'online', accepting_work = 1, readiness_state = 'ready',
             capabilities_json = ?, last_heartbeat_at = ?, updated_at = ?
         where id = ?`,
      ).bind(
        JSON.stringify({ providerHealth: { claude: { healthy: true } } }),
        observedAt,
        observedAt,
        otherWorkerId,
      ),
      db.prepare(
        `insert into briar_execution_worker_devices (
           id, organization_id, owner_user_id, label, device_identity_hash,
           state, last_heartbeat_at, created_at, updated_at
         ) values (?, ?, ?, 'Organization fallback', ?, 'online', ?, ?, ?)`,
      ).bind(
        fallbackDeviceId,
        organizationId,
        ownerId,
        "a1".repeat(32),
        observedAt,
        observedAt,
        observedAt,
      ),
      db.prepare(
        `insert into briar_execution_worker_credentials (
           device_id, token_hash, created_at
         ) values (?, ?, ?)`,
      ).bind(fallbackDeviceId, "b1".repeat(32), observedAt),
      db.prepare(
        `insert into briar_execution_workers (
           id, project_id, device_id, label, host_fingerprint,
           agent_provider, capabilities_json, state, accepting_work,
           readiness_state, last_heartbeat_at, created_at, updated_at
         ) values (?, ?, ?, 'Organization fallback binding', ?, 'claude', ?,
                   'online', 1, 'ready', ?, ?, ?)`,
      ).bind(
        fallbackWorkerId,
        otherProjectId,
        fallbackDeviceId,
        "c1".repeat(32),
        capabilities,
        observedAt,
        observedAt,
        observedAt,
      ),
    ]);
    await createChannelMessage(db, {
      id: triggerId,
      channelId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: "@Organization-Fallback answer",
      mentionedUserIds: [],
      mentionedAgentIds: [agentId],
      createdAt: observedAt,
    });
    const [job] = await enqueueChannelAgentReplies(db, {
      organizationId,
      channelId,
      triggerMessageId: triggerId,
      parentMessageId: triggerId,
      agents: [{ id: agentId, projectId: null, provider: "claude" }],
      preferredDeviceId: deviceId,
      createdAt: observedAt,
    });
    const claimed = await claimNextChannelAgentReply(db, organizationId, {
      deviceId: fallbackDeviceId,
      workerId: fallbackWorkerId,
      providers: ["claude"],
      workerAgentProvider: "claude",
      workerCapabilitiesJson: capabilities,
      supportsOrganizationAgentContext: true,
      claimTokenHash: "5".repeat(64),
      claimedAt: observedAt,
      leaseExpiresAt: new Date(Date.parse(observedAt) + 60_000).toISOString(),
    });
    expect(claimed).toMatchObject({
      id: job.id,
      preferred_device_id: deviceId,
      claimed_device_id: fallbackDeviceId,
    });
    await completeChannelReply(db, claimed!, {
      jobId: claimed!.id,
      deviceId: fallbackDeviceId,
      workerId: fallbackWorkerId,
      claimTokenHash: "5".repeat(64),
      body: "Organization fallback completed.",
      document: null,
      issueProposal: null,
      executionProposal: null,
      agentName: "Organization Fallback",
      agentProvider: "claude",
      completedAt: observedAt,
    });
  });

  it("gives every mentioned Agent its own reply job", async () => {
    const channelId = "e0000000-0000-4000-8000-000000000007";
    await createChannel(db, {
      id: channelId,
      organizationId,
      slug: "intro",
      name: "Intro",
      topic: null,
      visibility: "public",
      defaultProjectId: null,
      createdByUserId: ownerId,
      createdAt: at(20),
    });
    const first = await createOrganizationAgent(db, {
      id: "aa000000-0000-4000-8000-000000000004",
      organizationId,
      name: "Nectar",
      provider: "claude",
      model: null,
      responsibility: "Writing",
      effort: null,
      createdAt: at(20),
    });
    const second = await createOrganizationAgent(db, {
      id: "aa000000-0000-4000-8000-000000000005",
      organizationId,
      name: "Pollen",
      provider: "claude",
      model: null,
      responsibility: "Research",
      effort: null,
      createdAt: at(20),
    });
    await addChannelAgent(db, {
      channelId,
      agentId: first!.id,
      addedByUserId: ownerId,
      createdAt: at(20),
    });
    await addChannelAgent(db, {
      channelId,
      agentId: second!.id,
      addedByUserId: ownerId,
      createdAt: at(20),
    });
    const triggerId = "f0000000-0000-4000-8000-000000000007";
    await createChannelMessage(db, {
      id: triggerId,
      channelId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: "@nectar and @pollen introduce yourselves",
      mentionedUserIds: [],
      mentionedAgentIds: [first!.id, second!.id],
      createdAt: at(21),
    });
    const jobs = await enqueueChannelAgentReplies(db, {
      organizationId,
      channelId,
      triggerMessageId: triggerId,
      parentMessageId: triggerId,
      agents: [
        { id: first!.id, projectId: null, provider: "claude" },
        { id: second!.id, projectId: null, provider: "claude" },
      ],
      createdAt: at(21),
    });
    expect(jobs.map((job) => job.agent_id).sort()).toEqual(
      [first!.id, second!.id].sort(),
    );

    // Re-sending the same trigger must not duplicate work.
    const again = await enqueueChannelAgentReplies(db, {
      organizationId,
      channelId,
      triggerMessageId: triggerId,
      parentMessageId: triggerId,
      agents: [{ id: first!.id, projectId: null, provider: "claude" }],
      createdAt: at(22),
    });
    expect(again).toHaveLength(2);
  });

  it("creates idempotent direct messages and implicitly invokes a sole Agent", async () => {
    const agentId = "aa000000-0000-4000-8000-000000000120";
    await createOrganizationAgent(db, {
      id: agentId,
      organizationId,
      name: "Direct Falcon",
      provider: "claude",
      model: null,
      responsibility: "Reply to direct messages",
      effort: null,
      skills: [{
        id: "ab000000-0000-4000-8000-000000000120",
        name: "Direct response",
        description: "Use for direct questions that need a concise answer.",
        body: "Reply concisely.",
        provider: "claude",
        model: null,
        effort: null,
        kind: "custom",
        position: 0,
      }],
      createdAt: at(20),
    });
    const apiEnv = {
      DB: db,
      ARCHIVES: archives,
      BETTER_AUTH_SECRET: "channels-context-test-secret-channels-context-test",
      GOOGLE_CLIENT_ID: "google-client-test",
      GOOGLE_CLIENT_SECRET: "google-secret-test",
    } as unknown as Env;
    const directMessagesEndpoint =
      `https://briar-api.example/organizations/${organizationId}/dms`;
    const createRequest = () => new Request(directMessagesEndpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${ownerSessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ memberIds: [], agentIds: [agentId.toUpperCase()] }),
    });

    const created = await apiWorker.fetch(createRequest(), apiEnv);
    expect(created.status).toBe(201);
    const createdBody = await created.json() as {
      channel: {
        id: string;
        kind: string;
        visibility: string;
        dmParticipants: Array<{ type: string; id: string; name: string }>;
      };
    };
    expect(createdBody.channel).toMatchObject({
      kind: "dm",
      visibility: "private",
    });
    expect(createdBody.channel.dmParticipants).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "user", id: ownerId }),
      expect.objectContaining({ type: "agent", id: agentId, name: "Direct Falcon" }),
    ]));

    const repeated = await apiWorker.fetch(createRequest(), apiEnv);
    expect(repeated.status).toBe(200);
    expect((await repeated.json() as { channel: { id: string } }).channel.id)
      .toBe(createdBody.channel.id);

    const message = await apiWorker.fetch(new Request(
      `${directMessagesEndpoint.replace(/\/dms$/u, "")}/channels/${createdBody.channel.id}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${ownerSessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ body: "Direct response without a mention" }),
      },
    ), apiEnv);
    expect(message.status).toBe(201);
    const messageBody = await message.json() as {
      message: { mentionedAgentIds: string[] };
      agentReplies: Array<{ id: string; agentId: string }>;
    };
    expect(messageBody.message.mentionedAgentIds).toEqual([]);
    expect(messageBody.agentReplies).toHaveLength(1);
    expect(messageBody.agentReplies[0]?.agentId).toBe(agentId);
    await expect(getChannelAgentReplyJob(
      db,
      organizationId,
      messageBody.agentReplies[0]!.id,
    )).resolves.toMatchObject({ skill_id: null, agent_provider: "claude" });

    const selectedSkillMessage = await apiWorker.fetch(new Request(
      `${directMessagesEndpoint.replace(/\/dms$/u, "")}/channels/${createdBody.channel.id}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${ownerSessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          body: "/Direct response Summarize the update",
          skillId: "ab000000-0000-4000-8000-000000000120",
        }),
      },
    ), apiEnv);
    expect(selectedSkillMessage.status).toBe(201);
    const selectedSkillBody = await selectedSkillMessage.json() as {
      message: { mentionedAgentIds: string[] };
      agentReplies: Array<{ id: string; agentId: string }>;
    };
    expect(selectedSkillBody.message.mentionedAgentIds).toEqual([]);
    expect(selectedSkillBody.agentReplies).toHaveLength(1);
    await expect(getChannelAgentReplyJob(
      db,
      organizationId,
      selectedSkillBody.agentReplies[0]!.id,
    )).resolves.toMatchObject({
      skill_id: "ab000000-0000-4000-8000-000000000120",
      selected_skill_id_snapshot: "ab000000-0000-4000-8000-000000000120",
      agent_provider: "claude",
      selected_skill_name_snapshot: "Direct response",
      skill_execution_request_snapshot:
        "/Direct response Summarize the update",
    });

    const unknownSkillMessage = await apiWorker.fetch(new Request(
      `${directMessagesEndpoint.replace(/\/dms$/u, "")}/channels/${createdBody.channel.id}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${ownerSessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          body: "/Unknown skill Try this",
          skillId: "ab000000-0000-4000-8000-000000000999",
        }),
      },
    ), apiEnv);
    expect(unknownSkillMessage.status).toBe(400);

    const expanded = await apiWorker.fetch(new Request(
      `${directMessagesEndpoint.replace(/\/dms$/u, "")}/channels/${createdBody.channel.id}/members/${outsiderId}`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${ownerSessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ role: "member" }),
      },
    ), apiEnv);
    expect(expanded.status).toBe(200);
    const recreatedDirect = await apiWorker.fetch(createRequest(), apiEnv);
    expect(recreatedDirect.status).toBe(201);
    expect(
      (await recreatedDirect.json() as { channel: { id: string } }).channel.id,
    ).not.toBe(createdBody.channel.id);

    const group = await apiWorker.fetch(new Request(directMessagesEndpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${ownerSessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ memberIds: [outsiderId], agentIds: [agentId] }),
    }), apiEnv);
    expect(group.status).toBe(201);
    const groupId = (await group.json() as { channel: { id: string } }).channel.id;
    const groupMessage = await apiWorker.fetch(new Request(
      `${directMessagesEndpoint.replace(/\/dms$/u, "")}/channels/${groupId}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${ownerSessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ body: "Hello group" }),
      },
    ), apiEnv);
    expect(groupMessage.status).toBe(201);
    expect((await groupMessage.json() as { agentReplies: unknown[] }).agentReplies)
      .toEqual([]);

    const mentionedMessage = await apiWorker.fetch(new Request(
      `${directMessagesEndpoint.replace(/\/dms$/u, "")}/channels/${groupId}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${ownerSessionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          body: "Please use Direct response here",
          mentionedAgentIds: [agentId],
        }),
      },
    ), apiEnv);
    expect(mentionedMessage.status).toBe(201);
    const mentionedBody = await mentionedMessage.json() as {
      agentReplies: Array<{ id: string; agentId: string }>;
    };
    expect(mentionedBody.agentReplies).toHaveLength(1);
    await expect(getChannelAgentReplyJob(
      db,
      organizationId,
      mentionedBody.agentReplies[0]!.id,
    )).resolves.toMatchObject({ skill_id: null, agent_provider: "claude" });
  });

  it("accepts only the sender's organization device and copies it to every mentioned Agent job", async () => {
    const channelId = "e0000000-0000-4000-8000-000000000107";
    const firstAgentId = "aa000000-0000-4000-8000-000000000107";
    const secondAgentId = "aa000000-0000-4000-8000-000000000108";
    const outsiderDeviceId = "c0000000-0000-4000-8000-000000000107";
    const observedAt = new Date().toISOString();
    await createChannel(db, {
      id: channelId,
      organizationId,
      slug: "preferred-device-api",
      name: "Preferred device API",
      topic: null,
      visibility: "public",
      defaultProjectId: null,
      createdByUserId: ownerId,
      createdAt: observedAt,
    });
    for (const [id, name] of [
      [firstAgentId, "Local One"],
      [secondAgentId, "Local Two"],
    ]) {
      await createOrganizationAgent(db, {
        id,
        organizationId,
        name,
        provider: "claude",
        model: null,
        responsibility: "Reply locally",
        effort: null,
        createdAt: observedAt,
      });
      await addChannelAgent(db, {
        channelId,
        agentId: id,
        addedByUserId: ownerId,
        createdAt: observedAt,
      });
    }
    await db.batch([
      db.prepare(
        `update briar_execution_worker_devices
         set state = 'online', last_heartbeat_at = ?, updated_at = ?
         where id = ?`,
      ).bind(observedAt, observedAt, deviceId),
      db.prepare(
        `update briar_execution_workers
         set state = 'online', accepting_work = 1, readiness_state = 'ready',
             capabilities_json = ?, last_heartbeat_at = ?, updated_at = ?
         where id = ?`,
      ).bind(
        JSON.stringify({
          providerHealth: { claude: { healthy: true } },
          organizationAgentContext: { protocol: 1 },
        }),
        observedAt,
        observedAt,
        otherWorkerId,
      ),
      db.prepare(
        `insert into briar_execution_worker_devices (
           id, organization_id, owner_user_id, label, device_identity_hash,
           state, last_heartbeat_at, created_at, updated_at
         ) values (?, ?, ?, 'Outsider device', ?, 'online', ?, ?, ?)`,
      ).bind(
        outsiderDeviceId,
        organizationId,
        outsiderId,
        "7".repeat(64),
        observedAt,
        observedAt,
        observedAt,
      ),
    ]);
    const apiEnv = {
      DB: db,
      ARCHIVES: archives,
      BETTER_AUTH_SECRET: "channels-context-test-secret-channels-context-test",
      GOOGLE_CLIENT_ID: "google-client-test",
      GOOGLE_CLIENT_SECRET: "google-secret-test",
    } as unknown as Env;
    const endpoint =
      `https://briar-api.example/organizations/${organizationId}/channels/${channelId}/messages`;
    const accepted = await apiWorker.fetch(new Request(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${ownerSessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        body: "@Local-One @Local-Two answer",
        mentionedAgentIds: [
          firstAgentId.toUpperCase(),
          secondAgentId.toUpperCase(),
        ],
        preferredDeviceId: deviceId,
      }),
    }), apiEnv);
    expect(accepted.status).toBe(201);
    const acceptedBody = await accepted.json() as {
      message: { id: string };
      agentReplies: Array<{ id: string }>;
    };
    expect(acceptedBody.agentReplies).toHaveLength(2);
    const stored = await db.prepare(
      `select agent_id, preferred_device_id
       from briar_channel_agent_reply_jobs where trigger_message_id = ?
       order by agent_id`,
    ).bind(acceptedBody.message.id).all<{
      agent_id: string;
      preferred_device_id: string | null;
    }>();
    expect(stored.results).toEqual([
      { agent_id: firstAgentId, preferred_device_id: deviceId },
      { agent_id: secondAgentId, preferred_device_id: deviceId },
    ]);

    const rejected = await apiWorker.fetch(new Request(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${ownerSessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        body: "Do not accept this preference",
        preferredDeviceId: outsiderDeviceId,
      }),
    }), apiEnv);
    expect(rejected.status).toBe(403);
  });

  it("persists an unavailable Worker as an immediate failed reply", async () => {
    const channelId = "e0000000-0000-4000-8000-000000000099";
    const triggerId = "f0000000-0000-4000-8000-000000000099";
    const agent = await createOrganizationAgent(db, {
      id: "aa000000-0000-4000-8000-000000000099",
      organizationId,
      name: "Unavailable",
      provider: "claude",
      model: null,
      responsibility: "Reply when a Worker is online",
      effort: null,
      createdAt: at(40),
    });
    await createChannel(db, {
      id: channelId,
      organizationId,
      slug: "unavailable-worker",
      name: "Unavailable Worker",
      topic: null,
      visibility: "public",
      defaultProjectId: null,
      createdByUserId: ownerId,
      createdAt: at(40),
    });
    await addChannelAgent(db, {
      channelId,
      agentId: agent!.id,
      addedByUserId: ownerId,
      createdAt: at(40),
    });
    await createChannelMessage(db, {
      id: triggerId,
      channelId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: "@unavailable help",
      mentionedUserIds: [],
      mentionedAgentIds: [agent!.id],
      createdAt: at(41),
    });

    const [reply] = await enqueueChannelAgentReplies(db, {
      organizationId,
      channelId,
      triggerMessageId: triggerId,
      parentMessageId: triggerId,
      agents: [{
        id: agent!.id,
        projectId: null,
        provider: "claude",
        unavailableReason: channelReplyNoAvailableWorkerError,
      }],
      createdAt: at(41),
    });

    expect(reply).toMatchObject({
      status: "failed",
      attempts: 0,
      error: channelReplyNoAvailableWorkerError,
      completed_at: at(41),
    });
  });

  it("excludes changes in channels the member cannot see from the delta", async () => {
    const hiddenId = "e0000000-0000-4000-8000-000000000008";
    await createChannel(db, {
      id: hiddenId,
      organizationId,
      slug: "leadership",
      name: "Leadership",
      topic: null,
      visibility: "private",
      defaultProjectId: null,
      createdByUserId: ownerId,
      createdAt: at(25),
    });
    const before = await loadChannelDelta(db, organizationId, outsiderId, 0);
    await createChannelMessage(db, {
      id: "f0000000-0000-4000-8000-000000000008",
      channelId: hiddenId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: "Confidential",
      mentionedUserIds: [],
      mentionedAgentIds: [],
      createdAt: at(26),
    });

    const outsiderDelta = await loadChannelDelta(
      db,
      organizationId,
      outsiderId,
      before.cursor,
    );
    expect(outsiderDelta.messages).toHaveLength(0);
    expect(outsiderDelta.channels.map((channel) => channel.id)).not.toContain(
      hiddenId,
    );
    // The cursor still advances so the member does not re-read the same rows.
    expect(outsiderDelta.cursor).toBeGreaterThan(before.cursor);

    const ownerDelta = await loadChannelDelta(
      db,
      organizationId,
      ownerId,
      before.cursor,
    );
    expect(ownerDelta.messages.map((message) => message.body)).toContain(
      "Confidential",
    );
  });

  it("keeps roster and channel reads scoped to their organization", async () => {
    expect(await getChannelById(db, otherOrganizationId, "e0000000-0000-4000-8000-000000000002")).toBeNull();
    const agents = await listChannelAgents(
      db,
      "e0000000-0000-4000-8000-000000000004",
    );
    expect(agents.map((agent) => agent.name)).toEqual(["Honey"]);
  });

  it("toggles emoji reactions and refreshes them through channel deltas", async () => {
    const channelId = "e0000000-0000-4000-8000-0000000000a1";
    const messageId = "f0000000-0000-4000-8000-0000000000a1";
    await createChannel(db, {
      id: channelId,
      organizationId,
      slug: "reactions",
      name: "Reactions",
      topic: null,
      visibility: "public",
      defaultProjectId: null,
      createdByUserId: ownerId,
      createdAt: at(50),
    });
    await createChannelMessage(db, {
      id: messageId,
      channelId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: "React to this",
      mentionedUserIds: [],
      mentionedAgentIds: [],
      createdAt: at(51),
    });
    const before = await getChannelSyncCursor(db, organizationId);

    const added = await toggleChannelMessageReaction(db, {
      channelId,
      messageId,
      userId: ownerId,
      emoji: "👍",
      createdAt: at(52),
    });
    expect(added?.reactions).toEqual([
      { emoji: "👍", count: 1, userIds: [ownerId] },
    ]);

    const second = await toggleChannelMessageReaction(db, {
      channelId,
      messageId,
      userId: outsiderId,
      emoji: "👍",
      createdAt: at(53),
    });
    expect(second?.reactions[0]?.count).toBe(2);
    expect(second?.reactions[0]?.userIds).toEqual(
      expect.arrayContaining([ownerId, outsiderId]),
    );

    const heart = await toggleChannelMessageReaction(db, {
      channelId,
      messageId,
      userId: ownerId,
      emoji: "❤️",
      createdAt: at(54),
    });
    expect(heart?.reactions.map((reaction) => reaction.emoji)).toEqual([
      "👍",
      "❤️",
    ]);

    const removed = await toggleChannelMessageReaction(db, {
      channelId,
      messageId,
      userId: ownerId,
      emoji: "👍",
      createdAt: at(55),
    });
    expect(removed?.reactions).toEqual([
      { emoji: "👍", count: 1, userIds: [outsiderId] },
      { emoji: "❤️", count: 1, userIds: [ownerId] },
    ]);

    const listed = await listChannelRootMessages(db, channelId);
    expect(listed[0]?.reactions).toEqual(removed?.reactions);

    const delta = await loadChannelDelta(db, organizationId, ownerId, before);
    expect(delta.messages.some((message) => message.id === messageId)).toBe(
      true,
    );
    const deltaMessage = delta.messages.find(
      (message) => message.id === messageId,
    );
    expect(deltaMessage?.reactions).toEqual(removed?.reactions);
  });
});
