import { createHash } from "node:crypto";
import { env as cloudflareEnv } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { insertAgentSkillStatement } from "./agent-skills";
import { decodeChannelMessageApplicationInput } from "./app-mutation-request-mappers";
import { createOrganizationChannelMessage } from "./channel-message-routes";
import { claimNextChannelReplyWork } from "./channel-reply-claim-routes";
import {
  DM_REPLY_SETTLE_MAX_RETRY_MS,
  DM_REPLY_SETTLE_MIN_RETRY_MS,
  completeChannelReply,
  createChannel,
  getChannelAgentReplyJob,
  getChannelMessage,
  getClaimedChannelReply,
  getLiveDmChannelReplySession,
  nextChannelReplySettleWaitMs,
} from "./channels";
import { createOrganizationAgent } from "./organization-agents";
import apiWorker from "./index";
import { workerRuntimeProtoJsonFixture } from "./test-helpers/worker-runtime";
import { requireWorkerProjectBinding } from "./worker-route-auth";

/*
  A person sending three short direct messages in a row used to get three
  replies: every message opened its own reply session, so the jobs never
  serialized, never shared a provider conversation, and each one answered the
  same last-ten-message snapshot on its own.
*/

const organizationId = "1a000000-0000-4000-8000-000000000001";
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
      ).bind(organizationId, now, now),
    ]);
    await db.batch([
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'owner', ?, ?)`,
      ).bind(organizationId, ownerId, now, now),
      db.prepare(
        `insert into briar_teams (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, 'Briar', ?, ?, ?)`,
      ).bind(projectId, ownerId, organizationId, "a".repeat(64), now, now),
    ]);
    await db.batch([
      db.prepare(
        `insert into briar_execution_worker_devices (
           id, organization_id, owner_user_id, label, device_identity_hash,
           state, last_heartbeat_at, created_at, updated_at
         ) values (?, ?, ?, 'DM burst device', ?, 'online', ?, ?, ?)`,
      ).bind(deviceId, organizationId, ownerId, "b".repeat(64), now, now, now),
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
    await createOrganizationAgent(db, {
      id: agentId,
      organizationId,
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
    Each test gets its own conversation, and the organization's queue is emptied
    first: the claim query walks every job in the organization, so work another
    test left behind would decide which job this one claims.
    */
  const freshConversation = async (kind: "dm" | "channel") => {
    await db.prepare(
      `delete from briar_channel_agent_reply_jobs where organization_id = ?`,
    ).bind(organizationId).run();
    await db.prepare(
      `delete from briar_channel_reply_sessions where organization_id = ?`,
    ).bind(organizationId).run();
    channelSequence += 1;
    const channelId =
      `1a100000-0000-4000-8000-${String(channelSequence).padStart(12, "0")}`;
    await createChannel(db, {
      id: channelId,
      organizationId,
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
    const result = await createOrganizationChannelMessage({
      db,
      organizationId,
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
    (await getChannelAgentReplyJob(db, organizationId, jobId))!.session_id;

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
      input: { organizationId, workerId },
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

  const finish = async (claimed: NonNullable<Awaited<ReturnType<typeof claim>>>) => {
    const claimTokenHash = sha256(claimed.claimToken);
    const job = await getClaimedChannelReply(db, {
      jobId: claimed.workId,
      deviceId,
      workerId,
      claimTokenHash,
      observedAt: claimed.claimedAt!,
    });
    await completeChannelReply(db, job!, {
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
    });
    return job!;
  };

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
    expect(await getChannelAgentReplyJob(db, organizationId, second.job.id))
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

  it("folds queued turns into the newest message and reports every unanswered trigger", async () => {
    const channelId = await freshConversation("dm");
    const first = await send(channelId, "hi");
    const second = await send(channelId, "one more thing");
    expect(await getChannelAgentReplyJob(db, organizationId, first.job.id))
      .toMatchObject({
        status: "completed",
        superseded_by_reply_job_id: second.job.id,
      });

    const third = await send(channelId, "actually, about the deploy");
    // The chain stays one level deep: both older turns point at the survivor.
    for (const superseded of [first, second]) {
      const job = await getChannelAgentReplyJob(
        db,
        organizationId,
        superseded.job.id,
      );
      expect(job).toMatchObject({
        status: "completed",
        superseded_by_reply_job_id: third.job.id,
      });
      expect(job!.completed_at).not.toBeNull();
      // A superseded turn answers through its successor, so its own reply
      // message is never written.
      expect(await getChannelMessage(db, channelId, job!.reply_message_id))
        .toBeNull();
    }
    expect(await getChannelAgentReplyJob(db, organizationId, third.job.id))
      .toMatchObject({ status: "queued", superseded_by_reply_job_id: null });

    await stopTyping(third.job.id);
    const claimed = await claim();
    expect(claimed?.workId).toBe(third.job.id);
    expect(claimed?.pendingTriggerMessageIds).toEqual([
      first.messageId,
      second.messageId,
      third.messageId,
    ]);
  });

  it("never takes a turn away from a Worker that already started it", async () => {
    const channelId = await freshConversation("dm");
    const first = await send(channelId, "hi");
    await stopTyping(first.job.id);
    expect((await claim())?.workId).toBe(first.job.id);

    await send(channelId, "and one more thing");
    expect(await getChannelAgentReplyJob(db, organizationId, first.job.id))
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
    expect(await getChannelAgentReplyJob(db, organizationId, command.job.id))
      .toMatchObject({ skill_id: skillId, status: "queued" });

    const plain = await send(channelId, "hi");
    expect(await sessionIdOf(plain.job.id))
      .toBe(await sessionIdOf(command.job.id));
    expect(await getChannelAgentReplyJob(db, organizationId, command.job.id))
      .toMatchObject({ status: "queued", superseded_by_reply_job_id: null });

    const secondCommand = await send(channelId, "Summarize", {
      mentionedAgentIds: [agentId],
      skillId,
    });
    expect(secondCommand.job.id).not.toBe(command.job.id);
    expect(await getChannelAgentReplyJob(db, organizationId, plain.job.id))
      .toMatchObject({ status: "queued", superseded_by_reply_job_id: null });
  });

  it("holds a fresh direct message back and asks the Worker to come straight back", async () => {
    const channelId = await freshConversation("dm");
    const first = await send(channelId, "hi");
    expect(await claim()).toBeNull();

    const observedAt = new Date().toISOString();
    const waitMs = await nextChannelReplySettleWaitMs(db, organizationId, {
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
    expect(await nextChannelReplySettleWaitMs(db, organizationId, {
      observedAt: new Date().toISOString(),
    })).toBeNull();
    expect((await claimThroughQueue()).work?.channelReply?.workId).toBe(
      first.job.id,
    );
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
      expect(await getChannelAgentReplyJob(db, organizationId, thread.job.id))
        .toMatchObject({
          status: "queued",
          superseded_by_reply_job_id: null,
          parent_message_id: root.messageId,
        });
    }
    // No settle window outside a direct message: the root turn is claimable the
    // moment it is queued.
    expect((await claim())?.workId).toBe(root.job.id);
    expect(await nextChannelReplySettleWaitMs(db, organizationId, {
      observedAt: new Date().toISOString(),
    })).toBeNull();
  });
});
