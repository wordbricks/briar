import { createHash } from "node:crypto";
import { env as cloudflareEnv } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { decodeChannelMessageApplicationInput } from "./app-mutation-request-mappers";
import { requireChannelAccess } from "./channel-route-access";
import { claimNextChannelReplyWork } from "./channel-reply-claim-routes";
import { createWorkspaceChannelMessage } from "./channel-message-routes";
import {
  agentDirectMessageKey,
  channelJson,
  type ChannelReplyJobRow,
  createChannel,
  createChannelMessage,
  enqueueChannelAgentReplies,
  getChannel,
  getChannelAgentReplyJob,
  getChannelMessage,
  listAgentDirectMessages,
  listChannelAgentReplies,
  listChannelMessagePage,
  listChannels,
  loadChannelDelta,
} from "./channels";
import { createTeamAgent } from "./db";
import { HttpError } from "./http-response";
import { createWorkspaceAgent } from "./workspace-agents";
import { rethrowReplyCompletionHttpError } from "./reply-completion-http-error";
import { workerRuntimeProtoJsonFixture } from "./test-helpers/worker-runtime";
import { completeChannelReplyApplication } from "./worker-reply-completion-application";
import type { ChannelReplyCompletionInput } from "./worker-reply-completion-mappers";
import { requireWorkerProjectBinding } from "./worker-route-auth";

const workspaceId = "11000000-0000-4000-8000-000000000001";
const projectId = "12000000-0000-4000-8000-000000000001";
const deviceId = "13000000-0000-4000-8000-000000000001";
const workerId = "14000000-0000-4000-8000-000000000001";
const ownerDirectMessageId = "15000000-0000-4000-8000-000000000001";
const outsiderDirectMessageId = "15000000-0000-4000-8000-000000000002";
const teamChannelId = "15000000-0000-4000-8000-000000000003";
const senderAgentId = "16000000-0000-4000-8000-000000000001";
const peerAgentId = "16000000-0000-4000-8000-000000000002";
const ownerId = "agent-message-owner";
const outsiderId = "agent-message-outsider";
const workerToken = "briar_worker_channel-agent-message-test";
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

describe("Agent-to-Agent messaging", () => {
  const db = cloudflareEnv.DB;
  const archives = cloudflareEnv.ARCHIVES;
  let projectAgent: Awaited<ReturnType<typeof createTeamAgent>>;
  let senderAgent: NonNullable<
    Awaited<ReturnType<typeof createWorkspaceAgent>>
  >;
  let peerAgent: NonNullable<
    Awaited<ReturnType<typeof createWorkspaceAgent>>
  >;

  beforeAll(async () => {
    const now = new Date().toISOString();
    await db.batch([
      db.prepare(
        `insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
         values (?, 'Owner', 'agent-message-owner@example.com', 1, ?, ?)`,
      ).bind(ownerId, now, now),
      db.prepare(
        `insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
         values (?, 'Outsider', 'agent-message-outsider@example.com', 1, ?, ?)`,
      ).bind(outsiderId, now, now),
      db.prepare(
        `insert into briar_organizations (id, name, handle, created_at, updated_at)
         values (?, 'Agent Message Org', 'agent-message-org', ?, ?)`,
      ).bind(workspaceId, now, now),
    ]);
    await db.batch([
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'owner', ?, ?)`,
      ).bind(workspaceId, ownerId, now, now),
      // A developer reaches every conversation but only the projects they join.
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'developer', ?, ?)`,
      ).bind(workspaceId, outsiderId, now, now),
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
         ) values (?, ?, ?, 'Agent message device', ?, 'online', ?, ?, ?)`,
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
       ) values (?, ?, 'Agent message worker', ?, ?, 'online', 1, 'ready',
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
    senderAgent = (await createWorkspaceAgent(db, {
      id: senderAgentId,
      workspaceId,
      name: "Assistant",
      provider: "claude",
      model: null,
      responsibility: "Answer the person and coordinate with other Agents.",
      effort: null,
      createdAt: now,
    }))!;
    peerAgent = (await createWorkspaceAgent(db, {
      id: peerAgentId,
      workspaceId,
      name: "Ticker",
      provider: "claude",
      model: null,
      responsibility: "Watch the ticker.",
      effort: null,
      createdAt: now,
    }))!;
    projectAgent = await createTeamAgent(db, projectId, {
      name: "Briar Guide",
      provider: "claude",
      model: null,
      effort: null,
      responsibility: "Answer repository questions for Briar.",
      calendarColor: "#6f5a7e",
    });
    for (
      const [channelId, userId] of [
        [ownerDirectMessageId, ownerId],
        [outsiderDirectMessageId, outsiderId],
      ]
    ) {
      await createChannel(db, {
        id: channelId,
        workspaceId,
        kind: "dm",
        dmKey: `agent:${JSON.stringify([userId, senderAgentId])}`,
        slug: `dm-${channelId}`,
        name: "Assistant",
        topic: null,
        visibility: "private",
        defaultProjectId: null,
        createdByUserId: userId,
        agentIds: [senderAgentId],
        createdAt: now,
      });
    }
    await createChannel(db, {
      id: teamChannelId,
      workspaceId,
      kind: "channel",
      dmKey: null,
      slug: "agent-message-channel",
      name: "Agent message channel",
      topic: null,
      visibility: "public",
      defaultProjectId: projectId,
      createdByUserId: ownerId,
      agentIds: [senderAgentId, projectAgent.id],
      createdAt: now,
    });
  }, 60_000);

  const env = (overrides: Record<string, string> = {}) => ({
    DB: db,
    ARCHIVES: archives,
    BETTER_AUTH_SECRET: "agent-message-secret-agent-message-secret-000",
    GOOGLE_CLIENT_ID: "google-client-test",
    GOOGLE_CLIENT_SECRET: "google-secret-test",
    ...overrides,
  }) as unknown as Env;

  type ChannelCompletion = Extract<
    ChannelReplyCompletionInput["outcome"],
    { case: "success" }
  >["completion"];
  type ChannelCompletionDraft = Pick<ChannelCompletion, "body"> &
    Partial<Omit<ChannelCompletion, "body">>;

  const complete = async (
    jobId: string,
    input: {
      claimToken: string;
      result: ChannelCompletionDraft;
      runtimeEnv?: Env;
    },
  ) => {
    const job = await getChannelAgentReplyJob(db, workspaceId, jobId);
    if (!job) throw new Error("Reply job is missing");
    const result = input.result;
    try {
      return Response.json(
        await completeChannelReplyApplication({
          db,
          env: input.runtimeEnv ?? env(),
          worker: {
            principal: { workspaceId, deviceId },
            binding: { id: workerId, project_id: projectId },
          },
          request: {
            requestId: crypto.randomUUID(),
            projectId,
            workerId,
            claim: {
              replyKind: "channel",
              workspaceId,
              workId: jobId,
              runId: job.channel_id,
              claimToken: input.claimToken,
            },
            attachmentIds: [],
            publishedFinalBatchId: null,
            conversationId: null,
            outcome: {
              case: "success",
              completion: {
                body: result.body,
                document: result.document ?? null,
                issueProposal: result.issueProposal ?? null,
                issueBatchProposal: result.issueBatchProposal ?? null,
                executionProposal: result.executionProposal ?? null,
                skillExecutionProposal: result.skillExecutionProposal ?? null,
                delegation: result.delegation ?? null,
                agentMessage: result.agentMessage ?? null,
              },
            },
          },
        }),
      );
    } catch (error) {
      try {
        rethrowReplyCompletionHttpError(error);
      } catch (mapped) {
        if (mapped instanceof HttpError) {
          return Response.json({ message: mapped.message }, {
            status: mapped.status,
          });
        }
        throw mapped;
      }
    }
  };

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

  const startTurn = async (channelId: string, userId: string, body: string) => {
    // Direct-message conversation turns wait out a short settle window before a
    // Worker may claim them, so that several short messages sent in a row
    // become one reply. These turns are claimed immediately, so they are
    // written as if the person had sent them a moment ago.
    const now = new Date(Date.now() - 10_000).toISOString();
    const messageId = crypto.randomUUID();
    await createChannelMessage(db, {
      id: messageId,
      channelId,
      parentMessageId: null,
      authorUserId: userId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body,
      mentionedUserIds: [],
      mentionedAgentIds: [senderAgentId],
      createdAt: now,
    });
    const jobs = await enqueueChannelAgentReplies(db, {
      workspaceId,
      channelId,
      triggerMessageId: messageId,
      parentMessageId: messageId,
      agents: [{ id: senderAgentId, projectId: null, provider: "claude" }],
      createdAt: now,
    });
    return {
      messageId,
      job: jobs.find((job) => job.agent_id === senderAgentId)!,
    };
  };

  const agentConversation = (agentId: string, otherAgentId: string) =>
    db.prepare(
      `select id, kind, dm_key, visibility, created_by_user_id
       from briar_channels where organization_id = ? and dm_key = ?`,
    ).bind(workspaceId, agentDirectMessageKey(agentId, otherAgentId))
      .first<{
        id: string;
        kind: string;
        dm_key: string;
        visibility: string;
        created_by_user_id: string | null;
      }>();

  const relayMessageId = async (
    originReplyJobId: string,
    direction: "outbound" | "inbound",
  ) =>
    (await db.prepare(
      `select message_id from briar_channel_message_relays
       where origin_reply_job_id = ? and direction = ?`,
    ).bind(originReplyJobId, direction).first<{ message_id: string }>())
      ?.message_id ?? null;

  it("carries one question to another Agent and the answer back", async () => {
    const turn = await startTurn(
      ownerDirectMessageId,
      ownerId,
      "Ask Ticker whether anything new came in.",
    );
    const senderClaim = await claim();
    expect(senderClaim).toMatchObject({
      workId: turn.job.id,
      agentMessageHop: 0,
      inboundAgentMessage: null,
      // Plan §3.7: a direct message never offers the in-thread delegation.
      delegationTargets: [],
    });
    expect(senderClaim?.agentMessageTargets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: peerAgent.id,
          agentName: "Ticker",
          projectId: null,
          projectName: null,
          responsibility: "Watch the ticker.",
        }),
        // The owner reaches every project, so its Agents are reachable too.
        expect.objectContaining({
          agentId: projectAgent.id,
          projectId,
          projectName: "Briar",
        }),
      ]),
    );
    expect(senderClaim?.agentMessageTargets).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agentId: senderAgent.id }),
      ]),
    );
    const senderToken = String(senderClaim?.claimToken);

    expect(
      (await complete(turn.job.id, {
        claimToken: senderToken,
        result: {
          body: "Asking Ticker now.",
          document: {
            title: "Notes",
            markdown: "Notes",
            projectId: null,
          },
          agentMessage: {
            agentId: peerAgent.id,
            body: "Anything new on the ticker?",
          },
        },
      }))?.status,
    ).toBe(400);

    const sent = await complete(turn.job.id, {
      claimToken: senderToken,
      result: {
        body: "Asking Ticker now.",
        agentMessage: {
          agentId: peerAgent.id,
          body: "Anything new on the ticker?",
        },
      },
    });
    expect(sent?.status).toBe(200);

    const conversation = await agentConversation(senderAgent.id, peerAgent.id);
    expect(conversation).toMatchObject({
      kind: "dm",
      dm_key: agentDirectMessageKey(senderAgent.id, peerAgent.id),
      visibility: "private",
      created_by_user_id: null,
    });
    await expect(db.prepare(
      `select count(*) as count from briar_channel_members where channel_id = ?`,
    ).bind(conversation!.id).first()).resolves.toEqual({ count: 0 });
    await expect(db.prepare(
      `select count(*) as count from briar_channel_agents where channel_id = ?`,
    ).bind(conversation!.id).first()).resolves.toEqual({ count: 2 });

    const answerJob = (await db.prepare(
      `select * from briar_channel_agent_reply_jobs
       where origin_reply_job_id = ? and agent_message_hop = 1`,
    ).bind(turn.job.id).first<ChannelReplyJobRow>())!;
    expect(answerJob).toMatchObject({
      agent_id: peerAgent.id,
      channel_id: conversation!.id,
      agent_message_hop: 1,
      origin_reply_job_id: turn.job.id,
      delegated_by_reply_job_id: null,
      status: "queued",
    });
    await expect(
      getChannelMessage(db, conversation!.id, answerJob.trigger_message_id),
    ).resolves.toMatchObject({
      author: { type: "agent", id: senderAgent.id, name: "Assistant" },
      body: "Anything new on the ticker?",
      mentionedAgentIds: [peerAgent.id],
    });

    const noticeId = await relayMessageId(turn.job.id, "outbound");
    await expect(
      getChannelMessage(db, ownerDirectMessageId, noticeId!),
    ).resolves.toMatchObject({
      author: { type: "agent", id: senderAgent.id },
      body: "Anything new on the ticker?",
      relay: {
        direction: "outbound",
        peerChannelId: conversation!.id,
        peerMessageId: answerJob.trigger_message_id,
        peerAgentId: peerAgent.id,
        peerAgentName: "Ticker",
        status: "pending",
      },
    });

    const answerClaim = await claim();
    expect(answerClaim).toMatchObject({
      workId: answerJob.id,
      agentMessageHop: 1,
      agentMessageTargets: [],
      delegationTargets: [],
      inboundAgentMessage: {
        senderAgentId: senderAgent.id,
        senderAgentName: "Assistant",
        body: "Anything new on the ticker?",
        originReplyJobId: turn.job.id,
      },
    });
    const answerToken = String(answerClaim?.claimToken);
    for (
      const rejected of [
        {
          body: "Passing this on.",
          agentMessage: { agentId: senderAgent.id, body: "Your turn." },
        },
        {
          body: "Here is a document instead.",
          document: { title: "Ticker", markdown: "All quiet", projectId: null },
        },
      ] satisfies ChannelCompletionDraft[]
    ) {
      expect(
        (await complete(answerJob.id, {
          claimToken: answerToken,
          result: rejected,
        }))?.status,
      ).toBe(400);
    }
    expect(
      (await complete(answerJob.id, {
        claimToken: answerToken,
        result: { body: "Nothing new since this morning." },
      }))?.status,
    ).toBe(200);

    await expect(
      getChannelMessage(db, conversation!.id, answerJob.reply_message_id),
    ).resolves.toMatchObject({
      author: { type: "agent", id: peerAgent.id, name: "Ticker" },
      body: "Nothing new since this morning.",
    });
    await expect(
      getChannelMessage(db, ownerDirectMessageId, noticeId!),
    ).resolves.toMatchObject({ relay: { status: "completed" } });
    /*
      The answer stays the one message it was, in the Agent-to-Agent
      conversation: nothing of it is copied into the person's own, so their
      timeline and the conversation preview are untouched by it and the
      relaying turn hangs off the notice that was already there.
    */
    expect(await relayMessageId(turn.job.id, "inbound")).toBeNull();
    const personTimeline = await listChannelMessagePage(db, {
      channelId: ownerDirectMessageId,
      parentMessageId: null,
      cursor: null,
      limit: 50,
      includeRepliesInTimeline: true,
    });
    expect(personTimeline?.messages.map((message) => message.id))
      .toContain(noticeId);
    expect(personTimeline?.messages.map((message) => message.body))
      .not.toContain("Nothing new since this morning.");
    const [ownerDirectMessage] = (await listChannels(db, workspaceId, ownerId))
      .filter((channel) => channel.id === ownerDirectMessageId);
    expect(ownerDirectMessage?.last_message_preview)
      .not.toBe("Nothing new since this morning.");

    const relayJob = (await listChannelAgentReplies(
      db,
      ownerDirectMessageId,
      noticeId!,
    ))[0]!;
    expect(relayJob).toMatchObject({
      agent_id: senderAgent.id,
      agent_message_hop: 2,
      origin_reply_job_id: turn.job.id,
      // The person's conversation continues rather than restarting.
      session_id: turn.job.session_id,
      parent_message_id: turn.job.parent_message_id,
      status: "queued",
    });

    const relayClaim = await claim();
    expect(relayClaim).toMatchObject({
      workId: relayJob.id,
      agentMessageHop: 2,
      agentMessageTargets: [],
      inboundAgentMessage: {
        senderAgentId: peerAgent.id,
        senderAgentName: "Ticker",
        body: "Nothing new since this morning.",
        originReplyJobId: turn.job.id,
      },
    });
    const relayToken = String(relayClaim?.claimToken);
    expect(
      (await complete(relayJob.id, {
        claimToken: relayToken,
        result: {
          body: "Passing it back.",
          agentMessage: { agentId: peerAgent.id, body: "Anything else?" },
        },
      }))?.status,
    ).toBe(400);
    expect(
      (await complete(relayJob.id, {
        claimToken: relayToken,
        result: { body: "Ticker says nothing new since this morning." },
      }))?.status,
    ).toBe(200);
    await expect(
      getChannelMessage(db, ownerDirectMessageId, relayJob.reply_message_id),
    ).resolves.toMatchObject({
      author: { type: "agent", id: senderAgent.id },
      body: "Ticker says nothing new since this morning.",
      relay: null,
    });
  });

  it("keeps a channel thread on the existing delegation path", async () => {
    const now = new Date().toISOString();
    const messageId = crypto.randomUUID();
    await createChannelMessage(db, {
      id: messageId,
      channelId: teamChannelId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: "@Assistant ask Ticker about the release.",
      mentionedUserIds: [],
      mentionedAgentIds: [senderAgentId],
      createdAt: now,
    });
    const [job] = await enqueueChannelAgentReplies(db, {
      workspaceId,
      channelId: teamChannelId,
      triggerMessageId: messageId,
      parentMessageId: messageId,
      agents: [{ id: senderAgentId, projectId: null, provider: "claude" }],
      createdAt: now,
    });
    const channelClaim = await claim();
    expect(channelClaim).toMatchObject({
      workId: job!.id,
      agentMessageTargets: [],
    });
    expect(channelClaim?.delegationTargets).toEqual([
      expect.objectContaining({ agentId: projectAgent.id }),
    ]);
    const response = await complete(job!.id, {
      claimToken: String(channelClaim?.claimToken),
      result: {
        body: "Asking Ticker.",
        agentMessage: { agentId: peerAgent.id, body: "About the release?" },
      },
    });
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toMatchObject({
      message: "Only a direct message reply can message another Agent",
    });
    expect(await agentConversation(senderAgent.id, peerAgent.id)).toMatchObject({
      // The refused send left the existing conversation untouched.
      dm_key: agentDirectMessageKey(senderAgent.id, peerAgent.id),
    });
    await expect(
      getChannelMessage(db, teamChannelId, job!.reply_message_id),
    ).resolves.toBeNull();
  });

  it("refuses an Agent the requesting member cannot reach", async () => {
    const turn = await startTurn(
      outsiderDirectMessageId,
      outsiderId,
      "Ask the Briar Guide about the repository.",
    );
    const senderClaim = await claim();
    expect(senderClaim).toMatchObject({ workId: turn.job.id });
    expect(senderClaim?.agentMessageTargets).toEqual([
      expect.objectContaining({ agentId: peerAgent.id }),
    ]);
    const response = await complete(turn.job.id, {
      claimToken: String(senderClaim?.claimToken),
      result: {
        body: "Asking the Briar Guide.",
        agentMessage: {
          agentId: projectAgent.id,
          body: "Which module owns authentication?",
        },
      },
    });
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toMatchObject({
      message: "Agent message target is not eligible",
    });
    expect(await agentConversation(senderAgent.id, projectAgent.id)).toBeNull();
  });

  it("reuses the same Agent conversation and marks a lost answer failed", async () => {
    const conversation = await agentConversation(senderAgent.id, peerAgent.id);
    const before = await db.prepare(
      `select count(*) as count from briar_channel_messages where channel_id = ?`,
    ).bind(conversation!.id).first<{ count: number }>();
    const turn = await startTurn(
      ownerDirectMessageId,
      ownerId,
      "Ask Ticker once more.",
    );
    const senderClaim = await claim();
    expect(senderClaim).toMatchObject({ workId: turn.job.id });
    expect(
      (await complete(turn.job.id, {
        claimToken: String(senderClaim?.claimToken),
        result: {
          body: "Asking again.",
          agentMessage: { agentId: peerAgent.id, body: "Any update yet?" },
        },
      }))?.status,
    ).toBe(200);

    await expect(db.prepare(
      `select count(*) as count from briar_channels
       where organization_id = ? and dm_key = ?`,
    ).bind(
      workspaceId,
      agentDirectMessageKey(senderAgent.id, peerAgent.id),
    ).first()).resolves.toEqual({ count: 1 });
    await expect(db.prepare(
      `select count(*) as count from briar_channel_messages where channel_id = ?`,
    ).bind(conversation!.id).first()).resolves.toEqual({
      count: (before?.count ?? 0) + 1,
    });

    /*
      v1 does not re-invoke the sender when the answering job dies for good;
      the notice in the person's conversation turns to failed and the job's
      own error stays on the usual reply surface.
    */
    const answerJob = (await db.prepare(
      `select * from briar_channel_agent_reply_jobs
       where origin_reply_job_id = ? and agent_message_hop = 1`,
    ).bind(turn.job.id).first<ChannelReplyJobRow>())!;
    expect(answerJob.channel_id).toBe(conversation!.id);
    const failedAt = new Date().toISOString();
    await db.prepare(
      `update briar_channel_agent_reply_jobs
       set status = 'failed', error = 'Agent runner exited without a result',
           completed_at = ?, updated_at = ?
       where id = ?`,
    ).bind(failedAt, failedAt, answerJob.id).run();
    await expect(
      getChannelMessage(
        db,
        ownerDirectMessageId,
        (await relayMessageId(turn.job.id, "outbound"))!,
      ),
    ).resolves.toMatchObject({ relay: { status: "failed" } });
  });

  it("stops sending once the workspace's hourly ceiling is reached", async () => {
    const turn = await startTurn(
      outsiderDirectMessageId,
      outsiderId,
      "Ask Ticker again.",
    );
    const senderClaim = await claim();
    expect(senderClaim).toMatchObject({ workId: turn.job.id });
    const response = await complete(turn.job.id, {
      claimToken: String(senderClaim?.claimToken),
      runtimeEnv: env({ AGENT_MESSAGE_HOURLY_LIMIT: "1" }),
      result: {
        body: "Asking Ticker.",
        agentMessage: { agentId: peerAgent.id, body: "Anything new?" },
      },
    });
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toMatchObject({
      message: "Agent message hourly limit (1) reached",
    });
    await expect(
      getChannelAgentReplyJob(db, workspaceId, turn.job.id),
    ).resolves.toMatchObject({
      status: "failed",
      error: "Agent message hourly limit (1) reached",
    });
  });

  it("opens an Agent conversation only to members who reach both Agents", async () => {
    const turn = await startTurn(
      ownerDirectMessageId,
      ownerId,
      "Ask the Briar Guide who owns authentication.",
    );
    const senderClaim = await claim();
    expect(senderClaim).toMatchObject({ workId: turn.job.id });
    expect(
      (await complete(turn.job.id, {
        claimToken: String(senderClaim?.claimToken),
        result: {
          body: "Asking the Briar Guide.",
          agentMessage: {
            agentId: projectAgent.id,
            body: "Which module owns authentication?",
          },
        },
      }))?.status,
    ).toBe(200);

    const organizationConversation = await agentConversation(
      senderAgent.id,
      peerAgent.id,
    );
    const projectConversation = await agentConversation(
      senderAgent.id,
      projectAgent.id,
    );
    expect(projectConversation).not.toBeNull();

    await expect(
      getChannel(db, workspaceId, projectConversation!.id, ownerId),
    ).resolves.toMatchObject({ id: projectConversation!.id, kind: "dm" });
    await expect(
      getChannel(db, workspaceId, projectConversation!.id, outsiderId),
    ).resolves.toBeNull();
    await expect(requireChannelAccess(
      db,
      workspaceId,
      projectConversation!.id,
      outsiderId,
    )).rejects.toMatchObject({ status: 404 });
    // Two Workspace Agents belong to nobody's project, so anybody may read.
    await expect(
      getChannel(db, workspaceId, organizationConversation!.id, outsiderId),
    ).resolves.toMatchObject({ id: organizationConversation!.id });

    const catalog = await listChannels(db, workspaceId, ownerId);
    expect(catalog.map((channel) => channel.id)).not.toContain(
      organizationConversation!.id,
    );
    expect(catalog.map((channel) => channel.id)).not.toContain(
      projectConversation!.id,
    );
    expect(catalog.map((channel) => channel.id)).toContain(
      ownerDirectMessageId,
    );

    const ownerConversations = await listAgentDirectMessages(
      db,
      workspaceId,
      senderAgent.id,
      ownerId,
    );
    expect(ownerConversations.map((channel) => channel.id)).toEqual(
      expect.arrayContaining([
        organizationConversation!.id,
        projectConversation!.id,
      ]),
    );
    expect(ownerConversations.map(channelJson).map(
      (channel) => channel.readOnly,
    )).not.toContain(false);
    const outsiderConversations = await listAgentDirectMessages(
      db,
      workspaceId,
      senderAgent.id,
      outsiderId,
    );
    expect(outsiderConversations.map((channel) => channel.id)).toEqual([
      organizationConversation!.id,
    ]);

    await expect(createWorkspaceChannelMessage({
      db,
      workspaceId,
      channelId: organizationConversation!.id,
      userId: ownerId,
      request: decodeChannelMessageApplicationInput({
        clientMessageId: crypto.randomUUID(),
        body: "Can I join in?",
      }),
      attachmentIds: [],
    })).rejects.toMatchObject({
      status: 403,
      message: "Agent conversations are read-only",
    });
  });

  it("streams the Agent conversation to a member who can read it", async () => {
    const conversation = await agentConversation(senderAgent.id, peerAgent.id);
    const delta = await loadChannelDelta(db, workspaceId, ownerId, 0, 1_000);
    expect(delta.channels.map((channel) => channel.id)).toContain(
      conversation!.id,
    );
    expect(
      delta.messages.filter((message) =>
        message.channelId === conversation!.id
      ),
    ).not.toHaveLength(0);
    const outsiderDelta = await loadChannelDelta(
      db,
      workspaceId,
      outsiderId,
      0,
      1_000,
    );
    const projectConversation = await agentConversation(
      senderAgent.id,
      projectAgent.id,
    );
    expect(outsiderDelta.channels.map((channel) => channel.id)).not.toContain(
      projectConversation!.id,
    );
    expect(
      outsiderDelta.messages.filter((message) =>
        message.channelId === projectConversation!.id
      ),
    ).toHaveLength(0);
  });
});
