import { env as cloudflareEnv } from "cloudflare:workers";
import { createClient, createRouterTransport } from "@connectrpc/connect";
import { WorkerQueueService } from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createChannelActivityPublishToken } from "./channel-activity-ticket";
import {
  cleanupAbandonedReplyLookups,
  replyLookupCompletionStatement,
  reserveReplyLookup,
} from "./channel-reply-lookup-budget";
import { claimNextChannelReplyWork } from "./channel-reply-claim-routes";
import {
  checkpointChannelReplySession,
  completeChannelReply,
  createChannel,
  createChannelMessage,
  enqueueChannelAgentReplies,
  getChannelAgentReplyJob,
  getChannelMessage,
  getChannelReplySession,
} from "./channels";
import { sha256 } from "./crypto-digest";
import { flushDmMemoryActivityRevocations } from "./dm-memory-activity-revocations";
import {
  getDmMemoryClaimBrief,
  lookupDmMemoryClaim,
} from "./dm-memory-claim-application";
import { requireDmMemoryReplyFence } from "./dm-memory-reply-fence";
import { claimDmLearningJob } from "./dm-memory-learning-claims";
import {
  reserveDmLearningModelCall,
  submitDmLearningProposal,
  submitDmLearningVerification,
} from "./dm-memory-learning-model-calls";
import { scheduleDmLearningJobs } from "./dm-memory-learning-queue";
import {
  deleteDmMemory,
  getDmMemory,
  saveDmMemory,
  updateDmMemorySettings,
} from "./dm-memory-repository";
import { createOrganizationAgent } from "./organization-agents";
import { syntheticDmLearningChange } from "./test-helpers/dm-memory-learning";
import { workerRuntimeProtoJsonFixture } from "./test-helpers/worker-runtime";
import { createWorkerQueueService } from "./worker-connect-queue";
import { requireWorkerProjectBinding } from "./worker-route-auth";

/*
  This suite is the recall half of the DM memory contract: a Worker claims a DM
  reply, the server binds that claim to one memory space and revocation epoch,
  and every brief, lookup, activity frame and completion is fenced against that
  binding. It was written against the pre-Connect HTTP routes, deleted during
  the protobuf/Connect migration in #1427, and restored here on the generated
  WorkerQueueService so the guarantees have a regression net again.
*/
describe("DM memory in active channel claims", () => {
  const db = cloudflareEnv.DB;
  const organizationId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const agentId = crypto.randomUUID();
  const workerId = crypto.randomUUID();
  const deviceId = crypto.randomUUID();
  const workerToken = `briar_worker_${crypto.randomUUID().replaceAll("-", "")}`;
  const runtimeJson = workerRuntimeProtoJsonFixture({
    agentProvider: "claude",
    providers: ["claude", "codex"],
    dmMemoryLearning: { protocol: 2, transports: ["agent"], providers: ["codex"] },
  });

  const env = () => ({
    DB: db,
    BETTER_AUTH_SECRET: "synthetic-memory-activity-secret-with-enough-length",
    DM_MEMORY_RETRIEVAL_ENABLED: "true",
    DM_MEMORY_MINIMUM_SCORE: "",
  }) as unknown as Env;

  beforeAll(async () => {
    const now = new Date().toISOString();
    await db.batch([
      db.prepare(
        `insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
         values (?, 'Synthetic owner', ?, 1, ?, ?)`,
      ).bind(ownerId, `${ownerId}@example.com`, now, now),
      db.prepare(
        `insert into briar_organizations (id, name, handle, created_at, updated_at)
         values (?, 'Synthetic memory execution', ?, ?, ?)`,
      ).bind(organizationId, organizationId, now, now),
      db.prepare(
        `insert into briar_organization_members (organization_id, user_id, role, created_at, updated_at)
         values (?, ?, 'owner', ?, ?)`,
      ).bind(organizationId, ownerId, now, now),
      db.prepare(
        `insert into briar_teams (id, owner_user_id, organization_id, name, agent_token_hash, created_at, updated_at)
         values (?, ?, ?, 'Synthetic project', ?, ?, ?)`,
      ).bind(projectId, ownerId, organizationId, "a".repeat(64), now, now),
      db.prepare(
        `insert into briar_execution_worker_devices
           (id, organization_id, owner_user_id, label, device_identity_hash, state,
            last_heartbeat_at, created_at, updated_at)
         values (?, ?, ?, 'Synthetic device', ?, 'online', ?, ?, ?)`,
      ).bind(deviceId, organizationId, ownerId, "b".repeat(64), now, now, now),
      db.prepare(
        `insert into briar_execution_worker_credentials (device_id, token_hash, created_at)
         values (?, ?, ?)`,
      ).bind(deviceId, await sha256(workerToken), now),
      db.prepare(
        `insert into briar_execution_workers
           (id, project_id, label, host_fingerprint, runtime_proto_json, state, accepting_work,
            readiness_state, last_heartbeat_at, created_at, updated_at, device_id)
         values (?, ?, 'Synthetic worker', ?, ?, 'online', 1, 'ready', ?, ?, ?, ?)`,
      ).bind(workerId, projectId, "c".repeat(64), runtimeJson, now, now, now, deviceId),
    ]);
    await createOrganizationAgent(db, {
      id: agentId,
      organizationId,
      name: "Synthetic Agent",
      provider: "claude",
      model: null,
      responsibility: "Memory execution tests",
      effort: null,
      createdAt: now,
    });
  }, 120_000);

  beforeEach(async () => {
    await db.prepare(
      `update briar_channel_agent_reply_jobs set status = 'failed'
       where status in ('queued', 'running') and organization_id = ?`,
    ).bind(organizationId).run();
    await db.prepare(
      `update briar_execution_workers set runtime_proto_json = ? where id = ?`,
    ).bind(runtimeJson, workerId).run();
  });

  async function fixture(messageBody = "한국어 설명을 선호합니다.") {
    const channelId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const now = new Date().toISOString();
    const owner = { organizationId, channelId, userId: ownerId };
    await createChannel(db, {
      id: channelId,
      organizationId,
      kind: "dm",
      dmKey: `agent:${JSON.stringify([ownerId, channelId])}`,
      slug: channelId,
      name: "Synthetic DM",
      visibility: "private",
      topic: null,
      defaultProjectId: null,
      createdByUserId: ownerId,
      agentIds: [agentId],
      createdAt: now,
    });
    await createChannelMessage(db, {
      id: messageId,
      channelId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: messageBody,
      mentionedUserIds: [],
      mentionedAgentIds: [agentId],
      createdAt: now,
    });
    const saved = await saveDmMemory(db, owner, {
      requestId: crypto.randomUUID(),
      title: "설명 언어",
      body: "설명은 한국어로 요청한다.",
      memoryClass: "profile",
      sourceLanguage: "ko",
      observedAt: now,
      validUntil: null,
      sourceMessage: { id: messageId, version: 1 },
    });
    const jobs = await enqueueChannelAgentReplies(db, {
      organizationId,
      channelId,
      triggerMessageId: messageId,
      parentMessageId: messageId,
      agents: [{ id: agentId, projectId: null, provider: "claude" }],
      createdAt: now,
    });
    // DM replies are held back by the settle window that keeps a burst of
    // messages on one job. Ageing the job is how this test says the person
    // stopped typing; the trigger message keeps its real timestamp.
    await stopTyping(jobs[0]!.id);
    return { owner, channelId, messageId, documentId: saved.documentId!, jobId: jobs[0]!.id };
  }

  const stopTyping = (jobId: string, secondsAgo = 120) =>
    db.prepare(
      `update briar_channel_agent_reply_jobs set created_at = ? where id = ?`,
    ).bind(
      new Date(Date.now() - secondsAgo * 1_000).toISOString(),
      jobId,
    ).run();

  async function claim() {
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
  }

  type Claimed = Awaited<ReturnType<typeof claim>>;

  const scope = async (reply: Claimed) => ({
    jobId: reply!.workId,
    workerId,
    deviceId,
    claimToken: reply!.claimToken,
    revocationEpoch: reply!.memory!.revocationEpoch,
  });

  const identity = (reply: Claimed) => ({
    projectId,
    workerId,
    work: {
      workId: reply!.workId,
      runId: reply!.workId,
      claimToken: reply!.claimToken,
      work: { case: "channelReply" as const, value: { organizationId } },
    },
    revocationEpoch: BigInt(reply!.memory!.revocationEpoch),
  });

  async function brief(reply: Claimed) {
    return getDmMemoryClaimBrief(db, env(), await scope(reply));
  }

  async function lookup(
    reply: Claimed,
    request: unknown,
    requestId = crypto.randomUUID(),
  ) {
    return lookupDmMemoryClaim(db, env(), await scope(reply), requestId, request, {
      store: null,
      minimumScore: null,
    });
  }

  const countLookups = (jobId: string) =>
    db.prepare(
      `select count(*) as count from briar_channel_reply_lookups where job_id = ?`,
    ).bind(jobId).first<{ count: number }>();

  it("M02/M25 binds server scope, injects a brief and permits only discovered detailed references", async () => {
    const f = await fixture();
    const reply = await claim();
    expect(reply!.memory).toMatchObject({
      protocol: 1,
      searchEnabled: true,
      revocationEpoch: 0,
    });
    expect((await brief(reply)).brief?.profile[0]).toMatchObject({
      documentId: f.documentId,
      version: 1,
      body: "설명은 한국어로 요청한다.",
    });
    expect(
      await lookup(reply, {
        operation: "get",
        documents: [{ documentId: f.documentId, version: 1 }],
      }),
    ).toMatchObject({
      operation: "get",
      documents: [{ status: "ok", body: "설명은 한국어로 요청한다." }],
    });
    expect(
      await lookup(reply, {
        operation: "get",
        documents: [{ documentId: crypto.randomUUID(), version: 1 }],
      }),
    ).toMatchObject({ documents: [{ status: "stale_reference" }] });
  });

  it("keeps discovered references when a steer resumes the same private conversation", async () => {
    const f = await fixture();
    const reply = (await claim())!;
    await brief(reply);
    await lookup(reply, {
      operation: "get", documents: [{ documentId: f.documentId, version: 1 }],
    });
    await db.prepare(`update briar_channel_agent_reply_jobs
      set status = 'queued', steer_revision = 1 where id = ?`).bind(reply.workId).run();
    await cleanupAbandonedReplyLookups(db, new Date().toISOString());
    const resumed = (await claim())!;
    const refs = await db.prepare(`select document_id, claim_token_hash
      from briar_dm_memory_discovered_refs where job_id = ?`).bind(reply.workId)
      .all<{ document_id: string; claim_token_hash: string }>();
    expect(refs.results).toContainEqual({ document_id: f.documentId,
      claim_token_hash: await sha256(resumed.claimToken) });
    expect(resumed.claimToken).not.toBe(reply.claimToken);
  });

  it("M12/M17 counts new turns, replays a lost response once and shares its limit with organization lookups", async () => {
    const f = await fixture();
    const reply = await claim();
    await brief(reply);
    const request = {
      operation: "get",
      documents: [{ documentId: f.documentId, version: 1 }],
    };
    const id = crypto.randomUUID();
    expect(await lookup(reply, request, id)).toEqual(await lookup(reply, request, id));
    expect(await countLookups(reply!.workId)).toEqual({ count: 1 });
    await lookup(reply, request);
    const reservation = await reserveReplyLookup(db, {
      jobId: reply!.workId,
      claimTokenHash: await sha256(reply!.claimToken),
      requestId: crypto.randomUUID(),
      kind: "organization",
      request: [{ resource: "project-settings", projectId }],
      memoryRevision: reply!.memory!.memoryRevision,
      revocationEpoch: reply!.memory!.revocationEpoch,
    });
    await replyLookupCompletionStatement(db, reservation, { synthetic: true }).run();
    await expect(lookup(reply, request)).rejects.toMatchObject({ code: "lookup_budget_exhausted" });
    expect(await countLookups(reply!.workId)).toEqual({ count: 3 });
  });

  it("M17 enforces six unique embedding queries even within three lookup turns", async () => {
    await fixture();
    const reply = await claim();
    await lookup(reply, { operation: "search", queries: ["first", "second", "third"] });
    await lookup(reply, { operation: "search", queries: ["fourth", "fifth", "sixth"] });
    await expect(
      lookup(reply, { operation: "search", queries: ["seventh"] }),
    ).rejects.toMatchObject({ code: "lookup_budget_exhausted" });
    expect(await lookup(reply, { operation: "search", queries: ["first"] }))
      .toMatchObject({ status: "unavailable", results: [] });
  });

  it("M07/M10 forgets cached bodies, rejects old activity and completion, and resumes with filtered context", async () => {
    const f = await fixture();
    const reply = await claim();
    await brief(reply);
    await lookup(reply, {
      operation: "get",
      documents: [{ documentId: f.documentId, version: 1 }],
    });
    await checkpointChannelReplySession(db, {
      jobId: reply!.workId,
      deviceId,
      workerId,
      claimTokenHash: await sha256(reply!.claimToken),
      conversationId: "synthetic-old-provider-session",
      observedAt: new Date().toISOString(),
    });
    const oldJob = (await getChannelAgentReplyJob(db, organizationId, reply!.workId))!;
    await createChannelActivityPublishToken(env().BETTER_AUTH_SECRET, {
      organizationId,
      channelId: reply!.channelId,
      replyJobId: reply!.workId,
      agentId,
      triggerMessageId: reply!.triggerMessageId,
      parentMessageId: reply!.parentMessageId,
      attempt: oldJob.attempts,
      claimTokenHash: await sha256(reply!.claimToken),
      workerId,
      deviceId,
      expiresAt: Date.now() + 60_000,
    });
    await deleteDmMemory(db, f.owner, f.documentId);
    expect(await countLookups(reply!.workId)).toEqual({ count: 0 });
    expect((await getChannelReplySession(db, reply!.session!.id))?.conversation_id).toBeNull();
    await expect(brief(reply)).rejects.toMatchObject({ code: "memory_scope_revoked" });
    expect(
      await completeChannelReply(db, oldJob, {
        jobId: reply!.workId,
        deviceId,
        workerId,
        claimTokenHash: await sha256(reply!.claimToken),
        body: "stale private answer",
        document: null,
        issueProposal: null,
        executionProposal: null,
        agentName: "Synthetic Agent",
        agentProvider: "claude",
        completedAt: new Date().toISOString(),
      }),
    ).toBeNull();
    const fresh = await claim();
    expect(fresh!.session?.conversationId).toBeNull();
    expect((await getChannelAgentReplyJob(db, organizationId, fresh!.workId))!.attempts)
      .toBeGreaterThan(oldJob.attempts);
    expect(fresh!.memory!.revocationEpoch).toBeGreaterThan(reply!.memory!.revocationEpoch);
    expect(fresh!.snapshot.messages).toEqual([]);
    expect((await getChannelMessage(db, reply!.channelId, f.messageId))?.body)
      .toBe("한국어 설명을 선호합니다.");
  });

  it("M06/M28 publishes only discovered citations and removes their links when forgotten", async () => {
    const f = await fixture();
    const reply = await claim();
    const job = (await getChannelAgentReplyJob(db, organizationId, reply!.workId))!;
    const completion = {
      jobId: reply!.workId,
      deviceId,
      workerId,
      claimTokenHash: await sha256(reply!.claimToken),
      body: "A synthetic cited answer",
      document: null,
      issueProposal: null,
      executionProposal: null,
      agentName: "Synthetic Agent",
      agentProvider: "claude" as const,
      completedAt: new Date().toISOString(),
      memoryCitations: [{ documentId: f.documentId, version: 1 }],
    };
    expect(await completeChannelReply(db, job, completion)).toBeNull();
    expect(await getChannelMessage(db, reply!.channelId, job.reply_message_id)).toBeNull();
    await brief(reply);
    expect(
      await completeChannelReply(db, job, {
        ...completion,
        memoryCitations: [{ documentId: crypto.randomUUID(), version: 1 }],
      }),
    ).toBeNull();
    expect(await completeChannelReply(db, job, completion)).not.toBeNull();
    expect((await getChannelMessage(db, reply!.channelId, job.reply_message_id))?.memoryCitations)
      .toEqual(completion.memoryCitations);
    await deleteDmMemory(db, f.owner, f.documentId);
    expect((await getChannelMessage(db, reply!.channelId, job.reply_message_id))?.memoryCitations)
      .toEqual([]);
  });

  it("atomically leaves a learning outbox only when the DM reply was actually published", async () => {
    const f = await fixture();
    const memory = await getDmMemory(db, f.owner, f.documentId);
    await updateDmMemorySettings(db, f.owner, {
      requestId: crypto.randomUUID(),
      memorySpaceId: memory.memorySpaceId,
      expectedMemoryRevision: 1,
      useEnabled: true,
      autoEnabled: true,
    }, { learningAvailable: true });
    const reply = await claim();
    const job = (await getChannelAgentReplyJob(db, organizationId, reply!.workId))!;
    const completion = {
      jobId: reply!.workId,
      deviceId,
      workerId,
      claimTokenHash: await sha256(reply!.claimToken),
      body: "Synthetic reply for durable learning",
      document: null,
      issueProposal: null,
      executionProposal: null,
      agentName: "Synthetic Agent",
      agentProvider: "claude" as const,
      completedAt: new Date().toISOString(),
    };
    expect(
      await completeChannelReply(db, job, { ...completion, claimTokenHash: "f".repeat(64) }),
    ).toBeNull();
    expect(
      await db.prepare(
        `select 1 from briar_dm_memory_learning_outbox where reply_job_id = ?`,
      ).bind(reply!.workId).first(),
    ).toBeNull();
    expect(await completeChannelReply(db, job, completion)).not.toBeNull();
    const outbox = await db.prepare(
      `select kind, source_end, available_at from briar_dm_memory_learning_outbox where reply_job_id = ?`,
    ).bind(reply!.workId).first<{ kind: string; source_end: number; available_at: string }>();
    expect(outbox?.kind).toBe("extract");
    expect(outbox!.source_end).toBeGreaterThan(0);
    expect(Date.parse(outbox!.available_at) - Date.parse(completion.completedAt)).toBe(15_000);
    expect(await completeChannelReply(db, job, completion)).toBeNull();
    expect(
      (await db.prepare(
        `select count(*) as count from briar_dm_memory_learning_outbox where reply_job_id = ?`,
      ).bind(reply!.workId).first<{ count: number }>())!.count,
    ).toBe(1);
  });

  it("M27 carries an explicit DM request through outbox, verification, storage and a fresh reply brief", async () => {
    const f = await fixture("앞으로 기술 설명은 결론부터 해 주세요. 기억해 주세요.");
    const reply = await claim();
    await brief(reply);
    const job = (await getChannelAgentReplyJob(db, organizationId, reply!.workId))!;
    expect(
      await completeChannelReply(db, job, {
        jobId: reply!.workId,
        deviceId,
        workerId,
        claimTokenHash: await sha256(reply!.claimToken),
        body: "기억 저장을 검토하고 있습니다.",
        document: null,
        issueProposal: null,
        executionProposal: null,
        agentName: "Synthetic Agent",
        agentProvider: "claude" as const,
        completedAt: new Date().toISOString(),
        memorySaveRequest: { documents: [] },
      }),
    ).not.toBeNull();
    expect(
      await db.prepare(
        `select kind, request_source_id, request_targets_json
         from briar_dm_memory_learning_outbox where reply_job_id = ?`,
      ).bind(reply!.workId).first(),
    ).toEqual({
      kind: "explicit_request",
      request_source_id: f.messageId,
      request_targets_json: "[]",
    });

    const now = new Date().toISOString();
    expect(await scheduleDmLearningJobs(db, organizationId, now)).toBe(1);
    const learning = await claimDmLearningJob(db, {
      organizationId,
      deviceId,
      workerId,
      projectId,
      now,
    });
    if (!learning) throw new Error("Synthetic explicit memory claim was not acquired");
    expect(learning.snapshot).toMatchObject({
      kind: "explicit_request",
      requestSource: { id: f.messageId },
      documents: [],
    });
    const claimIdentity = {
      organizationId,
      workerId,
      deviceId,
      jobId: learning.workId,
      claimTokenHash: await sha256(learning.claimToken),
    };
    const common = {
      identity: claimIdentity,
      policy: learning.snapshot.policy,
      inputHash: learning.inputHash,
      now,
    };
    const usage = { inputTokens: 100, outputTokens: 50, costMicroUsd: 0 };
    const proposal = {
      explicitRequest: true,
      changes: [syntheticDmLearningChange(learning.snapshot, {
        title: "응답 형식",
        content: "사용자는 설명을 결론부터 받기를 원한다.",
        sourceLanguage: "ko",
        sourceRefs: [learning.snapshot.requestSource!],
      })],
    };
    const proposalCall = crypto.randomUUID();
    await reserveDmLearningModelCall(db, { ...common, callId: proposalCall, stage: "proposing" });
    const proposed = await submitDmLearningProposal(db, {
      ...common,
      callId: proposalCall,
      proposal,
      usage,
    });
    if (!("proposalId" in proposed)) throw new Error("Synthetic proposal was not accepted");
    const verifyCall = crypto.randomUUID();
    await reserveDmLearningModelCall(db, { ...common, callId: verifyCall, stage: "verifying" });
    await submitDmLearningVerification(db, {
      ...common,
      callId: verifyCall,
      proposalId: proposed.proposalId,
      proposalHash: proposed.proposalHash,
      usage,
      verification: {
        approved: true,
        explicitRequestAuthorized: true,
        decisions: [{ changeId: "change-1", verdict: "supported" }],
      },
    });

    for (let index = 0; index < 12; index++) {
      await createChannelMessage(db, {
        id: crypto.randomUUID(),
        channelId: f.channelId,
        parentMessageId: null,
        authorUserId: ownerId,
        authorAgentId: null,
        authorAgentName: null,
        authorAgentProvider: null,
        body: `Synthetic intervening turn ${index}`,
        mentionedUserIds: [],
        mentionedAgentIds: [],
        createdAt: new Date().toISOString(),
      });
    }
    const trigger = crypto.randomUUID();
    const observed = new Date().toISOString();
    await createChannelMessage(db, {
      id: trigger,
      channelId: f.channelId,
      parentMessageId: null,
      authorUserId: ownerId,
      authorAgentId: null,
      authorAgentName: null,
      authorAgentProvider: null,
      body: "설명 순서를 적용해 주세요.",
      mentionedUserIds: [],
      mentionedAgentIds: [agentId],
      createdAt: observed,
    });
    const followUp = await enqueueChannelAgentReplies(db, {
      organizationId,
      channelId: f.channelId,
      triggerMessageId: trigger,
      parentMessageId: trigger,
      agents: [{ id: agentId, projectId: null, provider: "claude" }],
      createdAt: observed,
    });
    await stopTyping(followUp[0]!.id);
    const fresh = await claim();
    expect((await brief(fresh)).brief?.profile.some((item) => item.body.includes("결론부터")))
      .toBe(true);
  });

  it("M07 retains an activity revocation until its old attempt is actually cleared", async () => {
    const f = await fixture();
    const reply = await claim();
    const oldAttempt = (await getChannelAgentReplyJob(db, organizationId, reply!.workId))!.attempts;
    await deleteDmMemory(db, f.owner, f.documentId);
    const fresh = await claim();
    const failed = await flushDmMemoryActivityRevocations(db, env(), async () => {
      throw new Error("synthetic offline hub");
    });
    expect(failed.failed).toBeGreaterThan(0);
    type RevocationFrame = Parameters<
      NonNullable<Parameters<typeof flushDmMemoryActivityRevocations>[2]>
    >[2];
    const frames: RevocationFrame[] = [];
    await flushDmMemoryActivityRevocations(db, env(), async (_env, _org, frame) => {
      frames.push(frame);
    });
    const revoked = frames.find((frame) => frame.replyJobId === reply!.workId);
    expect(revoked).toMatchObject({ attempt: oldAttempt });
    expect(BigInt(revoked!.sequence)).toBe(BigInt(Number.MAX_SAFE_INTEGER));
    expect(revoked!.activity ?? null).toBeNull();
    expect((await getChannelAgentReplyJob(db, organizationId, fresh!.workId))!.attempts)
      .toBeGreaterThan(oldAttempt);
    expect(
      await db.prepare(
        `select 1 from briar_dm_memory_activity_revocations where id = ?`,
      ).bind(reply!.workId).first(),
    ).toBeNull();
  });

  it("M07/M28 drops private lookup payloads after an abandoned claim expires", async () => {
    const f = await fixture();
    const reply = await claim();
    await brief(reply);
    await lookup(reply, {
      operation: "get",
      documents: [{ documentId: f.documentId, version: 1 }],
    });
    await db.prepare(
      `update briar_channel_agent_reply_jobs set lease_expires_at = '2000-01-01T00:00:00Z' where id = ?`,
    ).bind(reply!.workId).run();
    await cleanupAbandonedReplyLookups(db, new Date().toISOString());
    expect((await countLookups(reply!.workId))?.count).toBe(0);
    expect(
      await db.prepare(
        `select 1 from briar_dm_memory_discovered_refs where job_id = ?`,
      ).bind(reply!.workId).first(),
    ).toBeNull();
  });

  it.each([
    { status: "queued", lease: null, retained: false },
    { status: "queued", lease: "2000-01-01T00:00:00.000Z", retained: false },
    { status: "completed", lease: null, retained: false },
    { status: "completed", lease: "2999-01-01T00:00:00.000Z", retained: false },
    { status: "queued", lease: "2999-01-01T00:00:00.000Z", retained: true },
  ])("cleans pending steer lookup records for $status / $lease (retained: $retained)", async ({ status, lease, retained }) => {
    const f = await fixture();
    const reply = (await claim())!;
    await brief(reply);
    await lookup(reply, {
      operation: "get", documents: [{ documentId: f.documentId, version: 1 }],
    });
    expect((await countLookups(reply.workId))?.count).toBe(1);
    const reference = () => db.prepare(
      `select 1 from briar_dm_memory_discovered_refs where job_id = ?`,
    ).bind(reply.workId).first();
    expect(await reference()).not.toBeNull();
    await db.prepare(`update briar_channel_agent_reply_jobs
      set status = ?, steer_revision = 1, applied_steer_revision = 0, lease_expires_at = ?
      where id = ?`).bind(status, lease, reply.workId).run();
    // The status trigger clears the original cache. Seed an abandoned record
    // after that transition so this exercises the scheduled cleanup itself.
    await db.prepare(`insert into briar_channel_reply_lookups
      (job_id, claim_token_hash, request_id, kind, lease_token, lease_expires_at, response_json, created_at)
      values (?, ?, ?, 'memory', ?, ?, '{}', ?)`)
      .bind(reply.workId, await sha256(reply.claimToken), crypto.randomUUID(),
        crypto.randomUUID(), new Date().toISOString(), new Date().toISOString()).run();

    await cleanupAbandonedReplyLookups(db, new Date().toISOString());

    expect((await countLookups(reply.workId))?.count).toBe(retained ? 1 : 0);
    if (retained) expect(await reference()).not.toBeNull();
    else expect(await reference()).toBeNull();
  });

  it("M24 expires before invocation without waiting for the scheduled sweep", async () => {
    const f = await fixture();
    const reply = await claim();
    await brief(reply);
    await db.prepare(
      `update briar_dm_memory_revisions set valid_until = '2000-01-01T00:00:00Z' where document_id = ?`,
    ).bind(f.documentId).run();
    await expect(requireDmMemoryReplyFence(db, reply!.workId))
      .rejects.toMatchObject({ code: "memory_scope_revoked" });
    expect((await getChannelAgentReplyJob(db, organizationId, reply!.workId))?.status)
      .toBe("queued");
  });

  it("M06 does not return another DM through forged detailed references or a foreign worker credential", async () => {
    await fixture();
    const reply = await claim();
    await brief(reply);
    const second = await fixture();
    expect(
      await lookup(reply, {
        operation: "get",
        documents: [{ documentId: second.documentId, version: 1 }],
      }),
    ).toMatchObject({ documents: [{ status: "stale_reference" }] });
    const foreign = createClient(
      WorkerQueueService,
      createRouterTransport((router) =>
        router.service(
          WorkerQueueService,
          createWorkerQueueService({
            request: new Request("https://briar.example", {
              headers: { authorization: "Bearer briar_worker_unenrolled" },
            }),
            db,
            env: env(),
          }),
        )
      ),
    );
    await expect(foreign.getDmMemoryBrief({ claim: identity(reply) })).rejects.toThrow();
  });

  it("M16 prevents an unsupported Worker from resuming a conversation that held memories", async () => {
    const f = await fixture();
    const reply = await claim();
    await checkpointChannelReplySession(db, {
      jobId: reply!.workId,
      workerId,
      deviceId,
      claimTokenHash: await sha256(reply!.claimToken),
      conversationId: "synthetic-private-provider-id",
      observedAt: new Date().toISOString(),
    });
    await db.prepare(
      `update briar_channel_agent_reply_jobs set status = 'queued', claim_token_hash = null where id = ?`,
    ).bind(reply!.workId).run();
    const legacy = JSON.parse(runtimeJson) as {
      capabilities?: Record<string, unknown>;
    };
    delete legacy.capabilities?.dmMemoryProtocol;
    await db.prepare(
      `update briar_execution_workers set runtime_proto_json = ? where id = ?`,
    ).bind(JSON.stringify(legacy), workerId).run();
    const oldWorkerReply = await claim();
    expect(oldWorkerReply!.memory).toBeNull();
    expect(oldWorkerReply!.session?.conversationId).toBeNull();
    expect((await getDmMemory(db, f.owner, f.documentId)).body).toBe("설명은 한국어로 요청한다.");
  });
});
