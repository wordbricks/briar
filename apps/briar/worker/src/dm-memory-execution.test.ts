import type { ChannelAgentActivityFrame } from "../../src/lib/channel-agent-activity";
import { flushDmMemoryActivityRevocations } from "./dm-memory-activity-revocations";
import * as Schema from "effect/Schema";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { channelReplyClaimTokenHeader } from "../../src/lib/channels-contract";
import { dmMemoryBriefResponseSchema, dmMemoryLookupResponseSchema } from "../../src/lib/dm-memory-query-contract";
import { decodeClaimedChannelReply, type ClaimedChannelReply } from "../../src-cli/worker-claim-contract";
import { createChannelActivityPublishToken } from "./channel-activity-ticket";
import { cleanupAbandonedReplyLookups, reserveReplyLookup, replyLookupCompletionStatement } from "./channel-reply-lookup-budget";
import { claimNextChannelReplyWork } from "./channel-reply-claim-routes";
import { handleChannelReplyResultRoute } from "./channel-reply-result-routes";
import { checkpointChannelReplySession, completeChannelReply, createChannel, createChannelMessage,
  enqueueChannelAgentReplies, getChannelAgentReplyJob, getChannelMessage, getChannelReplySession } from "./channels";
import { sha256 } from "./crypto-digest";
import { handleDmMemoryClaimRoute } from "./dm-memory-claim-routes";
import { requireDmMemoryReplyFence } from "./dm-memory-reply-fence";
import { claimDmLearningJob } from "./dm-memory-learning-claims";
import { reserveDmLearningModelCall, submitDmLearningProposal, submitDmLearningVerification } from "./dm-memory-learning-model-calls";
import { scheduleDmLearningJobs } from "./dm-memory-learning-queue";
import { deleteDmMemory, getDmMemory, saveDmMemory, updateDmMemorySettings } from "./dm-memory-repository";
import { createOrganizationAgent } from "./organization-agents";
import { createIsolatedTestDatabase } from "./test-helpers/d1";
import { syntheticDmLearningChange, syntheticDmLearningPolicy } from "./test-helpers/dm-memory-learning";

describe("DM memory in active channel claims", () => {
  let db: D1Database;
  let dispose: () => Promise<void>;
  const organizationId = crypto.randomUUID(), projectId = crypto.randomUUID(), ownerId = crypto.randomUUID();
  const agentId = crypto.randomUUID(), workerId = crypto.randomUUID(), deviceId = crypto.randomUUID();
  const workerToken = "briar_worker_synthetic-memory-execution";
  const capabilities = { providers: ["claude"], providerHealth: { claude: { healthy: true } },
    organizationAgentContext: { protocol: 1 }, dmMemory: { protocol: 1 } };
  const env = () => ({ DB: db, BETTER_AUTH_SECRET: "synthetic-memory-activity-secret-with-enough-length",
    DM_MEMORY_RETRIEVAL_ENABLED: String("true"), DM_MEMORY_MINIMUM_SCORE: "" }) as Env;
  const workerRequest = (path: string, body?: unknown, token = workerToken) => new Request(`https://briar.example${path}`, {
    method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  beforeAll(async () => {
    const database = await createIsolatedTestDatabase({ suite: "dm-memory-execution" });
    db = database.db; dispose = database.dispose;
    const now = new Date().toISOString();
    await db.batch([
      db.prepare(`insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
        values (?, 'Synthetic owner', ?, 1, ?, ?)`).bind(ownerId, `${ownerId}@example.com`, now, now),
      db.prepare(`insert into briar_organizations (id, name, handle, created_at, updated_at)
        values (?, 'Synthetic memory execution', ?, ?, ?)`).bind(organizationId, organizationId, now, now),
      db.prepare(`insert into briar_organization_members (organization_id, user_id, role, created_at, updated_at)
        values (?, ?, 'owner', ?, ?)`).bind(organizationId, ownerId, now, now),
      db.prepare(`insert into briar_teams (id, owner_user_id, organization_id, name, agent_token_hash, created_at, updated_at)
        values (?, ?, ?, 'Synthetic project', ?, ?, ?)`).bind(projectId, ownerId, organizationId, "a".repeat(64), now, now),
      db.prepare(`insert into briar_execution_worker_devices
        (id, organization_id, owner_user_id, label, device_identity_hash, state, last_heartbeat_at, created_at, updated_at)
        values (?, ?, ?, 'Synthetic device', ?, 'online', ?, ?, ?)`)
        .bind(deviceId, organizationId, ownerId, "b".repeat(64), now, now, now),
      db.prepare(`insert into briar_execution_worker_credentials (device_id, token_hash, created_at) values (?, ?, ?)`)
        .bind(deviceId, await sha256(workerToken), now),
      db.prepare(`insert into briar_execution_workers
        (id, project_id, label, host_fingerprint, agent_provider, state, accepting_work, readiness_state,
         capabilities_json, last_heartbeat_at, created_at, updated_at, device_id)
        values (?, ?, 'Synthetic worker', ?, 'claude', 'online', 1, 'ready', ?, ?, ?, ?, ?)`)
        .bind(workerId, projectId, "c".repeat(64), JSON.stringify(capabilities), now, now, now, deviceId),
    ]);
    await createOrganizationAgent(db, { id: agentId, organizationId, name: "Synthetic Agent", provider: "claude",
      model: null, responsibility: "Memory execution tests", effort: null, createdAt: now });
  }, 120_000);
  afterAll(async () => { await dispose?.(); });
  beforeEach(async () => {
    await db.prepare("update briar_channel_agent_reply_jobs set status = 'failed' where status in ('queued', 'running')").run();
    await db.prepare("update briar_execution_workers set capabilities_json = ? where id = ?")
      .bind(JSON.stringify(capabilities), workerId).run();
  });
  async function fixture(messageBody = "한국어 설명을 선호합니다.") {
    const channelId = crypto.randomUUID(), messageId = crypto.randomUUID();
    const now = new Date().toISOString();
    const owner = { organizationId, channelId, userId: ownerId };
    await createChannel(db, { id: channelId, organizationId, kind: "dm", slug: channelId, name: "Synthetic DM",
      visibility: "private", topic: null, defaultProjectId: null, createdByUserId: ownerId, agentIds: [agentId], createdAt: now });
    await createChannelMessage(db, { id: messageId, channelId, parentMessageId: null, authorUserId: ownerId,
      authorAgentId: null, authorAgentName: null, authorAgentProvider: null, body: messageBody,
      mentionedUserIds: [], mentionedAgentIds: [agentId], createdAt: now });
    const saved = await saveDmMemory(db, owner, { requestId: crypto.randomUUID(), title: "설명 언어",
      body: "설명은 한국어로 요청한다.", memoryClass: "profile", sourceLanguage: "ko", observedAt: now,
      validUntil: null, sourceMessage: { id: messageId, version: 1 } });
    const jobs = await enqueueChannelAgentReplies(db, { organizationId, channelId, triggerMessageId: messageId,
      parentMessageId: messageId, agents: [{ id: agentId, projectId: null, provider: "claude" }], createdAt: now });
    return { owner, messageId, documentId: saved.documentId!, jobId: jobs[0]!.id };
  }
  async function claim() {
    const response = await claimNextChannelReplyWork({ request: workerRequest("/channel-reply-claims", { organizationId, workerId }),
      input: { organizationId, workerId }, db, env: env() });
    const payload = Schema.decodeUnknownSync(Schema.Struct({ work: Schema.Unknown }))(await response.json());
    return decodeClaimedChannelReply(payload.work);
  }
  async function lookup(reply: ClaimedChannelReply, request: unknown, requestId = crypto.randomUUID()) {
    const req = workerRequest(`/organizations/${organizationId}/channel-reply-claims/${reply.workId}/memory/lookup`, {
      workerId, requestId, revocationEpoch: reply.memory!.revocationEpoch, request,
    });
    req.headers.set(channelReplyClaimTokenHeader, reply.claimToken);
    const response = await handleDmMemoryClaimRoute({ request: req, url: new URL(req.url), db, env: env(),
      retrieval: { store: null, minimumScore: null } });
    return Schema.decodeUnknownSync(dmMemoryLookupResponseSchema)(await response!.json());
  }
  async function brief(reply: ClaimedChannelReply) {
    const req = workerRequest(`/organizations/${organizationId}/channel-reply-claims/${reply.workId}/memory/brief?workerId=${workerId}&revocationEpoch=${reply.memory!.revocationEpoch}`);
    req.headers.set(channelReplyClaimTokenHeader, reply.claimToken);
    const response = await handleDmMemoryClaimRoute({ request: req, url: new URL(req.url), db, env: env() });
    return Schema.decodeUnknownSync(dmMemoryBriefResponseSchema)(await response!.json());
  }
  const countLookups = (jobId: string) => db.prepare("select count(*) as count from briar_channel_reply_lookups where job_id = ?")
    .bind(jobId).first<{ count: number }>();

  it("M02/M25 binds server scope, injects a brief and permits only discovered detailed references", async () => {
    const f = await fixture(), reply = await claim();
    expect(reply.memory).toMatchObject({ protocol: 1, searchEnabled: true, revocationEpoch: 0 });
    expect((await brief(reply)).brief?.profile[0]).toMatchObject({ documentId: f.documentId, version: 1, body: "설명은 한국어로 요청한다." });
    expect(await lookup(reply, { operation: "get", documents: [{ documentId: f.documentId, version: 1 }] }))
      .toMatchObject({ operation: "get", documents: [{ status: "ok", body: "설명은 한국어로 요청한다." }] });
    expect(await lookup(reply, { operation: "get", documents: [{ documentId: crypto.randomUUID(), version: 1 }] }))
      .toMatchObject({ documents: [{ status: "stale_reference" }] });
  });
  it("M27 carries an explicit DM request through outbox, verification, storage and a fresh reply brief", async () => {
    const f = await fixture("앞으로 기술 설명은 결론부터 해 주세요. 기억해 주세요.");
    const learningCapabilities = { ...capabilities, dmMemory: { protocol: 1, learningRequests: 1 },
      dmMemoryLearning: { protocol: 1, transport: "openrouter" } };
    await db.prepare("update briar_execution_workers set capabilities_json = ? where id = ?")
      .bind(JSON.stringify(learningCapabilities), workerId).run();
    const reply = await claim(); await brief(reply);
    const learningEnv = { ...env(), DM_MEMORY_LEARNING_ENABLED: "true",
      DM_MEMORY_LEARNING_POLICIES: JSON.stringify({ [organizationId]: syntheticDmLearningPolicy }) } as unknown as Env;
    const complete = workerRequest(`/channel-reply-claims/${reply.workId}/complete`, {
      organizationId, workerId, claimToken: reply.claimToken, conversationId: null,
      result: { body: "기억 저장을 검토하고 있습니다.", memorySaveRequest: { documents: [] } },
    });
    const completed = await handleChannelReplyResultRoute({ request: complete, url: new URL(complete.url), db,
      env: learningEnv, attachmentsBucket: learningEnv.ATTACHMENTS });
    expect(completed?.status).toBe(200);
    expect(await db.prepare(`select kind, request_source_id, request_targets_json from briar_dm_memory_learning_outbox
      where reply_job_id = ?`).bind(reply.workId).first()).toEqual({
      kind: "explicit_request", request_source_id: f.messageId, request_targets_json: "[]",
    });
    const now = new Date().toISOString();
    expect(await scheduleDmLearningJobs(db, organizationId, syntheticDmLearningPolicy, now)).toBe(1);
    const learning = await claimDmLearningJob(db, { organizationId, deviceId, workerId, projectId,
      policy: syntheticDmLearningPolicy, now });
    expect(learning?.snapshot).toMatchObject({ kind: "explicit_request", requestSource: { id: f.messageId }, documents: [] });
    if (!learning) throw new Error("Synthetic explicit memory claim was not acquired");
    const identity = { organizationId, workerId, deviceId, jobId: learning.workId,
      claimTokenHash: await sha256(learning.claimToken) };
    const common = { identity, policy: syntheticDmLearningPolicy, inputHash: learning.inputHash, now };
    const usage = { inputTokens: 100, outputTokens: 50, costMicroUsd: 100 };
    const proposal = { explicitRequest: true, changes: [syntheticDmLearningChange(learning.snapshot, {
      title: "응답 형식", content: "사용자는 설명을 결론부터 받기를 원한다.",
      sourceLanguage: "ko", sourceRefs: [learning.snapshot.requestSource!],
    })] };
    const proposalCall = crypto.randomUUID();
    await reserveDmLearningModelCall(db, { ...common, callId: proposalCall, stage: "proposing" });
    const proposed = await submitDmLearningProposal(db, { ...common, callId: proposalCall, proposal, usage });
    if (!("proposalId" in proposed)) throw new Error("Synthetic proposal was not accepted");
    const verifyCall = crypto.randomUUID();
    await reserveDmLearningModelCall(db, { ...common, callId: verifyCall, stage: "verifying" });
    await submitDmLearningVerification(db, { ...common, callId: verifyCall, proposalId: proposed.proposalId,
      proposalHash: proposed.proposalHash, usage, verification: { approved: true, explicitRequestAuthorized: true,
        decisions: [{ changeId: "change-1", verdict: "supported" }] } });
    for (let index = 0; index < 12; index++) {
      await createChannelMessage(db, { id: crypto.randomUUID(), channelId: reply.channelId, parentMessageId: null,
        authorUserId: ownerId, authorAgentId: null, authorAgentName: null, authorAgentProvider: null,
        body: `Synthetic intervening turn ${index}`, mentionedUserIds: [], mentionedAgentIds: [], createdAt: new Date().toISOString() });
    }
    const trigger = crypto.randomUUID(), observed = new Date().toISOString();
    await createChannelMessage(db, { id: trigger, channelId: reply.channelId, parentMessageId: null, authorUserId: ownerId,
      authorAgentId: null, authorAgentName: null, authorAgentProvider: null, body: "설명 순서를 적용해 주세요.",
      mentionedUserIds: [], mentionedAgentIds: [agentId], createdAt: observed });
    await enqueueChannelAgentReplies(db, { organizationId, channelId: reply.channelId, triggerMessageId: trigger,
      parentMessageId: trigger, agents: [{ id: agentId, projectId: null, provider: "claude" }], createdAt: observed });
    const fresh = await claim();
    expect(fresh.session?.conversationId).toBeNull();
    expect((await brief(fresh)).brief?.profile.some((item) => item.body.includes("결론부터"))).toBe(true);
  });
  it("M12/M17 counts new turns, replays a lost response once and shares its limit with organization lookups", async () => {
    const f = await fixture(), reply = await claim(); await brief(reply);
    const request = { operation: "get", documents: [{ documentId: f.documentId, version: 1 }] };
    const id = crypto.randomUUID();
    expect(await lookup(reply, request, id)).toEqual(await lookup(reply, request, id));
    expect(await countLookups(reply.workId)).toEqual({ count: 1 });
    await lookup(reply, request);
    const reservation = await reserveReplyLookup(db, { jobId: reply.workId, claimTokenHash: await sha256(reply.claimToken),
      requestId: crypto.randomUUID(), kind: "organization", request: [{ resource: "project-settings", projectId }],
      memoryRevision: reply.memory!.memoryRevision, revocationEpoch: reply.memory!.revocationEpoch });
    await replyLookupCompletionStatement(db, reservation, { synthetic: true }).run();
    await expect(lookup(reply, request)).rejects.toMatchObject({ code: "lookup_budget_exhausted" });
    expect(await countLookups(reply.workId)).toEqual({ count: 3 });
  });
  it("M17 enforces six unique embedding queries even within three lookup turns", async () => {
    await fixture(); const reply = await claim();
    await lookup(reply, { operation: "search", queries: ["first", "second", "third"] });
    await lookup(reply, { operation: "search", queries: ["fourth", "fifth", "sixth"] });
    await expect(lookup(reply, { operation: "search", queries: ["seventh"] })).rejects.toMatchObject({ code: "lookup_budget_exhausted" });
    expect(await lookup(reply, { operation: "search", queries: ["first"] })).toMatchObject({ status: "unavailable", results: [] });
  });
  it("M07/M10 forgets cached bodies, rejects old activity/completion and resumes with filtered conversation context", async () => {
    const f = await fixture(), reply = await claim(); await brief(reply);
    await lookup(reply, { operation: "get", documents: [{ documentId: f.documentId, version: 1 }] });
    await checkpointChannelReplySession(db, { jobId: reply.workId, deviceId, workerId,
      claimTokenHash: await sha256(reply.claimToken), conversationId: "synthetic-old-provider-session", observedAt: new Date().toISOString() });
    const oldJob = (await getChannelAgentReplyJob(db, organizationId, reply.workId))!;
    const activity = await createChannelActivityPublishToken(env().BETTER_AUTH_SECRET, { organizationId, channelId: reply.channelId,
      replyJobId: reply.workId, agentId, triggerMessageId: reply.triggerMessageId, parentMessageId: reply.parentMessageId,
      attempt: oldJob.attempts, claimTokenHash: await sha256(reply.claimToken), workerId, deviceId, expiresAt: Date.now() + 60_000 });
    await deleteDmMemory(db, f.owner, f.documentId);
    expect(await countLookups(reply.workId)).toEqual({ count: 0 });
    expect((await getChannelReplySession(db, reply.session!.id))?.conversation_id).toBeNull();
    await expect(brief(reply)).rejects.toMatchObject({ code: "memory_scope_revoked" });
    const req = workerRequest(`/channel-reply-claims/${reply.workId}/activity`, { sequence: 1, activity: null });
    req.headers.set("X-Briar-Channel-Activity-Token", activity.token);
    await expect(handleChannelReplyResultRoute({ request: req, url: new URL(req.url), db,
      env: env(), attachmentsBucket: env().ATTACHMENTS })).rejects.toMatchObject({ code: "memory_scope_revoked" });
    expect(await completeChannelReply(db, oldJob, { jobId: reply.workId, deviceId, workerId, claimTokenHash: await sha256(reply.claimToken),
      body: "stale private answer", document: null, issueProposal: null, executionProposal: null,
      agentName: "Synthetic Agent", agentProvider: "claude", completedAt: new Date().toISOString() })).toBeNull();
    const fresh = await claim();
    expect(fresh.session?.conversationId).toBeNull();
    expect((await getChannelAgentReplyJob(db, organizationId, fresh.workId))!.attempts).toBeGreaterThan(oldJob.attempts);
    await expect(handleChannelReplyResultRoute({ request: new Request(req.url, { method: "POST", headers: req.headers, body: JSON.stringify({ sequence: 2, activity: null }) }), url: new URL(req.url), db,
      env: env(), attachmentsBucket: env().ATTACHMENTS })).rejects.toMatchObject({ status: 409 });
    expect(fresh.memory!.revocationEpoch).toBeGreaterThan(reply.memory!.revocationEpoch);
    expect(fresh.snapshot.messages).toEqual([]);
    expect((await getChannelMessage(db, reply.channelId, f.messageId))?.body).toBe("한국어 설명을 선호합니다.");
  });
  it("M06/M28 publishes only discovered citations and removes their links when forgotten", async () => {
    const f = await fixture(), reply = await claim();
    const job = (await getChannelAgentReplyJob(db, organizationId, reply.workId))!;
    const completion = { jobId: reply.workId, deviceId, workerId, claimTokenHash: await sha256(reply.claimToken),
      body: "A synthetic cited answer", document: null, issueProposal: null, executionProposal: null,
      agentName: "Synthetic Agent", agentProvider: "claude" as const, completedAt: new Date().toISOString(),
      memoryCitations: [{ documentId: f.documentId, version: 1 }] };
    expect(await completeChannelReply(db, job, completion)).toBeNull();
    expect(await getChannelMessage(db, reply.channelId, job.reply_message_id)).toBeNull();
    await brief(reply);
    expect(await completeChannelReply(db, job, { ...completion,
      memoryCitations: [{ documentId: crypto.randomUUID(), version: 1 }] })).toBeNull();
    expect(await completeChannelReply(db, job, completion)).not.toBeNull();
    expect((await getChannelMessage(db, reply.channelId, job.reply_message_id))?.memoryCitations)
      .toEqual(completion.memoryCitations);
    await deleteDmMemory(db, f.owner, f.documentId);
    expect((await getChannelMessage(db, reply.channelId, job.reply_message_id))?.memoryCitations).toEqual([]);
  });
  it("atomically leaves a learning outbox only when the DM reply was actually published", async () => {
    const f = await fixture();
    const memory = await getDmMemory(db, f.owner, f.documentId);
    await updateDmMemorySettings(db, f.owner, { requestId: crypto.randomUUID(), memorySpaceId: memory.memorySpaceId,
      expectedMemoryRevision: 1, useEnabled: true, autoEnabled: true }, { learningAvailable: true });
    const reply = await claim(), job = (await getChannelAgentReplyJob(db, organizationId, reply.workId))!;
    const completion = { jobId: reply.workId, deviceId, workerId, claimTokenHash: await sha256(reply.claimToken),
      body: "Synthetic reply for durable learning", document: null, issueProposal: null, executionProposal: null,
      agentName: "Synthetic Agent", agentProvider: "claude" as const, completedAt: new Date().toISOString() };
    expect(await completeChannelReply(db, job, { ...completion, claimTokenHash: "f".repeat(64) })).toBeNull();
    expect(await db.prepare("select 1 from briar_dm_memory_learning_outbox where reply_job_id = ?").bind(reply.workId).first()).toBeNull();
    expect(await completeChannelReply(db, job, completion)).not.toBeNull();
    const outbox = await db.prepare("select kind, source_end, available_at from briar_dm_memory_learning_outbox where reply_job_id = ?")
      .bind(reply.workId).first<{ kind: string; source_end: number; available_at: string }>();
    expect(outbox?.kind).toBe("extract");
    expect(outbox!.source_end).toBeGreaterThan(0);
    expect(Date.parse(outbox!.available_at) - Date.parse(completion.completedAt)).toBe(15_000);
    expect(await completeChannelReply(db, job, completion)).toBeNull();
    expect((await db.prepare("select count(*) as count from briar_dm_memory_learning_outbox where reply_job_id = ?")
      .bind(reply.workId).first<{ count: number }>())!.count).toBe(1);
  });
  it("M07 retains an activity revocation until its old attempt is actually cleared", async () => {
    const f = await fixture(), reply = await claim();
    const oldAttempt = (await getChannelAgentReplyJob(db, organizationId, reply.workId))!.attempts;
    await deleteDmMemory(db, f.owner, f.documentId);
    const fresh = await claim();
    const failed = await flushDmMemoryActivityRevocations(db, env(), async () => { throw new Error("synthetic offline hub"); });
    expect(failed.failed).toBeGreaterThan(0);
    const frames: ChannelAgentActivityFrame[] = [];
    await flushDmMemoryActivityRevocations(db, env(), async (_env, _org, frame) => { frames.push(frame); });
    expect(frames.find((frame) => frame.replyJobId === reply.workId))
      .toMatchObject({ attempt: oldAttempt, activity: null, sequence: Number.MAX_SAFE_INTEGER });
    expect((await getChannelAgentReplyJob(db, organizationId, fresh.workId))!.attempts).toBeGreaterThan(oldAttempt);
    expect(await db.prepare("select 1 from briar_dm_memory_activity_revocations where id = ?").bind(reply.workId).first()).toBeNull();
  });
  it("M07/M28 drops private lookup payloads after an abandoned claim expires", async () => {
    const f = await fixture(), reply = await claim(); await brief(reply);
    await lookup(reply, { operation: "get", documents: [{ documentId: f.documentId, version: 1 }] });
    await db.prepare("update briar_channel_agent_reply_jobs set lease_expires_at = '2000-01-01T00:00:00Z' where id = ?")
      .bind(reply.workId).run();
    await cleanupAbandonedReplyLookups(db, new Date().toISOString());
    expect((await countLookups(reply.workId))?.count).toBe(0);
    expect(await db.prepare("select 1 from briar_dm_memory_discovered_refs where job_id = ?").bind(reply.workId).first()).toBeNull();
  });
  it("M24 expires before invocation without waiting for the scheduled sweep", async () => {
    const f = await fixture(), reply = await claim(); await brief(reply);
    await db.prepare("update briar_dm_memory_revisions set valid_until = '2000-01-01T00:00:00Z' where document_id = ?")
      .bind(f.documentId).run();
    await expect(requireDmMemoryReplyFence(db, reply.workId)).rejects.toMatchObject({ code: "memory_scope_revoked" });
    expect((await getChannelAgentReplyJob(db, organizationId, reply.workId))?.status).toBe("queued");
  });
  it("M06 does not return another DM through forged detailed references or a foreign worker credential", async () => {
    const first = await fixture(); const reply = await claim(); await brief(reply);
    const second = await fixture();
    expect(await lookup(reply, { operation: "get", documents: [{ documentId: second.documentId, version: 1 }] }))
      .toMatchObject({ documents: [{ status: "stale_reference" }] });
    const req = workerRequest(`/organizations/${organizationId}/channel-reply-claims/${first.jobId}/memory/brief?workerId=${workerId}&revocationEpoch=0`, undefined, "briar_worker_unenrolled");
    req.headers.set(channelReplyClaimTokenHeader, reply.claimToken);
    await expect(handleDmMemoryClaimRoute({ request: req, url: new URL(req.url), db, env: env() })).rejects.toMatchObject({ status: 401 });
  });
  it("M16 prevents an unsupported Worker from resuming a conversation that held memories", async () => {
    const f = await fixture(), reply = await claim();
    await checkpointChannelReplySession(db, { jobId: reply.workId, workerId, deviceId,
      claimTokenHash: await sha256(reply.claimToken), conversationId: "synthetic-private-provider-id", observedAt: new Date().toISOString() });
    await db.prepare("update briar_channel_agent_reply_jobs set status = 'queued', claim_token_hash = null where id = ?").bind(reply.workId).run();
    const { dmMemory: _memory, ...legacy } = capabilities;
    await db.prepare("update briar_execution_workers set capabilities_json = ? where id = ?").bind(JSON.stringify(legacy), workerId).run();
    const oldWorkerReply = await claim();
    expect(oldWorkerReply.memory).toBeNull();
    expect(oldWorkerReply.session?.conversationId).toBeNull();
    expect((await getDmMemory(db, f.owner, f.documentId)).body).toBe("설명은 한국어로 요청한다.");
  });
});
