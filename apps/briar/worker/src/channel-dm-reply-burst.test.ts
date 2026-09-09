import { resolveDmReplyRouting } from "./dm-reply-routing";
import { listDmPublicMessagesForReply, getDmPublicMessageClaim } from "./dm-public-message-repository";
import { dmReplySteerStatements } from "./dm-reply-steer";
import { isDmReplyStop } from "./dm-reply-stop";
import { createHash } from "node:crypto";
import { env as cloudflareEnv } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { insertAgentSkillStatement } from "./agent-skills";
import { decodeChannelMessageApplicationInput } from "./app-mutation-request-mappers";
import { createWorkspaceChannelMessage } from "./channel-message-routes";
import {
  claimNextChannelReplyWork,
  refreshChannelReplyClaim,
} from "./channel-reply-claim-routes";
import {
  DM_REPLY_SETTLE_MAX_RETRY_MS,
  DM_REPLY_SETTLE_MIN_RETRY_MS,
  checkpointChannelReplySession,
  completeChannelReply,
  publishChannelAcknowledgementReaction,
  enqueueChannelAgentReplies,
  getChannelSyncCursor,
  loadChannelDelta,
  toggleChannelMessageReaction,
  createChannel,
  createChannelMessage,
  getChannelAgentReplyJob,
  getChannelMessage,
  getClaimedChannelReply,
  getLiveDmChannelReplySession,
  listChannelThreadMessages,
  nextChannelReplySettleWaitMs,
  renewChannelReplyLease,
} from "./channels";
import { createWorkspaceAgent } from "./workspace-agents";
import apiWorker from "./index";
import { workerRuntimeProtoJsonFixture } from "./test-helpers/worker-runtime";
import { requireWorkerProjectBinding } from "./worker-route-auth";

/*
  A person sending three short direct messages in a row used to get three
  replies: every message opened its own reply session, so the jobs never
  serialized, never shared a provider conversation, and each one answered the
  same last-ten-message snapshot on its own.
*/

const workspaceId = "1a000000-0000-4000-8000-000000000001";
const projectId = "1b000000-0000-4000-8000-000000000001";
const deviceId = "1c000000-0000-4000-8000-000000000001";
const workerId = "1d000000-0000-4000-8000-000000000001";
const agentId = "1e000000-0000-4000-8000-000000000001";
const skillId = "1f000000-0000-4000-8000-000000000001";
const ownerId = "dm-burst-owner";
const workerToken = "briar_worker_dm-reply-burst-test";
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

describe("direct message reply bursts", () => {
  const db = cloudflareEnv.DB;
  const archives = cloudflareEnv.ARCHIVES;
  let channelSequence = 0;

  beforeAll(async () => {
    const now = new Date().toISOString();
    await db.batch([
      db.prepare(
        `insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
         values (?, 'Owner', 'dm-burst-owner@example.com', 1, ?, ?)`,
      ).bind(ownerId, now, now),
      db.prepare(
        `insert into briar_organizations (id, name, handle, created_at, updated_at)
         values (?, 'DM Burst Org', 'dm-burst-org', ?, ?)`,
      ).bind(workspaceId, now, now),
    ]);
    await db.batch([
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'owner', ?, ?)`,
      ).bind(workspaceId, ownerId, now, now),
      db.prepare(
        `insert into briar_teams (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, 'Briar', ?, ?, ?)`,
      ).bind(projectId, ownerId, workspaceId, "a".repeat(64), now, now),
    ]);
    await db.batch([
      db.prepare(
        `insert into briar_execution_worker_devices (
           id, organization_id, owner_user_id, label, device_identity_hash,
           state, last_heartbeat_at, created_at, updated_at
         ) values (?, ?, ?, 'DM burst device', ?, 'online', ?, ?, ?)`,
      ).bind(deviceId, workspaceId, ownerId, "b".repeat(64), now, now, now),
      db.prepare(
        `insert into briar_execution_worker_credentials (
           device_id, token_hash, created_at
         ) values (?, ?, ?)`,
      ).bind(deviceId, sha256(workerToken), now),
    ]);
    await db.prepare(
      `insert into briar_execution_workers (
         id, project_id, label, host_fingerprint, runtime_proto_json, state,
         accepting_work, readiness_state,
         last_heartbeat_at, created_at, updated_at, device_id
       ) values (?, ?, 'DM burst worker', ?, ?, 'online', 1, 'ready',
                 ?, ?, ?, ?)`,
    ).bind(
      workerId,
      projectId,
      "d".repeat(64),
      workerRuntimeProtoJsonFixture({
        agentProvider: "claude",
        providers: ["claude"],
      }),
      now,
      now,
      now,
      deviceId,
    ).run();
    await createWorkspaceAgent(db, {
      id: agentId,
      workspaceId,
      name: "Assistant",
      provider: "claude",
      model: null,
      responsibility: "Answer the person directly.",
      effort: null,
      createdAt: now,
    });
    await db.batch([
      insertAgentSkillStatement(db, {
        id: skillId,
        agent_id: agentId,
        name: "Summarize",
        description: "Summarize the conversation.",
        body: "Summarize what the person asked for.",
        provider: "claude",
        model: null,
        effort: null,
        kind: "custom",
        execution_mode: "conversation",
        approval_policy: "invoke_is_consent",
        is_default: 0,
        position: 0,
        created_at: now,
        updated_at: now,
      }),
    ]);
  }, 60_000);

  const env = () => ({
    DB: db,
    ARCHIVES: archives,
    BETTER_AUTH_SECRET: "dm-burst-secret-dm-burst-secret-dm-burst-000",
    GOOGLE_CLIENT_ID: "google-client-test",
    GOOGLE_CLIENT_SECRET: "google-secret-test",
  }) as unknown as Env;

  /*
    Each test gets its own conversation, and the workspace's queue is emptied
    first: the claim query walks every job in the workspace, so work another
    test left behind would decide which job this one claims.
    */
  const freshConversation = async (kind: "dm" | "channel", clear = true) => {
    if (clear) {
    await db.prepare(
      `delete from briar_channel_agent_reply_jobs where organization_id = ?`,
    ).bind(workspaceId).run();
    await db.prepare(
      `delete from briar_channel_reply_sessions where organization_id = ?`,
    ).bind(workspaceId).run();
    }
    channelSequence += 1;
    const channelId =
      `1a100000-0000-4000-8000-${String(channelSequence).padStart(12, "0")}`;
    await createChannel(db, {
      id: channelId,
      workspaceId,
      ...(kind === "dm"
        ? {
          kind: "dm" as const,
          dmKey: `agent:${JSON.stringify([ownerId, channelId])}`,
        }
        : { kind: "channel" as const, dmKey: null }),
      slug: `dm-burst-${channelSequence}`,
      name: "Assistant",
      topic: null,
      visibility: "private",
      defaultProjectId: null,
      createdByUserId: ownerId,
      agentIds: [agentId],
      createdAt: new Date().toISOString(),
    });
    return channelId;
  };

  const send = async (
    channelId: string,
    body: string,
    overrides: {
      parentMessageId?: string | null;
      mentionedAgentIds?: string[];
      skillId?: string | null;
    } = {},
  ) => {
    const decoded = decodeChannelMessageApplicationInput({
      body,
      parentMessageId: overrides.parentMessageId ?? null,
      mentionedAgentIds: overrides.mentionedAgentIds ?? [],
      skillId: overrides.skillId ?? null,
    });
    const result = await createWorkspaceChannelMessage({
      db,
      workspaceId,
      channelId,
      userId: ownerId,
      request: { ...decoded, clientMessageId: crypto.randomUUID() },
      attachmentIds: [],
    });
    return {
      messageId: result.message.id,
      job: result.agentReplies[0]!,
    };
  };

  /*
    Messages arrive with the current time, which is exactly what the settle
    window holds back. Ageing the job is how a test says "the person stopped
    typing"; the trigger message itself keeps its real timestamp.
  */
  const stopTyping = (jobId: string, secondsAgo = 30) =>
    db.prepare(
      `update briar_channel_agent_reply_jobs set created_at = ? where id = ?`,
    ).bind(
      new Date(Date.now() - secondsAgo * 1_000).toISOString(),
      jobId,
    ).run();

  const sessionIdOf = async (jobId: string) =>
    (await getChannelAgentReplyJob(db, workspaceId, jobId))!.session_id;

  const claim = async () => {
    const authenticatedWorker = await requireWorkerProjectBinding(
      db,
      new Request("https://briar.example", {
        headers: { authorization: `Bearer ${workerToken}` },
      }),
      projectId,
      workerId,
    );
    return claimNextChannelReplyWork({
      input: { workspaceId, workerId },
      db,
      env: env(),
      authenticatedWorker,
    });
  };

  const claimThroughQueue = async () => {
    const response = await apiWorker.fetch(
      new Request(
        "https://briar.example/briar.worker.v1.WorkerQueueService/ClaimWork",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${workerToken}`,
            "connect-protocol-version": "1",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            projectId,
            workerId,
            claimedBy: "dm-burst-test",
          }),
        },
      ),
      env(),
    );
    expect(response.status).toBe(200);
    return await response.json() as {
      retryAfterMs?: number;
      work?: { channelReply?: { workId: string } };
    };
  };

  const finish = async (
    claimed: NonNullable<Awaited<ReturnType<typeof claim>>>,
    overrides: Partial<Parameters<typeof completeChannelReply>[2]> = {},
  ) => {
    const claimTokenHash = sha256(claimed.claimToken);
    const job = await getClaimedChannelReply(db, {
      jobId: claimed.workId,
      deviceId,
      workerId,
      claimTokenHash,
      observedAt: claimed.claimedAt!,
    });
    if (!job) return null;
    return completeChannelReply(db, job, {
      jobId: job!.id,
      deviceId,
      workerId,
      claimTokenHash,
      body: "Answered.",
      document: null,
      issueProposal: null,
      executionProposal: null,
      agentName: "Assistant",
      agentProvider: "claude",
      completedAt: new Date().toISOString(),
      ...overrides,
    });
  };

  const react = (claimed: NonNullable<Awaited<ReturnType<typeof claim>>>, emoji: string,
    overrides: Partial<Parameters<typeof publishChannelAcknowledgementReaction>[1]> = {}) =>
    publishChannelAcknowledgementReaction(db, {
      jobId: claimed.workId, deviceId, workerId, claimTokenHash: sha256(claimed.claimToken),
      observedAt: new Date().toISOString(), emoji, ...overrides,
    });

  const agentReactions = async (channelId: string, messageId: string) =>
    ((await getChannelMessage(db, channelId, messageId))?.reactions ?? [])
      .filter((reaction) => reaction.agentIds?.includes(agentId))
      .map((reaction) => reaction.emoji);

  it.each(["🎮", "🎉", "❤️", "🙏", "👀"])("replaces its own placeholder with %s before completion, preserving others", async (emoji) => {
    const channelId = await freshConversation("dm");
    const sent = await send(channelId, "A message whose tone the Agent reads.");
    expect((await getChannelMessage(db, channelId, sent.messageId))?.reactions).toEqual([]);
    await toggleChannelMessageReaction(db, {
      channelId, messageId: sent.messageId, userId: ownerId,
      emoji: "👀", createdAt: new Date().toISOString(),
    });
    const otherAgentId = crypto.randomUUID();
    await createWorkspaceAgent(db, {
      id: otherAgentId, workspaceId, name: "Other", provider: "claude",
      model: null, responsibility: "Other", effort: null, createdAt: new Date().toISOString(),
    });
    await db.prepare(`insert into briar_channel_message_reactions (message_id, agent_id, emoji, created_at)
      values (?, ?, '👀', ?)`).bind(sent.messageId, otherAgentId, new Date().toISOString()).run();
    await stopTyping(sent.job.id);
    const claimed = (await claim())!;
    const cursor = await getChannelSyncCursor(db, workspaceId);
    // The claim publishes the placeholder; the selection replaces it later.
    await react(claimed, "👀");
    await react(claimed, emoji);
    const message = await getChannelMessage(db, channelId, sent.messageId);
    // The slot holds exactly what was asked for last, and nothing else of ours.
    expect(await agentReactions(channelId, sent.messageId)).toEqual([emoji]);
    expect(message?.reactions.find((reaction) => reaction.emoji === "👀")).toMatchObject({ userIds: [ownerId] });
    expect(message?.reactions.find((reaction) => reaction.emoji === "👀")?.agentIds).toContain(otherAgentId);
    expect((await getChannelAgentReplyJob(db, workspaceId, claimed.workId))?.status).toBe("running");
    const delta = await loadChannelDelta(db, workspaceId, ownerId, cursor);
    expect(delta.messages.find((entry) => entry.id === sent.messageId)?.reactions).toEqual(message?.reactions);
    // Two publications racing each other still settle on a single reaction.
    await Promise.all([react(claimed, "🔥"), react(claimed, "🙏")]);
    expect(await agentReactions(channelId, sent.messageId)).toHaveLength(1);
    expect(await finish(claimed, { acknowledgementReaction: "🔥" })).not.toBeNull();
    await expect(react(claimed, "😄")).rejects.toThrow();
    const completed = (await getChannelMessage(db, channelId, sent.messageId))?.reactions;
    await enqueueChannelAgentReplies(db, {
      workspaceId, channelId, triggerMessageId: sent.messageId,
      parentMessageId: sent.messageId, addAgentAcknowledgementReaction: true,
      agents: [{ id: agentId, projectId: null, provider: "claude" }], createdAt: new Date().toISOString(),
    });
    expect((await getChannelMessage(db, channelId, sent.messageId))?.reactions).toEqual(completed);
  });

  it("leaves the row alone when the selection lands on the placeholder again", async () => {
    const channelId = await freshConversation("dm");
    const sent = await send(channelId, "hello");
    await stopTyping(sent.job.id);
    const claimed = (await claim())!;
    const rows = () => db.prepare(
      `select emoji, created_at from briar_channel_message_reactions
       where message_id = ? and agent_id = ? order by emoji`,
    ).bind(sent.messageId, agentId).all<{ emoji: string; created_at: string }>();
    await react(claimed, "👀");
    const published = (await rows()).results;
    expect(published).toHaveLength(1);
    // Same emoji, later clock: neither a rewrite nor a delete-and-insert.
    await react(claimed, "👀", { observedAt: new Date(Date.now() + 60_000).toISOString() });
    expect((await rows()).results).toEqual(published);
    // An Agent that somehow holds two reactions is left exactly as it is.
    await db.prepare(`insert into briar_channel_message_reactions (message_id, agent_id, emoji, created_at)
      values (?, ?, '🎉', ?)`).bind(sent.messageId, agentId, new Date().toISOString()).run();
    const both = (await rows()).results;
    await react(claimed, "🔥");
    expect((await rows()).results).toEqual(both);
    expect(await finish(claimed)).not.toBeNull();
  });

  it("rejects invalid emoji and stale claims without preventing body completion", async () => {
    const channelId = await freshConversation("dm");
    const sent = await send(channelId, "thank you");
    await stopTyping(sent.job.id);
    const claimed = (await claim())!;
    for (const emoji of ["", "not emoji", "🎉🙏", " 🎉 "]) {
      await expect(react(claimed, emoji)).rejects.toThrow();
    }
    for (const overrides of [{ workerId: crypto.randomUUID() }, { deviceId: crypto.randomUUID() },
      { claimTokenHash: "wrong" }, { observedAt: "2999-01-01T00:00:00.000Z" }]) {
      await react(claimed, "🙏", overrides);
    }
    expect((await getChannelMessage(db, channelId, sent.messageId))?.reactions).toEqual([]);
    // Nor may a dead claim remove the reaction a live one published.
    await react(claimed, "👀");
    for (const overrides of [{ workerId: crypto.randomUUID() }, { deviceId: crypto.randomUUID() },
      { claimTokenHash: "wrong" }, { observedAt: "2999-01-01T00:00:00.000Z" }]) {
      await react(claimed, "🙏", overrides);
    }
    expect(await agentReactions(channelId, sent.messageId)).toEqual(["👀"]);
    expect(await finish(claimed)).not.toBeNull();
  });

  it("sets the slot only from the claim token the job currently holds", async () => {
    const channelId = await freshConversation("dm");
    const sent = await send(channelId, "thanks");
    await stopTyping(sent.job.id);
    const claimed = (await claim())!;
    await Promise.all([react(claimed, "🎉"), react(claimed, "🙏")]);
    const first = (await getChannelMessage(db, channelId, sent.messageId))?.reactions;
    expect(first).toHaveLength(1);
    const retryHash = sha256("retry-claim");
    await db.prepare("update briar_channel_agent_reply_jobs set claim_token_hash = ? where id = ?")
      .bind(retryHash, claimed.workId).run();
    // The superseded token can neither set the slot nor clear it.
    await react(claimed, "🔥");
    expect((await getChannelMessage(db, channelId, sent.messageId))?.reactions).toEqual(first);
    // The claim that holds the job replaces what is there.
    await react(claimed, "💛", { claimTokenHash: retryHash });
    expect(await agentReactions(channelId, sent.messageId)).toEqual(["💛"]);
    await db.prepare("update briar_channel_agent_reply_jobs set claim_token_hash = ? where id = ?")
      .bind(sha256(claimed.claimToken), claimed.workId).run();
    expect(await finish(claimed)).not.toBeNull();
  });

  it("tells a re-claim which acknowledgement the Agent already holds", async () => {
    const channelId = await freshConversation("dm");
    const sent = await send(channelId, "hi");
    await stopTyping(sent.job.id);
    const claimed = (await claim())!;
    // A first attempt has nothing on the message, so the runner publishes.
    expect(claimed.acknowledgementReaction).toBeNull();
    await react(claimed, "🎉");
    await db.prepare("update briar_channel_agent_reply_jobs set lease_expires_at = ? where id = ?")
      .bind(new Date(Date.now() - 1_000).toISOString(), claimed.workId).run();
    const recovered = (await claim())!;
    expect(recovered.workId).toBe(claimed.workId);
    // The retry skips both the placeholder and the whole selection turn.
    expect(recovered.acknowledgementReaction).toBe("🎉");
    expect(await finish(recovered)).not.toBeNull();
  });

  it.each(["deleted", "agent-authored"])("does not react to a %s trigger", async (kind) => {
    const channelId = await freshConversation("dm");
    const sent = await send(channelId, "thanks");
    await stopTyping(sent.job.id);
    const claimed = (await claim())!;
    if (kind === "deleted") {
      await db.prepare("update briar_channel_messages set deleted_at = ? where id = ?")
        .bind(new Date().toISOString(), sent.messageId).run();
    } else {
      await db.prepare("update briar_channel_messages set author_user_id = null, author_agent_id = ?, author_agent_name = 'Assistant', author_agent_provider = 'claude' where id = ?")
        .bind(agentId, sent.messageId).run();
    }
    await react(claimed, "🙏");
    expect((await getChannelMessage(db, channelId, sent.messageId))?.reactions).toEqual([]);
    await finish(claimed);
  });

  it("uses fallback if the body finishes before selection, without waiting for it", async () => {
    const channelId = await freshConversation("dm");
    const sent = await send(channelId, "hello");
    expect((await getChannelMessage(db, channelId, sent.messageId))?.reactions).toEqual([]);
    await stopTyping(sent.job.id);
    const claimed = (await claim())!;
    expect(await finish(claimed, { acknowledgementReaction: "🙏" })).not.toBeNull();
    expect((await getChannelMessage(db, channelId, sent.messageId))?.reactions)
      .toMatchObject([{ emoji: "👀", agentIds: [agentId] }]);
  });

  it("does not publish after an Agent leaves the DM", async () => {
    const channelId = await freshConversation("dm");
    const sent = await send(channelId, "thanks");
    await stopTyping(sent.job.id);
    const claimed = (await claim())!;
    await db.prepare("delete from briar_channel_agents where channel_id = ? and agent_id = ?")
      .bind(channelId, agentId).run();
    await expect(react(claimed, "🙏")).rejects.toThrow();
    expect((await getChannelMessage(db, channelId, sent.messageId))?.reactions).toEqual([]);
  });

  it("keeps regular channel messages free of automatic reactions", async () => {
    const channelId = await freshConversation("channel");
    const sent = await send(channelId, "thanks", { mentionedAgentIds: [agentId] });
    const claimed = (await claim())!;
    await react(claimed, "🙏");
    expect(await finish(claimed)).not.toBeNull();
    expect((await getChannelMessage(db, channelId, sent.messageId))?.reactions).toEqual([]);
  });

  it("keeps a second direct message in the first message's session", async () => {
    const channelId = await freshConversation("dm");
    const first = await send(channelId, "hi");
    await stopTyping(first.job.id);
    const firstClaim = await claim();
    expect(firstClaim?.workId).toBe(first.job.id);

    const second = await send(channelId, "quick question about the deploy");
    const sessionId = await sessionIdOf(first.job.id);
    expect(await sessionIdOf(second.job.id)).toBe(sessionId);
    const anchored = await getLiveDmChannelReplySession(db, {
      channelId,
      agentId,
      observedAt: new Date().toISOString(),
    });
    expect(anchored).toMatchObject({
      id: sessionId,
      thread_root_message_id: first.messageId,
    });
    // The job still points at its own trigger, so nothing the client renders
    // moves onto the anchor message.
    expect(await getChannelAgentReplyJob(db, workspaceId, second.job.id))
      .toMatchObject({
        parent_message_id: second.messageId,
        trigger_message_id: second.messageId,
      });

    // One reply at a time in a session: the second turn waits for the first.
    await stopTyping(second.job.id);
    expect(await claim()).toBeNull();
    await finish(firstClaim!);
    expect((await claim())?.workId).toBe(second.job.id);
  });

  it("resumes the provider conversation only for an explicit reply", async () => {
    const channelId = await freshConversation("dm");
    const first = await send(channelId, "run the deploy check");
    await stopTyping(first.job.id);
    const firstClaim = await claim();
    expect(firstClaim?.session?.conversationId).toBeNull();
    await checkpointChannelReplySession(db, {
      jobId: firstClaim!.workId,
      deviceId,
      workerId,
      claimTokenHash: sha256(firstClaim!.claimToken),
      conversationId: "provider-conversation-501",
      observedAt: new Date().toISOString(),
    });
    await finish(firstClaim!);

    // A message the person simply sent starts its own conversation.
    const plain = await send(channelId, "hi");
    await stopTyping(plain.job.id);
    const plainClaim = await claim();
    expect(plainClaim?.workId).toBe(plain.job.id);
    expect(plainClaim?.session?.conversationId).toBeNull();
    await finish(plainClaim!);

    // Replying to a message points at that work, so the conversation carries.
    const answer = await send(channelId, "keep going", {
      parentMessageId: first.messageId,
    });
    await stopTyping(answer.job.id);
    const answerClaim = await claim();
    expect(answerClaim?.workId).toBe(answer.job.id);
    expect(answerClaim?.session?.conversationId)
      .toBe("provider-conversation-501");
  });

  const acknowledgeSteer = async (work: NonNullable<Awaited<ReturnType<typeof claim>>>, stopUnconfirmed = false) => {
    const response = await apiWorker.fetch(new Request(
      "https://briar.example/briar.worker.v1.WorkerQueueService/AcknowledgeChannelReplySteer", {
        method: "POST",
        headers: { authorization: `Bearer ${workerToken}`,
          "connect-protocol-version": "1", "content-type": "application/json" },
        body: JSON.stringify({ projectId, workerId, stopUnconfirmed, work: {
          workId: work.workId, runId: work.channelId, claimToken: work.claimToken,
          channelReply: { workspaceId: workspaceId },
        } }),
      }), env());
    expect(response.status).toBe(200);
    return (await response.json() as { released?: boolean }).released === true;
  };

  it.each([29_999, 30_000, 30_001])("uses the inclusive receive-time boundary at %i ms", async (gap) => {
    const channelId = await freshConversation("dm");
    const first = await send(channelId, "first input");
    await stopTyping(first.job.id, 31);
    const running = (await claim())!;
    const next = await send(channelId, "second input");
    const incoming = (await getChannelAgentReplyJob(db, workspaceId, next.job.id))!;
    await db.prepare("update briar_channel_agent_reply_jobs set last_input_at = ? where id = ?")
      .bind(new Date(Date.parse(incoming.created_at) - gap).toISOString(), first.job.id).run();
    await db.batch(dmReplySteerStatements(db, next.job.id));
    const absorbed = (await getChannelAgentReplyJob(db, workspaceId, next.job.id))!;
    expect(absorbed.superseded_by_reply_job_id).toBe(gap <= 30_000 ? first.job.id : null);
    expect(await acknowledgeSteer(running)).toBe(gap <= 30_000);
  });

  it("slides the window across a burst longer than thirty seconds", async () => {
    const channelId = await freshConversation("dm");
    const first = await send(channelId, "first");
    await stopTyping(first.job.id, 31);
    await claim();
    const base = Date.now();
    await db.prepare("update briar_channel_agent_reply_jobs set last_input_at = ? where id = ?")
      .bind(new Date(base - 60_000).toISOString(), first.job.id).run();
    const second = await send(channelId, "second");
    await db.prepare("update briar_channel_agent_reply_jobs set created_at = ? where id = ?")
      .bind(new Date(base - 30_000).toISOString(), second.job.id).run();
    await db.batch(dmReplySteerStatements(db, second.job.id));
    const third = await send(channelId, "third");
    await db.prepare("update briar_channel_agent_reply_jobs set created_at = ? where id = ?")
      .bind(new Date(base).toISOString(), third.job.id).run();
    await db.batch(dmReplySteerStatements(db, third.job.id));
    expect(await getChannelAgentReplyJob(db, workspaceId, first.job.id))
      .toMatchObject({ steer_revision: 2, last_input_at: new Date(base).toISOString() });
    for (const input of [second, third]) {
      expect(await getChannelAgentReplyJob(db, workspaceId, input.job.id))
        .toMatchObject({ superseded_by_reply_job_id: first.job.id });
    }
  });

  it("stops the response when a person replies stop to an absorbed input", async () => {
    const channelId = await freshConversation("dm");
    const first = await send(channelId, "task");
    await stopTyping(first.job.id, 3);
    const running = (await claim())!;
    const detail = await send(channelId, "detail");
    await send(channelId, "stop", { parentMessageId: detail.messageId });
    expect(await getChannelAgentReplyJob(db, workspaceId, first.job.id))
      .toMatchObject({ status: "completed" });
    expect(await acknowledgeSteer(running)).toBe(true);
    expect((await getChannelAgentReplyJob(db, workspaceId, running.workId))?.stop_confirmed_at).toBeTruthy();
    expect(await claim()).toBeNull();
  });

  it("fences the old result and resumes one response with every input and the saved conversation", async () => {
    const channelId = await freshConversation("dm");
    const first = await send(channelId, "inspect the deployment");
    await stopTyping(first.job.id, 3);
    const running = (await claim())!;
    await checkpointChannelReplySession(db, {
      jobId: running.workId, deviceId, workerId,
      claimTokenHash: sha256(running.claimToken), conversationId: "steer-conversation",
      observedAt: new Date().toISOString(),
    });
    const inputs = [first.messageId];
    for (let i = 0; i < 12; i++) inputs.push((await send(channelId, `followup ${i}`)).messageId);
    expect(await claim()).toBeNull();
    expect(await finish(running)).toBeNull();
    expect(await renewChannelReplyLease(db, {
      jobId: running.workId, deviceId, workerId, claimTokenHash: sha256(running.claimToken),
      observedAt: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    })).toBeNull();
    expect(await acknowledgeSteer(running)).toBe(true);
    expect(await acknowledgeSteer(running)).toBe(true);
    // Input arriving between shutdown acknowledgement and reclaim still belongs to the response.
    inputs.push((await send(channelId, "one last detail")).messageId);
    const resumed = (await claim())!;
    expect(resumed.workId).toBe(running.workId);
    expect(resumed.claimToken).not.toBe(running.claimToken);
    expect(resumed.session?.conversationId).toBe("steer-conversation");
    expect(new Set(resumed.pendingTriggerMessageIds)).toEqual(new Set(inputs));
    expect(resumed.snapshot.messages).toHaveLength(inputs.length);
    expect(await acknowledgeSteer(running)).toBe(false);
    expect(await finish(running)).toBeNull();
    expect(await finish(resumed)).not.toBeNull();
    expect(await claim()).toBeNull();
    const replies = await db.prepare("select id from briar_channel_messages where channel_id = ? and author_agent_id = ?")
      .bind(channelId, agentId).all();
    expect(replies.results).toHaveLength(1);
  });

  const refresh = async (
    claimed: NonNullable<Awaited<ReturnType<typeof claim>>>,
    overrides: { claimToken?: string } = {},
  ) => {
    const authenticatedWorker = await requireWorkerProjectBinding(
      db,
      new Request("https://briar.example", {
        headers: { authorization: `Bearer ${workerToken}` },
      }),
      projectId,
      workerId,
    );
    return refreshChannelReplyClaim({
      input: {
        workspaceId,
        workerId,
        jobId: claimed.workId,
        claimToken: overrides.claimToken ?? claimed.claimToken,
      },
      db,
      env: env(),
      authenticatedWorker,
    });
  };

  /*
    The steer used to be noticed only when the finished answer was refused: the
    whole provider turn was thrown away, the job requeued, and a second claim
    ran the whole setup again. Folded in place there is no restart at all, so
    the attempt and the steer restart count must not move.
  */
  it("folds a steer into the running claim without restarting it", async () => {
    const channelId = await freshConversation("dm");
    const first = await send(channelId, "ㅎㅇㅎㅇ");
    await stopTyping(first.job.id, 3);
    const running = (await claim())!;
    expect(running.pendingTriggerMessageIds).toEqual([first.messageId]);
    const second = await send(channelId, "안녕");
    const steered = (await getChannelAgentReplyJob(db, workspaceId, running.workId))!;
    expect(steered).toMatchObject({
      steer_revision: 1,
      applied_steer_revision: 0,
      attempts: 1,
      steer_restart_count: 0,
    });

    const folded = (await refresh(running))!;
    expect(folded.claimToken).toBe(running.claimToken);
    expect(new Set(folded.pendingTriggerMessageIds))
      .toEqual(new Set([first.messageId, second.messageId]));
    expect(folded.snapshot.messages.map((message) => message.id))
      .toEqual([first.messageId, second.messageId]);
    expect(await getChannelAgentReplyJob(db, workspaceId, running.workId))
      .toMatchObject({
        status: "running",
        steer_revision: 1,
        applied_steer_revision: 1,
        attempts: 1,
        steer_restart_count: 0,
      });
    // Nothing is left pending, so neither the renewal nor the completion of
    // this same claim is refused any more.
    expect(await acknowledgeSteer(running)).toBe(false);
    expect(await renewChannelReplyLease(db, {
      jobId: running.workId, deviceId, workerId,
      claimTokenHash: sha256(running.claimToken),
      observedAt: new Date().toISOString(),
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    })).not.toBeNull();
    expect(await finish(folded)).not.toBeNull();
    expect(await claim()).toBeNull();
  });

  it("reports nothing to fold when no input is pending", async () => {
    const channelId = await freshConversation("dm");
    const first = await send(channelId, "only message");
    await stopTyping(first.job.id, 3);
    const running = (await claim())!;
    expect(await refresh(running)).toBeNull();
    expect(await getChannelAgentReplyJob(db, workspaceId, running.workId))
      .toMatchObject({
        status: "running",
        steer_revision: 0,
        applied_steer_revision: 0,
        attempts: 1,
        steer_restart_count: 0,
      });
    expect(await finish(running)).not.toBeNull();
  });

  it("refuses a fold outside the live claim it is scoped to", async () => {
    const channelId = await freshConversation("dm");
    const first = await send(channelId, "task");
    await stopTyping(first.job.id, 3);
    const running = (await claim())!;
    await send(channelId, "detail");
    await expect(refresh(running, {
      claimToken: `briar_channel_claim_${"9".repeat(64)}`,
    })).rejects.toMatchObject({ status: 409 });
    // A claim released back to the queue cannot be folded either.
    expect(await acknowledgeSteer(running)).toBe(true);
    await expect(refresh(running)).rejects.toMatchObject({ status: 409 });
    expect(await getChannelAgentReplyJob(db, workspaceId, running.workId))
      .toMatchObject({ status: "queued", applied_steer_revision: 0 });
  });

  it("keeps the public message claim scope on the folded revision", async () => {
    const base = workerRuntimeProtoJsonFixture({
      agentProvider: "claude",
      providers: ["claude"],
    });
    const runtime = JSON.parse(base) as {
      capabilities: Record<string, unknown>;
    };
    runtime.capabilities.dmPublicMessages = {
      protocol: 1,
      providers: ["AGENT_PROVIDER_CLAUDE"],
    };
    await db.prepare(
      `update briar_execution_workers set runtime_proto_json = ? where id = ?`,
    ).bind(JSON.stringify(runtime), workerId).run();
    try {
      const channelId = await freshConversation("dm");
      const first = await send(channelId, "publish as you go");
      await stopTyping(first.job.id, 3);
      const running = (await claim())!;
      expect(running.dmPublicMessageProtocol).toBe(1);
      expect(running.inputRevision).toBe(0);
      await send(channelId, "and one more thing");
      const folded = (await refresh(running))!;
      expect(folded.dmPublicMessageProtocol).toBe(1);
      expect(folded.inputRevision).toBe(1);
      const scope = await getDmPublicMessageClaim(db, {
        jobId: running.workId,
        workspaceId,
        workerId,
        deviceId,
        claimTokenHash: sha256(running.claimToken),
        observedAt: new Date().toISOString(),
      });
      expect(scope).toMatchObject({ input_revision: 1 });
      expect(await listDmPublicMessagesForReply(db, {
        jobId: running.workId,
        workspaceId,
      })).toEqual(folded.publishedMessageBatches);
    } finally {
      await db.prepare(
        `update briar_execution_workers set runtime_proto_json = ? where id = ?`,
      ).bind(base, workerId).run();
    }
  });

  it("keeps messages beyond a gap out of the running response and claims them afterwards", async () => {
    const channelId = await freshConversation("dm");
    const first = await send(channelId, "first task");
    await stopTyping(first.job.id, 3);
    const running = (await claim())!;
    await send(channelId, "first task detail");
    expect(await acknowledgeSteer(running)).toBe(true);
    const resumed = (await claim())!;
    await db.prepare("update briar_channel_agent_reply_jobs set last_input_at = ? where id = ?")
      .bind(new Date(Date.now() - 31_000).toISOString(), first.job.id).run();
    const next = await send(channelId, "a different task");
    const nextDetail = await send(channelId, "different task detail");
    for (const item of [next, nextDetail]) {
      expect(await getChannelAgentReplyJob(db, workspaceId, item.job.id))
        .toMatchObject({ status: "queued", superseded_by_reply_job_id: null });
    }
    expect(await acknowledgeSteer(resumed)).toBe(false);
    await finish(resumed);
    await stopTyping(next.job.id);
    expect((await claim())?.workId).toBe(next.job.id);
  });

  it("serializes input arrival against the final answer transaction", async () => {
    const channelId = await freshConversation("dm");
    const first = await send(channelId, "task");
    await stopTyping(first.job.id, 3);
    const running = (await claim())!;
    const [next, completed] = await Promise.all([
      send(channelId, "racing detail"), finish(running),
    ]);
    const nextJob = (await getChannelAgentReplyJob(db, workspaceId, next.job.id))!;
    if (nextJob.superseded_by_reply_job_id) {
      expect(completed).toBeNull();
      expect(await acknowledgeSteer(running)).toBe(true);
      const resumed = (await claim())!;
      expect(resumed.pendingTriggerMessageIds).toContain(next.messageId);
      await finish(resumed);
    } else {
      expect(completed).not.toBeNull();
      await stopTyping(next.job.id);
      await finish((await claim())!);
    }
    expect(await claim()).toBeNull();
    const rows = await db.prepare("select id from briar_channel_messages where channel_id = ? and author_agent_id = ?")
      .bind(channelId, agentId).all();
    expect(rows.results).toHaveLength(nextJob.superseded_by_reply_job_id ? 1 : 2);
  });

  it("recovers pending input after a Worker dies without acknowledging shutdown", async () => {
    const channelId = await freshConversation("dm");
    const first = await send(channelId, "task");
    await stopTyping(first.job.id, 3);
    const running = (await claim())!;
    const next = await send(channelId, "detail");
    await db.prepare("update briar_channel_agent_reply_jobs set lease_expires_at = ?, attempts = 3 where id = ?")
      .bind(new Date(Date.now() - 1_000).toISOString(), first.job.id).run();
    const recovered = (await claim())!;
    expect(recovered.workId).toBe(first.job.id);
    expect(recovered.pendingTriggerMessageIds).toContain(next.messageId);
    expect(await finish(running)).toBeNull();
    expect(await finish(recovered)).not.toBeNull();
  });

  it("recognizes only explicit whole stop commands", () => {
    for (const body of ["그만해", "중단해", "여기까지 해", "stop", " STOP! ", "@assistant 중단해 주세요"]) {
      expect(isDmReplyStop(body, ["Assistant"])).toBe(true);
    }
    for (const body of ["중단이라는 단어", "중단하지 마", "stop the server after the build", "don't stop", "그만해?", "'stop'", "if it fails stop", "@someone stop"]) {
      expect(isDmReplyStop(body, ["Assistant"])).toBe(false);
    }
  });

  it("settles only the original queued job, without enqueuing a stop reply", async () => {
    const channelId = await freshConversation("dm");
    const original = await send(channelId, "Summarize", { mentionedAgentIds: [agentId], skillId });
    const other = await send(channelId, "Another task", { mentionedAgentIds: [agentId], skillId });
    const stop = await send(channelId, "그만해", { parentMessageId: original.messageId });
    expect(stop.job).toBeUndefined();
    expect(await getChannelAgentReplyJob(db, workspaceId, original.job.id))
      .toMatchObject({ status: "completed", claim_token_hash: null, lease_expires_at: null });
    expect(await getChannelAgentReplyJob(db, workspaceId, other.job.id))
      .toMatchObject({ status: "queued" });
    expect((await listChannelThreadMessages(db, channelId, original.messageId))
      .some((message) => message.body === "요청한 Agent 작업을 중단했습니다.")).toBe(true);
  });

  it("revokes a running claim and fences stale completion while its session peer stays queued", async () => {
    const channelId = await freshConversation("dm");
    const original = await send(channelId, "First task");
    await stopTyping(original.job.id);
    const claimed = (await claim())!;
    const claimTokenHash = sha256(claimed.claimToken);
    const oldJob = (await getClaimedChannelReply(db, {
      jobId: claimed.workId, deviceId, workerId, claimTokenHash,
      observedAt: claimed.claimedAt!,
    }))!;
    const other = await send(channelId, "Next task");
    await send(channelId, "stop", { parentMessageId: original.messageId });
    await expect(getClaimedChannelReply(db, {
      jobId: claimed.workId, deviceId, workerId, claimTokenHash,
      observedAt: new Date().toISOString(),
    })).rejects.toThrow();
    await completeChannelReply(db, oldJob, {
      jobId: oldJob.id, deviceId, workerId, claimTokenHash,
      agentName: "Assistant", agentProvider: "claude", body: "Late answer",
      document: null, issueProposal: null, executionProposal: null,
      completedAt: new Date().toISOString(),
    });
    expect(await getChannelMessage(db, channelId, oldJob.reply_message_id)).toBeNull();
    expect(await getChannelAgentReplyJob(db, workspaceId, other.job.id))
      .toMatchObject({ status: "queued" });
  });

  it("does not cancel on ambiguous prose and keeps explicit DM replies in the thread", async () => {
    const channelId = await freshConversation("dm");
    const original = await send(channelId, "First task");
    await stopTyping(original.job.id);
    const firstClaim = (await claim())!;
    const followup = await send(channelId, "중단이라는 단어를 설명해 줘", { parentMessageId: original.messageId });
    expect(followup.job).toBeDefined();
    expect(await getChannelAgentReplyJob(db, workspaceId, original.job.id))
      .toMatchObject({ status: "running" });
    await finish(firstClaim);
    await stopTyping(followup.job.id);
    const next = (await claim())!;
    expect(next.workId).toBe(followup.job.id);
    expect(next.snapshot.messages.map((message) => message.id)).toEqual([
      original.messageId,
      followup.messageId,
    ]);
    await finish(next);
    const row = (await getChannelAgentReplyJob(db, workspaceId, next.workId))!;
    expect(await getChannelMessage(db, channelId, row.reply_message_id))
      .toMatchObject({ parentMessageId: original.messageId });
  });

  it("requires one explicit Agent on a multi-Agent origin and leaves the other job alone", async () => {
    const channelId = await freshConversation("dm");
    const otherAgentId = crypto.randomUUID();
    const now = new Date().toISOString();
    await createWorkspaceAgent(db, { id: otherAgentId, workspaceId, name: "Other",
      provider: "claude", model: null, responsibility: "Answer", effort: null, createdAt: now });
    await db.prepare(`insert into briar_channel_agents (channel_id, agent_id, created_at)
      values (?, ?, ?)`).bind(channelId, otherAgentId, now).run();
    const original = await send(channelId, "Both answer", { mentionedAgentIds: [agentId, otherAgentId] });
    const jobs = () => db.prepare(`select agent_id, status from briar_channel_agent_reply_jobs
      where channel_id = ? and trigger_message_id = ? order by agent_id`)
      .bind(channelId, original.messageId).all<{ agent_id: string; status: string }>();
    await send(channelId, "stop", { parentMessageId: original.messageId });
    expect((await jobs()).results.map((job) => job.status)).toEqual(["queued", "queued"]);
    await send(channelId, "@assistant stop", { parentMessageId: original.messageId, mentionedAgentIds: [agentId] });
    expect((await jobs()).results.find((job) => job.agent_id === agentId)?.status).toBe("completed");
    expect((await jobs()).results.find((job) => job.agent_id === otherAgentId)?.status).toBe("queued");
  });

  it("replays a stop receipt without affecting later work or duplicating the notice", async () => {
    const channelId = await freshConversation("dm");
    const original = await send(channelId, "First task");
    const request = { ...decodeChannelMessageApplicationInput({ body: "stop", parentMessageId: original.messageId }), clientMessageId: crypto.randomUUID() };
    const input = { db, workspaceId, channelId, userId: ownerId, request, attachmentIds: [] };
    await createWorkspaceChannelMessage(input);
    const before = await listChannelThreadMessages(db, channelId, original.messageId);
    const later = await send(channelId, "Continue", { parentMessageId: original.messageId });
    await createWorkspaceChannelMessage(input);
    expect(await getChannelAgentReplyJob(db, workspaceId, later.job.id))
      .toMatchObject({ status: "queued" });
    const after = await listChannelThreadMessages(db, channelId, original.messageId);
    expect(after.filter((message) => message.body === "요청한 Agent 작업을 중단했습니다.")).toHaveLength(1);
    expect(after).toHaveLength(before.length + 1);
  });

  it("rejects a nonparticipant and a root from another DM", async () => {
    const channelId = await freshConversation("dm");
    const original = await send(channelId, "First task");
    const request = { ...decodeChannelMessageApplicationInput({ body: "stop", parentMessageId: original.messageId }), clientMessageId: crypto.randomUUID() };
    await expect(createWorkspaceChannelMessage({ db, workspaceId, channelId,
      userId: "not-a-participant", request, attachmentIds: [] })).rejects.toThrow();
    const otherChannelId = crypto.randomUUID();
    await expect(createWorkspaceChannelMessage({ db, workspaceId, channelId: otherChannelId,
      userId: ownerId, request, attachmentIds: [] })).rejects.toThrow();
    expect(await getChannelAgentReplyJob(db, workspaceId, original.job.id))
      .toMatchObject({ status: "queued" });
  });

  it("keeps queued DM messages independently cancellable in a shared session", async () => {
    const channelId = await freshConversation("dm");
    const first = await send(channelId, "hi");
    const second = await send(channelId, "one more thing");
    for (const item of [first, second]) {
      expect(await getChannelAgentReplyJob(db, workspaceId, item.job.id))
        .toMatchObject({ status: "queued", superseded_by_reply_job_id: null });
    }
    expect(await sessionIdOf(first.job.id)).toBe(await sessionIdOf(second.job.id));
    await send(channelId, "stop", { parentMessageId: first.messageId });
    expect(await getChannelAgentReplyJob(db, workspaceId, second.job.id))
      .toMatchObject({ status: "queued" });
    await stopTyping(second.job.id);
    expect((await claim())?.workId).toBe(second.job.id);
  });

  it("never takes a turn away from a Worker that already started it", async () => {
    const channelId = await freshConversation("dm");
    const first = await send(channelId, "hi");
    await stopTyping(first.job.id);
    expect((await claim())?.workId).toBe(first.job.id);

    await send(channelId, "and one more thing");
    expect(await getChannelAgentReplyJob(db, workspaceId, first.job.id))
      .toMatchObject({
        status: "running",
        superseded_by_reply_job_id: null,
      });
  });

  it("leaves an Agent Skill command out of the fold in both directions", async () => {
    const channelId = await freshConversation("dm");
    const command = await send(channelId, "Summarize", {
      mentionedAgentIds: [agentId],
      skillId,
    });
    expect(await getChannelAgentReplyJob(db, workspaceId, command.job.id))
      .toMatchObject({ skill_id: skillId, status: "queued" });

    const plain = await send(channelId, "hi");
    expect(await sessionIdOf(plain.job.id))
      .toBe(await sessionIdOf(command.job.id));
    expect(await getChannelAgentReplyJob(db, workspaceId, command.job.id))
      .toMatchObject({ status: "queued", superseded_by_reply_job_id: null });

    const secondCommand = await send(channelId, "Summarize", {
      mentionedAgentIds: [agentId],
      skillId,
    });
    expect(secondCommand.job.id).not.toBe(command.job.id);
    expect(await getChannelAgentReplyJob(db, workspaceId, plain.job.id))
      .toMatchObject({ status: "queued", superseded_by_reply_job_id: null });
  });

  it("holds a fresh direct message back and asks the Worker to come straight back", async () => {
    const channelId = await freshConversation("dm");
    const first = await send(channelId, "hi");
    expect(await claim()).toBeNull();

    const observedAt = new Date().toISOString();
    const waitMs = await nextChannelReplySettleWaitMs(db, workspaceId, {
      observedAt,
    });
    expect(waitMs).not.toBeNull();
    expect(waitMs).toBeGreaterThanOrEqual(DM_REPLY_SETTLE_MIN_RETRY_MS);
    expect(waitMs).toBeLessThanOrEqual(DM_REPLY_SETTLE_MAX_RETRY_MS);

    // The ordinary idle answer is 15 seconds, which would leave the person
    // waiting long after their own message settled.
    const queued = await claimThroughQueue();
    expect(queued.work).toBeUndefined();
    expect(queued.retryAfterMs).toBeGreaterThanOrEqual(
      DM_REPLY_SETTLE_MIN_RETRY_MS,
    );
    expect(queued.retryAfterMs).toBeLessThanOrEqual(
      DM_REPLY_SETTLE_MAX_RETRY_MS,
    );

    await stopTyping(first.job.id);
    expect(await nextChannelReplySettleWaitMs(db, workspaceId, {
      observedAt: new Date().toISOString(),
    })).toBeNull();
    expect((await claimThroughQueue()).work?.channelReply?.workId).toBe(
      first.job.id,
    );
  });

  it("includes the latest twenty DM messages in a new reply claim", async () => {
    const channelId = await freshConversation("dm");
    const base = Date.now() - 60_000;
    for (let index = 0; index < 21; index += 1) {
      await createChannelMessage(db, {
        id: crypto.randomUUID(),
        channelId,
        parentMessageId: null,
        authorUserId: ownerId,
        authorAgentId: null,
        authorAgentName: null,
        authorAgentProvider: null,
        body: `history ${index}`,
        mentionedUserIds: [],
        mentionedAgentIds: [],
        createdAt: new Date(base + index * 1_000).toISOString(),
      });
    }
    const trigger = await send(channelId, "current request");
    await stopTyping(trigger.job.id);

    const claimed = (await claim())!;
    expect(claimed.snapshot.messages).toHaveLength(20);
    expect(claimed.snapshot.messages.map((message) => message.body)).toEqual([
      ...Array.from({ length: 19 }, (_, index) => `history ${index + 2}`),
      "current request",
    ]);
  });

  it("leaves a channel thread on its own root, with no settle and no folding", async () => {
    const channelId = await freshConversation("channel");
    const root = await send(channelId, "@Assistant please look at this", {
      mentionedAgentIds: [agentId],
    });
    const followUp = await send(channelId, "@Assistant and also this", {
      parentMessageId: root.messageId,
      mentionedAgentIds: [agentId],
    });
    expect(await sessionIdOf(followUp.job.id))
      .toBe(await sessionIdOf(root.job.id));
    for (const thread of [root, followUp]) {
      expect(await getChannelAgentReplyJob(db, workspaceId, thread.job.id))
        .toMatchObject({
          status: "queued",
          superseded_by_reply_job_id: null,
          parent_message_id: root.messageId,
        });
    }
    // No settle window outside a direct message: the root turn is claimable the
    // moment it is queued.
    expect((await claim())?.workId).toBe(root.job.id);
    expect(await nextChannelReplySettleWaitMs(db, workspaceId, {
      observedAt: new Date().toISOString(),
    })).toBeNull();
  });

  describe("classified DM input", () => {
    const enableRouting = () => db.prepare(`update briar_execution_workers set runtime_proto_json =
      json_set(runtime_proto_json, '$.capabilities.dmReplyRouting', json(?),
        '$.capabilities.dmPublicMessages', json(?)) where id = ?`)
      .bind(JSON.stringify({ protocol: 1, providers: ["AGENT_PROVIDER_CLAUDE"] }),
        JSON.stringify({ protocol: 1, providers: ["AGENT_PROVIDER_CLAUDE"] }), workerId).run();
    const incoming = async (channelId: string, body: string) => {
      const sent = await send(channelId, body);
      await stopTyping(sent.job.id);
      const work = (await claim())!;
      expect(work.workId).toBe(sent.job.id);
      expect(work.routing?.action).toBe("pending");
      return work;
    };
    const route = (work: NonNullable<Awaited<ReturnType<typeof claim>>>, action: string,
      targetJobId: string | null = null, response: string | null = null) =>
      resolveDmReplyRouting(db, { jobId: work.workId, workspaceId, channelId: work.channelId,
        deviceId, workerId, claimTokenHash: sha256(work.claimToken), observedAt: new Date().toISOString(),
        decision: { action, targetJobId, response } });

    it("admits three independent sessions with full regular slots, and answers without steering", async () => {
      await enableRouting();
      await db.prepare("update briar_execution_workers set readiness_state = 'busy' where id = ?")
        .bind(workerId).run();
      const channelId = await freshConversation("dm");
      // A temporarily offline capable Worker must not fall back to legacy folding.
      await db.prepare("update briar_execution_workers set last_heartbeat_at = '2000-01-01T00:00:00.000Z', accepting_work = 0, readiness_state = 'needs_attention' where id = ?")
        .bind(workerId).run();
      const waiting = await send(channelId, "메시지 구조를 C로 변경해줘");
      expect(await getChannelAgentReplyJob(db, workspaceId, waiting.job.id))
        .toMatchObject({ status: "queued", routing_action: "pending" });
      await expect(claim()).rejects.toThrow("Worker is not ready to claim replies");
      expect(await getChannelAgentReplyJob(db, workspaceId, waiting.job.id))
        .toMatchObject({ status: "queued", routing_action: "pending" });
      await db.prepare("update briar_execution_workers set last_heartbeat_at = ?, accepting_work = 1, readiness_state = 'busy' where id = ?")
        .bind(new Date().toISOString(), workerId).run();
      await stopTyping(waiting.job.id);
      const first = (await claim())!;
      expect(first.workId).toBe(waiting.job.id);
      expect(await getDmPublicMessageClaim(db, { jobId: first.workId, workspaceId,
        workerId, deviceId, claimTokenHash: sha256(first.claimToken), observedAt: new Date().toISOString() })).toBeNull();
      expect(await finish(first)).toBeNull();
      const requestRouting = (token: string) => apiWorker.fetch(new Request(
        "https://briar.example/briar.worker.v1.WorkerQueueService/ResolveDmReplyRouting", {
          method: "POST", headers: { authorization: `Bearer ${workerToken}`,
            "connect-protocol-version": "1", "content-type": "application/json" },
          body: JSON.stringify({ projectId, workerId, work: { workId: first.workId,
            runId: channelId, claimToken: token, channelReply: { workspaceId: workspaceId } },
            decision: { action: "new" } }),
        }), env());
      expect((await requestRouting("stale-token")).status).toBe(400);
      const routed = await requestRouting(first.claimToken);
      expect(routed.status).toBe(200);
      expect(await routed.json()).toMatchObject({ decision: { action: "new" } });
      const second = await incoming(channelId, "별도로 로그를 조사해줘");
      await route(second, "new");
      const third = await incoming(channelId, "별도로 문서를 작성해줘");
      await route(third, "new");
      expect(new Set([first.session!.id, second.session!.id, third.session!.id]).size).toBe(3);
      expect((await db.prepare("select count(*) as count from briar_channel_agent_reply_jobs where channel_id = ? and status = 'running'")
        .bind(channelId).first<{ count: number }>())?.count).toBe(3);
      const question = await incoming(channelId, "어디까지 됐어?");
      expect(await route(question, "answer", null, "세 작업이 실행 중입니다.")).toMatchObject({ action: "answer" });
      await finish(question, { body: "세 작업이 실행 중입니다." });
      for (const work of [first, second, third]) {
        expect(await getChannelAgentReplyJob(db, workspaceId, work.workId))
          .toMatchObject({ status: "running", steer_revision: 0 });
      }
    });

    it("stores C to D to E in receive order, retries once, and resumes the same job after stop acknowledgement", async () => {
      await enableRouting();
      const channelId = await freshConversation("dm");
      const first = await incoming(channelId, "C로 변경해줘");
      await route(first, "new");
      await checkpointChannelReplySession(db, { jobId: first.workId, deviceId, workerId,
        claimTokenHash: sha256(first.claimToken), conversationId: "routing-conversation",
        observedAt: new Date().toISOString() });
      await db.prepare("update briar_channel_agent_reply_jobs set last_input_at = ? where id = ?")
        .bind(new Date(Date.now() - 61_000).toISOString(), first.workId).run();
      const d = await incoming(channelId, "그냥 D로 바꿔줘");
      const e = await incoming(channelId, "D 대신 E로 바꿔줘");
      expect(await route(e, "steer", first.workId)).toMatchObject({ action: "pending" });
      const independent = await incoming(channelId, "별도로 로그 조사");
      expect(await route(independent, "new")).toMatchObject({ action: "new" });
      await route(d, "steer", first.workId);
      // A resend cannot replace a committed target or increment twice.
      expect(await route(d, "cancel", independent.workId)).toMatchObject({ action: "steer", targetJobId: first.workId });
      await db.prepare("update briar_channel_agent_reply_jobs set lease_expires_at = ? where id = ?")
        .bind(new Date(Date.now() - 1000).toISOString(), e.workId).run();
      const recovered = (await claim())!;
      expect(recovered).toMatchObject({ workId: e.workId, routing: {
        action: "pending", proposedAction: "steer", targetJobId: first.workId,
      } });
      // Reclaim retains the already classified intent even if a retry submits another target.
      await route(recovered, "cancel", independent.workId);
      expect(await getChannelAgentReplyJob(db, workspaceId, first.workId))
        .toMatchObject({ status: "running", steer_revision: 2 });
      expect(await finish(first)).toBeNull();
      expect(await acknowledgeSteer(first)).toBe(true);
      const resumed = (await claim())!;
      expect(resumed).toMatchObject({ workId: first.workId,
        session: { id: first.session!.id, conversationId: "routing-conversation" } });
      expect(resumed.pendingTriggerMessageIds).toEqual([first.triggerMessageId, d.triggerMessageId, e.triggerMessageId]);
      expect(await getChannelAgentReplyJob(db, workspaceId, independent.workId))
        .toMatchObject({ status: "running", steer_revision: 0 });
      expect(await listDmPublicMessagesForReply(db, { jobId: d.workId, workspaceId: workspaceId })).toHaveLength(1);
    });

    it("cancels only the selected running job and publishes stop confirmation only after acknowledgement", async () => {
      await enableRouting();
      const channelId = await freshConversation("dm");
      const first = await incoming(channelId, "C로 변경해줘");
      await route(first, "new");
      const logs = await incoming(channelId, "별도로 로그 조사");
      await route(logs, "new");
      const cancel = await incoming(channelId, "로그 조사만 취소해줘");
      await route(cancel, "cancel", logs.workId);
      expect(await getChannelAgentReplyJob(db, workspaceId, logs.workId))
        .toMatchObject({ status: "completed", stop_confirmed_at: null });
      await expect(finish(logs)).rejects.toThrow();
      expect(await listDmPublicMessagesForReply(db, { jobId: logs.workId, workspaceId: workspaceId })).toHaveLength(0);
      expect(await acknowledgeSteer(logs)).toBe(true);
      expect(await acknowledgeSteer(logs)).toBe(true);
      expect(await listDmPublicMessagesForReply(db, { jobId: logs.workId, workspaceId: workspaceId })).toHaveLength(1);
      expect(await getChannelAgentReplyJob(db, workspaceId, first.workId))
        .toMatchObject({ status: "running", steer_revision: 0 });
      expect(await claim()).toBeNull();
      const change = await incoming(channelId, "C 대신 D로 변경해줘");
      await route(change, "steer", first.workId);
      expect(await acknowledgeSteer(first, true)).toBe(false);
      await db.prepare("update briar_channel_agent_reply_jobs set lease_expires_at = ? where id = ?")
        .bind(new Date(Date.now() - 1000).toISOString(), first.workId).run();
      expect(await getChannelAgentReplyJob(db, workspaceId, first.workId))
        .toMatchObject({ error: "dm_reply_stop_unconfirmed", status: "running" });
      expect(await claim()).toBeNull();
      const progress = await listDmPublicMessagesForReply(db, { jobId: first.workId, workspaceId });
      const explicitStop = await send(channelId, "stop", { parentMessageId: progress[0]!.messageIds[0]! });
      expect(explicitStop.job).toBeUndefined();
      expect(await getChannelAgentReplyJob(db, workspaceId, first.workId)).toMatchObject({ status: "completed" });
    });

    it("refuses another DM target and preserves a completed target instead of cancelling a different job", async () => {
      await enableRouting();
      const other = await incoming(await freshConversation("dm"), "다른 DM 작업");
      await route(other, "new");
      const channelId = await freshConversation("dm", false);
      const first = await incoming(channelId, "C로 변경해줘");
      await route(first, "new");
      await finish(first);
      const cancel = await incoming(channelId, "방금 작업 취소해");
      await expect(route(cancel, "cancel", other.workId)).rejects.toThrow();
      expect(await route(cancel, "cancel", first.workId)).toMatchObject({ action: "answer", targetJobId: first.workId });
      expect(await getChannelAgentReplyJob(db, workspaceId, other.workId)).toMatchObject({ status: "running" });
    });

    it("serializes completion against steering without losing the incoming request", async () => {
      await enableRouting();
      const channelId = await freshConversation("dm");
      const first = await incoming(channelId, "C로 변경해줘");
      await route(first, "new");
      const next = await incoming(channelId, "D로 변경해줘");
      const [decision, completed] = await Promise.all([route(next, "steer", first.workId), finish(first)]);
      if (decision.action === "steer") {
        expect(completed).toBeNull();
        expect(await acknowledgeSteer(first)).toBe(true);
      } else {
        expect(decision.action).toBe("new");
        expect(completed).not.toBeNull();
        expect(await getChannelAgentReplyJob(db, workspaceId, next.workId))
          .toMatchObject({ status: "running", superseded_by_reply_job_id: null });
      }
    });
  });

});
