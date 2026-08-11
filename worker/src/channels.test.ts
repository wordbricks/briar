import { createHash } from "node:crypto";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { channelReplyClaimTokenHeader } from "../../src/lib/channels-contract";
import apiWorker from "./index";
import {
  addChannelAgent,
  addChannelMember,
  claimNextChannelAgentReply,
  completeChannelReply,
  createChannel,
  createChannelMessage,
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
  getChannelSyncCursor,
  listChannelAgents,
  listChannelRootMessages,
  listChannelThreadMessages,
  listChannels,
  loadChannelDelta,
  renewChannelReplyLease,
  toggleChannelMessageReaction,
} from "./channels";
import { processArchiveCleanupQueue } from "./archive";
import {
  createOrganizationAgent,
  listOrganizationAgents,
} from "./organization-agents";
import { applyD1Migrations } from "./test-helpers/d1";

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
const sha256Hex = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const at = (minute: number) =>
  new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();

describe("organization channels", () => {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: "briar-channels-test" },
    r2Buckets: ["ARCHIVES"],
  });
  let db: D1Database;
  let archives: R2Bucket;

  beforeAll(async () => {
    db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
    archives = await miniflare.getR2Bucket("ARCHIVES") as unknown as R2Bucket;
    // Channel work spans migrations that rebuild tables, so this suite applies
    // the full migration directory instead of replaying a subset.
    await applyD1Migrations(db);

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

  it("lets any organization device claim an organization Agent reply", async () => {
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
      responsibility: "Writing partner",
      effort: null,
      skills: [
        {
          id: "ab000000-0000-4000-8000-000000000001",
          name: "Writing",
          instructions: "Write concise channel responses.",
          provider: "claude",
          model: null,
          effort: null,
          kind: "custom",
          position: 0,
        },
        {
          id: "ab000000-0000-4000-8000-000000000002",
          name: "Product planning",
          instructions: "Create implementation plans.",
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
    expect(agent).toMatchObject({ handle: "honey", project_id: null });
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
      body: "@honey write the plan",
      mentionedUserIds: [],
      mentionedAgentIds: [agent!.id],
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
        snapshot: { projectTargets: Array<{ id: string; name: string }> };
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
           id, organization_id, project_id, handle, name, avatar, provider,
           responsibility, created_at, updated_at
         ) values (?, ?, ?, 'bumble', 'Bumble', ?, 'claude', 'Research', ?, ?)`,
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

  it("gives handles a numeric suffix instead of colliding", async () => {
    const duplicate = await createOrganizationAgent(db, {
      id: "aa000000-0000-4000-8000-000000000006",
      organizationId,
      name: "Honey",
      provider: "claude",
      model: null,
      responsibility: "Second writer",
      effort: null,
      createdAt: at(23),
    });
    expect(duplicate?.handle).toBe("honey-2");

    // The same handle is free again in a different organization.
    const elsewhere = await createOrganizationAgent(db, {
      id: "aa000000-0000-4000-8000-000000000007",
      organizationId: otherOrganizationId,
      name: "Honey",
      provider: "claude",
      model: null,
      responsibility: "Writer",
      effort: null,
      createdAt: at(23),
    });
    expect(elsewhere?.handle).toBe("honey");
    expect(
      (await listOrganizationAgents(db, otherOrganizationId)).map(
        (row) => row.id,
      ),
    ).toEqual([elsewhere!.id]);
  });

  it("rechecks truncated suffixes for 60 to 63 character handles", async () => {
    let sequence = 30;
    for (const [offset, length] of [60, 61, 62, 63].entries()) {
      const character = String.fromCharCode("a".charCodeAt(0) + offset);
      const desired = character.repeat(length);
      const agents: Awaited<ReturnType<typeof createOrganizationAgent>>[] = [];
      for (let index = 0; index < 3; index += 1) {
        sequence += 1;
        agents.push(await createOrganizationAgent(db, {
          id: `aa000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
          organizationId,
          name: desired,
          handle: desired,
          provider: "claude",
          model: null,
          responsibility: `Long handle ${length}-${index + 1}`,
          effort: null,
          createdAt: at(23),
        }));
      }

      expect(agents.map((agent) => agent?.handle)).toEqual([
        desired,
        `${character.repeat(Math.min(length, 61))}-2`,
        `${character.repeat(Math.min(length, 61))}-3`,
      ]);
    }
  }, 30_000);

  it("recovers when concurrent agents initially select the same handle", async () => {
    const agents = await Promise.all([
      createOrganizationAgent(db, {
        id: "aa000000-0000-4000-8000-000000000050",
        organizationId,
        name: "Concurrent Honey",
        provider: "claude",
        model: null,
        responsibility: "Concurrent writer one",
        effort: null,
        createdAt: at(23),
      }),
      createOrganizationAgent(db, {
        id: "aa000000-0000-4000-8000-000000000051",
        organizationId,
        name: "Concurrent Honey",
        provider: "claude",
        model: null,
        responsibility: "Concurrent writer two",
        effort: null,
        createdAt: at(23),
      }),
    ]);

    expect(agents.map((agent) => agent?.handle).sort()).toEqual([
      "concurrent-honey",
      "concurrent-honey-2",
    ]);
  });

  it("falls back to an id-derived handle when a name has no handle characters", async () => {
    const agent = await createOrganizationAgent(db, {
      id: "aa000000-0000-4000-8000-000000000008",
      organizationId,
      name: "꿀벌",
      provider: "claude",
      model: null,
      responsibility: "한국어 이름",
      effort: null,
      createdAt: at(24),
    });
    expect(agent?.handle).toBe("agent-aa000000000040008000000000000008");
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
    expect(agents.map((agent) => agent.handle)).toEqual(["honey"]);
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
