import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addChannelAgent,
  addChannelMember,
  claimNextChannelAgentReply,
  completeChannelReply,
  createChannel,
  createChannelMessage,
  enqueueChannelAgentReplies,
  failChannelReply,
  getChannelById,
  getChannelMessage,
  getChannelMessageAttachment,
  listChannelAgents,
  listChannelRootMessages,
  listChannelThreadMessages,
  listChannels,
  loadChannelDelta,
} from "./channels";
import {
  createOrganizationAgent,
  listOrganizationAgents,
} from "./organization-agents";

const organizationId = "a0000000-0000-4000-8000-000000000001";
const otherOrganizationId = "a0000000-0000-4000-8000-000000000002";
const projectId = "b0000000-0000-4000-8000-000000000001";
const deviceId = "c0000000-0000-4000-8000-000000000001";
const boundWorkerId = "d0000000-0000-4000-8000-000000000001";
const ownerId = "owner";
const outsiderId = "outsider";
const at = (minute: number) =>
  new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();

/**
 * Channel work spans migrations that rebuild tables, so this suite applies the
 * full migration directory to its own database instead of replaying a subset.
 */
const splitStatements = (sql: string) => {
  const statements: string[] = [];
  let buffer: string[] = [];
  let inTrigger = false;
  for (const line of sql.split("\n")) {
    const trimmed = line.trim();
    buffer.push(line);
    if (/^create\s+trigger/iu.test(trimmed)) inTrigger = true;
    if (inTrigger) {
      if (/^END;/iu.test(trimmed)) {
        statements.push(buffer.join("\n"));
        buffer = [];
        inTrigger = false;
      }
      continue;
    }
    if (trimmed.endsWith(";")) {
      statements.push(buffer.join("\n"));
      buffer = [];
    }
  }
  if (buffer.join("").trim()) statements.push(buffer.join("\n"));
  return statements
    .map((statement) =>
      statement
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim()
        .replace(/;$/u, ""),
    )
    .filter((statement) => statement.length > 0);
};

describe("organization channels", () => {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: "briar-channels-test" },
  });
  let db: D1Database;

  beforeAll(async () => {
    db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
    const files = (await readdir(resolve("migrations")))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const file of files) {
      for (const statement of splitStatements(
        await readFile(resolve("migrations", file), "utf8"),
      )) {
        await db.prepare(statement).run();
      }
    }

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
      mentionedUserIds: [outsiderId],
    });
    expect(roots[0]?.author).toMatchObject({ type: "user", id: ownerId });

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
      createdAt: at(8),
    });
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
      agents: [{ id: agent!.id, projectId: null, provider: "claude" }],
      createdAt: at(9),
    });
    expect(jobs).toHaveLength(1);

    // No project binding exists yet: an organization Agent still runs.
    const claimed = await claimNextChannelAgentReply(db, organizationId, {
      deviceId,
      providers: ["claude"],
      claimTokenHash: "1".repeat(64),
      claimedAt: at(10),
      leaseExpiresAt: at(20),
    });
    expect(claimed).toMatchObject({
      agent_id: agent!.id,
      project_id: null,
      status: "running",
    });

    const completed = await completeChannelReply(db, claimed!, {
      jobId: claimed!.id,
      claimTokenHash: "1".repeat(64),
      body: "Here is the plan.",
      document: {
        title: "Onboarding plan",
        markdown: "# Onboarding\n\nSteps.",
        projectId: null,
      },
      issueProposal: {
        projectId,
        issue: {
          title: "Build onboarding",
          description: null,
          priority: null,
          status: "backlog",
        },
      },
      agentName: "Honey",
      agentProvider: "claude",
      completedAt: at(11),
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
           id, organization_id, project_id, handle, name, provider,
           responsibility, created_at, updated_at
         ) values (?, ?, ?, 'bumble', 'Bumble', 'claude', 'Research', ?, ?)`,
      )
      .bind(agentId, organizationId, projectId, at(12), at(12))
      .run();
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
        providers: ["claude"],
        claimTokenHash: "2".repeat(64),
        claimedAt: at(14),
        leaseExpiresAt: at(24),
      }),
    ).toBeNull();

    await bindWorkerToProject();
    const claimed = await claimNextChannelAgentReply(db, organizationId, {
      deviceId,
      providers: ["claude"],
      claimTokenHash: "2".repeat(64),
      claimedAt: at(15),
      leaseExpiresAt: at(25),
    });
    expect(claimed).toMatchObject({ agent_id: agentId, project_id: projectId });

    const failed = await failChannelReply(db, {
      jobId: claimed!.id,
      claimTokenHash: "2".repeat(64),
      error: "provider unavailable",
      updatedAt: at(16),
    });
    // The first failure returns the job to the queue rather than burning it.
    expect(failed).toMatchObject({ status: "queued", attempts: 1 });
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
    await enqueueChannelAgentReplies(db, {
      organizationId,
      channelId,
      triggerMessageId: triggerId,
      parentMessageId: triggerId,
      agents: [{ id: agent!.id, projectId: null, provider: "codex" }],
      createdAt: at(18),
    });

    expect(
      await claimNextChannelAgentReply(db, organizationId, {
        deviceId,
        providers: ["grok"],
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
});
