import { env } from "cloudflare:workers";
import { createClient, createRouterTransport } from "@connectrpc/connect";
import { WorkerQueueService } from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runClaimedDmMemory } from "../../src-cli/dm-memory-learning";
import { invokeDmLearningModel } from "../../src-cli/dm-memory-learning-model";
import { createChannel, createChannelMessage } from "./channels";
import { sha256 } from "./crypto-digest";
import { claimDmLearningJob } from "./dm-memory-learning-claims";
import { captureDmLearningInput, type DmLearningJobRow, type DmLearningSpaceRow } from "./dm-memory-learning-input";
import { scheduleDmLearningJobs } from "./dm-memory-learning-queue";
import { retryDmLearningJob } from "./dm-memory-learning-retry";
import { cleanupDmLearningPayloads, reapDmLearningClaims } from "./dm-memory-learning-maintenance";
import { reserveDmLearningModelCall, submitDmLearningProposal, submitDmLearningVerification } from "./dm-memory-learning-model-calls";
import { countExecutionWorkerDeviceSessions } from "./workers";
import { reconcileDmMemory } from "./dm-memory-indexing";
import { deleteDmMemory, getDmMemory, listDmMemories, saveDmMemory, updateDmMemorySettings } from "./dm-memory-repository";
import { createOrganizationAgent } from "./organization-agents";
import { syntheticAgentDmLearningPolicy, syntheticDmLearningChange,
  syntheticDmLearningPolicy } from "./test-helpers/dm-memory-learning";
import { workerRuntimeProtoJsonFixture } from "./test-helpers/worker-runtime";
import { createWorkerQueueService } from "./worker-connect-queue";

describe("durable DM learning inputs and deletion", () => {
  const db = env.DB;
  const organizationId = crypto.randomUUID(), userId = crypto.randomUUID(), agentId = crypto.randomUUID();
  const projectId = crypto.randomUUID(), workerId = crypto.randomUUID(), deviceId = crypto.randomUUID();
  const workerToken = `briar_worker_${crypto.randomUUID().replaceAll("-", "")}`;
  const now = "2026-09-01T00:00:00.000Z";
  beforeAll(async () => {
    await db.batch([
      db.prepare(`insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
        values (?, 'Synthetic memory owner', ?, 1, ?, ?)`).bind(userId, `${userId}@example.com`, now, now),
      db.prepare(`insert into briar_organizations (id, name, handle, created_at, updated_at)
        values (?, 'Synthetic memory organization', ?, ?, ?)`).bind(organizationId, organizationId, now, now),
      db.prepare(`insert into briar_organization_members (organization_id, user_id, role, created_at, updated_at)
        values (?, ?, 'owner', ?, ?)`).bind(organizationId, userId, now, now),
      db.prepare(`insert into briar_teams(id, owner_user_id, organization_id, name, agent_token_hash, created_at, updated_at)
        values (?, ?, ?, 'Synthetic project', ?, ?, ?)`)
        .bind(projectId, userId, organizationId, "b".repeat(64), now, now),
      db.prepare(`insert into briar_execution_worker_devices
        (id, organization_id, owner_user_id, label, device_identity_hash, state, last_heartbeat_at, created_at, updated_at)
        values (?, ?, ?, 'Synthetic device', ?, 'online', ?, ?, ?)`)
        .bind(deviceId, organizationId, userId, "b".repeat(64), now, now, now),
      db.prepare(`insert into briar_execution_workers
        (id, project_id, label, host_fingerprint, runtime_proto_json, state, accepting_work, readiness_state,
          last_heartbeat_at, created_at, updated_at, device_id)
        values (?, ?, 'Synthetic Worker', ?, ?, 'online', 1, 'ready', ?, ?, ?, ?)`)
        .bind(workerId, projectId, "c".repeat(64), workerRuntimeProtoJsonFixture({
          agentProvider: "claude", providers: ["claude"], dmMemoryLearning: true,
        }), now, now, now, deviceId),
    ]);
    await createOrganizationAgent(db, { id: agentId, organizationId, name: "Synthetic memory agent", provider: "claude",
      model: null, effort: null, responsibility: "Synthetic tests only", createdAt: now });
    await db.prepare(`insert into briar_execution_worker_credentials(device_id, token_hash, created_at) values (?, ?, ?)`)
      .bind(deviceId, await sha256(workerToken), now).run();
  }, 120_000);
  beforeEach(async () => {
    await db.prepare(`update briar_dm_memory_jobs set status = 'failed'
      where kind in ('extract', 'explicit_request', 'consolidate') and status in ('pending', 'running', 'retry_wait')`).run();
  });
  const memory = (body: string) => ({ requestId: crypto.randomUUID(), title: "Synthetic preference", body,
    memoryClass: "profile" as const, sourceLanguage: "en", observedAt: now, validUntil: null });
  async function fixture() {
    const channelId = crypto.randomUUID(), owner = { organizationId, channelId, userId };
    await createChannel(db, { id: channelId, organizationId, kind: "dm", dmKey: null, slug: channelId, name: "Synthetic DM",
      visibility: "private", topic: null, defaultProjectId: null, createdByUserId: userId, agentIds: [agentId], createdAt: now });
    const saved = await saveDmMemory(db, owner, memory("Start with a conclusion."));
    const spaceId = (await getDmMemory(db, owner, saved.documentId!)).memorySpaceId;
    return { owner, spaceId, documentId: saved.documentId! };
  }
  async function message(channelId: string, body: string, createdAt = now) {
    const id = crypto.randomUUID();
    await createChannelMessage(db, { id, channelId, parentMessageId: null, authorUserId: userId,
      authorAgentId: null, authorAgentName: null, authorAgentProvider: null, body,
      mentionedUserIds: [], mentionedAgentIds: [], createdAt });
    return id;
  }
  async function enable(spaceId: string) {
    await db.prepare(`update briar_dm_memory_spaces set auto_enabled = 1, auto_enabled_at = ?, updated_at = ? where id = ?`)
      .bind(now, now, spaceId).run();
  }
  async function outbox(spaceId: string, availableAt: string) {
    await db.prepare(`insert into briar_dm_memory_learning_outbox
      (reply_job_id, space_id, kind, source_end, revocation_epoch, available_at, created_at)
      select ?, space.id, 'extract', (select max(sequence) from briar_dm_memory_source_events where space_id = space.id),
        space.revocation_epoch, ?, ? from briar_dm_memory_spaces space where space.id = ?`)
      .bind(crypto.randomUUID(), availableAt, now, spaceId).run();
  }
  async function job(spaceId: string): Promise<DmLearningJobRow> {
    return (await db.prepare(`select * from briar_dm_memory_jobs where space_id = ? and kind = 'extract' order by created_at limit 1`)
      .bind(spaceId).first<DmLearningJobRow>())!;
  }
  async function seedPrivateJob(spaceId: string, rootId: string) {
    const jobId = crypto.randomUUID(), callId = crypto.randomUUID();
    await db.batch([
      db.prepare(`insert into briar_dm_memory_jobs (id, space_id, kind, dedupe_key, status, input_json, input_hash,
        expected_memory_revision, revocation_epoch, available_at, created_at, updated_at)
        values (?, ?, 'extract', ?, 'running', ?, ?, 0, 0, ?, ?, ?)`)
        .bind(jobId, spaceId, jobId, JSON.stringify({ private: "Synthetic private copy" }), "a".repeat(64), now, now, now),
      db.prepare(`insert into briar_dm_memory_learning_inputs(job_id, space_id, source_type, source_id, source_version, source_hash)
        values (?, ?, 'message', ?, 1, ?)`)
        .bind(jobId, spaceId, rootId, "a".repeat(64)),
      db.prepare(`insert into briar_dm_memory_model_calls(id, job_id, space_id, organization_id, claim_token_hash, stage,
        input_hash, proposal_hash, model_json, reserved_micro_usd, created_at)
        values (?, ?, ?, ?, ?, 'proposing', ?, ?, '{}', 100, ?)`)
        .bind(callId, jobId, spaceId, organizationId, "b".repeat(64), "a".repeat(64), "c".repeat(64), now),
      db.prepare(`insert into briar_dm_memory_proposals(id, job_id, space_id, input_hash, proposal_hash, proposal_json,
        normalized_json, status, created_at) values (?, ?, ?, ?, ?, ?, ?, 'proposed', ?)`)
        .bind(callId, jobId, spaceId, "a".repeat(64), "c".repeat(64), '{"copy":"Synthetic private copy"}',
          '{"body":"Synthetic private copy"}', now),
    ]);
    return jobId;
  }
  it("captures only future opt-in messages and fixes the first debounce deadline", async () => {
    const f = await fixture();
    await message(f.owner.channelId, "Before opt-in");
    await enable(f.spaceId);
    const first = await message(f.owner.channelId, "First future fact");
    await outbox(f.spaceId, "2026-09-01T00:00:15.000Z");
    await scheduleDmLearningJobs(db, organizationId, syntheticDmLearningPolicy, "2026-09-01T00:00:14.000Z");
    expect(await job(f.spaceId)).toBeNull();
    const second = await message(f.owner.channelId, "Second future fact");
    await outbox(f.spaceId, "2026-09-01T00:00:29.000Z");
    await scheduleDmLearningJobs(db, organizationId, syntheticDmLearningPolicy, "2026-09-01T00:00:15.000Z");
    const created = await job(f.spaceId);
    expect(created).toMatchObject({ kind: "extract", status: "pending", source_start: 0 });
    const events = (await db.prepare(`select message_id from briar_dm_memory_source_events where space_id = ? order by sequence`)
      .bind(f.spaceId).all<{ message_id: string }>()).results;
    expect(events.map((event) => event.message_id)).toEqual([first, second]);
    await scheduleDmLearningJobs(db, organizationId, syntheticDmLearningPolicy, "2026-09-01T00:01:00.000Z");
    expect((await db.prepare(`select count(*) as count from briar_dm_memory_jobs where space_id = ? and kind = 'extract'`)
      .bind(f.spaceId).first<{ count: number }>())!.count).toBe(1);
  });
  it("splits a durable interval beyond the chat snapshot without consuming its remainder", async () => {
    const f = await fixture(); await enable(f.spaceId);
    for (let i = 0; i < 35; i++) await message(f.owner.channelId, `Synthetic durable fact ${i}`);
    await outbox(f.spaceId, now);
    await scheduleDmLearningJobs(db, organizationId, syntheticDmLearningPolicy, now);
    const pending = await job(f.spaceId);
    const space = (await db.prepare("select * from briar_dm_memory_spaces where id = ?").bind(f.spaceId).first<DmLearningSpaceRow>())!;
    const input = await captureDmLearningInput(db, pending, space, syntheticDmLearningPolicy, now);
    expect(input.inputSources).toHaveLength(32);
    expect(input.sourceEnd).toBeLessThan(pending.source_end);
    expect((await db.prepare("select source_watermark from briar_dm_memory_learning_state where space_id = ?")
      .bind(f.spaceId).first<{ source_watermark: number }>())!.source_watermark).toBe(0);
    expect((await db.prepare("select count(*) as count from briar_dm_memory_learning_outbox where space_id = ? and settled = 0")
      .bind(f.spaceId).first<{ count: number }>())!.count).toBe(1);
  });
  it("forgets every selected root and derived body while preserving unrelated roots and visible chat history", async () => {
    const f = await fixture(), rootId = await message(f.owner.channelId, "A synthetic fact to forget.");
    const root = await saveDmMemory(db, f.owner, { ...memory("Remembered source fact."), sourceMessage: { id: rootId, version: 1 } });
    const derived = await saveDmMemory(db, f.owner, memory("Derived synthetic copy."));
    await db.prepare(`insert into briar_dm_memory_sources(space_id, document_id, document_version, source_type, source_id, source_version, source_hash)
      select space_id, ?, 1, source_type, source_id, source_version, source_hash from briar_dm_memory_sources where document_id = ?`)
      .bind(derived.documentId, root.documentId).run();
    const privateJob = await seedPrivateJob(f.spaceId, rootId);
    await deleteDmMemory(db, f.owner, root.documentId!);
    expect((await listDmMemories(db, f.owner)).documents.map((doc) => doc.id)).toEqual([f.documentId]);
    expect((await db.prepare("select count(*) as count from briar_dm_memory_revisions where document_id in (?, ?)")
      .bind(root.documentId, derived.documentId).first<{ count: number }>())!.count).toBe(0);
    expect((await db.prepare("select count(*) as count from briar_dm_memory_exclusions where space_id = ?")
      .bind(f.spaceId).first<{ count: number }>())!.count).toBe(2);
    expect(await db.prepare("select status, input_json, input_hash from briar_dm_memory_jobs where id = ?").bind(privateJob).first())
      .toEqual({ status: "cancelled", input_json: null, input_hash: null });
    expect(await db.prepare("select input_hash, proposal_hash, proposal_json, normalized_json from briar_dm_memory_proposals where job_id = ?")
      .bind(privateJob).first()).toEqual({ input_hash: null, proposal_hash: null, proposal_json: null, normalized_json: null });
    expect((await db.prepare("select body from briar_channel_messages where id = ?").bind(rootId).first<{ body: string }>())!.body)
      .toBe("A synthetic fact to forget.");
  });
  it("revokes copied job payloads on source edits even before a memory has been committed", async () => {
    const f = await fixture(), rootId = await message(f.owner.channelId, "Original synthetic input.");
    const privateJob = await seedPrivateJob(f.spaceId, rootId);
    const before = (await db.prepare("select revocation_epoch from briar_dm_memory_spaces where id = ?").bind(f.spaceId).first<{ revocation_epoch: number }>())!;
    await db.prepare("update briar_channel_messages set body = ? where id = ?").bind("Corrected synthetic input.", rootId).run();
    expect(await db.prepare("select status, input_json, input_hash from briar_dm_memory_jobs where id = ?").bind(privateJob).first())
      .toEqual({ status: "cancelled", input_json: null, input_hash: null });
    expect((await db.prepare("select revocation_epoch from briar_dm_memory_spaces where id = ?").bind(f.spaceId).first<{ revocation_epoch: number }>())!
      .revocation_epoch).toBeGreaterThan(before.revocation_epoch);
    expect(await db.prepare("select input_hash, proposal_hash from briar_dm_memory_model_calls where job_id = ?").bind(privateJob).first())
      .toEqual({ input_hash: null, proposal_hash: null });
  });
  it("invalidates a topic when its underlying observation is revised", async () => {
    const f = await fixture();
    const derived = await saveDmMemory(db, f.owner, memory("Synthetic topic from the earlier observation."));
    await db.prepare(`insert into briar_dm_memory_document_links(document_id, document_version, source_document_id, source_document_version)
      values (?, 1, ?, 1)`).bind(derived.documentId, f.documentId).run();
    await saveDmMemory(db, f.owner, { ...memory("Now include context first."), expectedVersion: 1 }, f.documentId);
    expect((await getDmMemory(db, f.owner, derived.documentId!)).status).toBe("invalidated");
  });
  async function claimedLearning() {
    const f = await fixture(); await enable(f.spaceId);
    const sourceId = await message(f.owner.channelId, "Use tables when comparing implementation options.");
    await outbox(f.spaceId, now);
    const claim = await claimDmLearningJob(db, { organizationId, deviceId, workerId, projectId, policy: syntheticDmLearningPolicy, now });
    expect(claim).not.toBeNull();
    if (!claim) throw new Error("Synthetic learning claim was not acquired");
    const identity = { organizationId, workerId, deviceId, jobId: claim.workId, claimTokenHash: await sha256(claim.claimToken) };
    const proposal = { explicitRequest: false, changes: [syntheticDmLearningChange(claim.snapshot, {
      title: "Comparison preference", content: "The user prefers tables when comparing implementation options.",
      sourceLanguage: "en", observedAt: now, sourceRefs: [{ type: "message", id: sourceId, version: 1 }],
    })] };
    const common = { identity, policy: syntheticDmLearningPolicy, inputHash: claim.inputHash, now };
    return { ...f, claim, identity, proposal, common };
  }
  it("claims Agent learning only when the Worker advertises both pinned providers", async () => {
    const f = await fixture(); await enable(f.spaceId);
    await message(f.owner.channelId, "Use the connected Agent for this synthetic preference.");
    await outbox(f.spaceId, now);
    const updateRuntime = (providers: Array<"codex" | "grok">) => db.prepare(
      "update briar_execution_workers set runtime_proto_json = ? where id = ?",
    ).bind(workerRuntimeProtoJsonFixture({ providers, dmMemoryLearning: {
      protocol: 2, transports: ["agent"], providers,
    } }), workerId).run();
    try {
      await updateRuntime(["codex"]);
      expect(await claimDmLearningJob(db, { organizationId, deviceId, workerId, projectId,
        policy: syntheticAgentDmLearningPolicy, now })).toBeNull();
      await updateRuntime(["codex", "grok"]);
      const claim = await claimDmLearningJob(db, { organizationId, deviceId, workerId, projectId,
        policy: syntheticAgentDmLearningPolicy, now });
      expect(claim?.snapshot.policy).toEqual(syntheticAgentDmLearningPolicy);
    } finally {
      await db.prepare("update briar_execution_workers set runtime_proto_json = ? where id = ?")
        .bind(workerRuntimeProtoJsonFixture({ agentProvider: "claude", providers: ["claude"],
          dmMemoryLearning: true }), workerId).run();
    }
  });
  const usage = { inputTokens: 100, outputTokens: 50, costMicroUsd: 100 };
  it("reserves two calls, verifies independently, and atomically commits evidence, index work and watermark", async () => {
    const f = await claimedLearning(), proposalCall = crypto.randomUUID();
    const invocation = await reserveDmLearningModelCall(db, { ...f.common, callId: proposalCall, stage: "proposing" });
    expect(await reserveDmLearningModelCall(db, { ...f.common, callId: proposalCall, stage: "proposing" })).toEqual(invocation);
    expect((await job(f.spaceId)).calls_used).toBe(1);
    const proposed = await submitDmLearningProposal(db, { ...f.common, callId: proposalCall, proposal: f.proposal, usage });
    expect((await listDmMemories(db, f.owner)).documents).toHaveLength(1);
    expect(proposed.status).toBe("verifying");
    if (proposed.status !== "verifying") throw new Error("Synthetic proposal did not enter verification");
    const verificationCall = crypto.randomUUID();
    const verify = await reserveDmLearningModelCall(db, { ...f.common, callId: verificationCall, stage: "verifying" });
    expect(verify.model.model).toBe("synthetic/verifier");
    expect(verify.proposal).toEqual(f.proposal);
    const submitted = { ...f.common, callId: verificationCall,
      proposalId: proposed.proposalId, proposalHash: proposed.proposalHash, usage,
      verification: { approved: true, explicitRequestAuthorized: false, decisions: [{ changeId: "change-1", verdict: "supported" as const }] } };
    const result = await submitDmLearningVerification(db, submitted);
    expect(await submitDmLearningVerification(db, submitted)).toEqual(result);
    await expect(submitDmLearningVerification(db, { ...submitted, proposalHash: "0".repeat(64) }))
      .rejects.toMatchObject({ code: "stale" });
    expect(result.status).toBe("succeeded");
    const saved = await getDmMemory(db, f.owner, result.documents[0]!.documentId);
    expect(saved).toMatchObject({ body: f.proposal.changes[0]!.content, protectedByUser: false, version: 1, indexState: "pending" });
    expect(saved.sources).toEqual([{ type: "message", id: f.proposal.changes[0]!.sourceRefs[0]!.id, version: 1 }]);
    expect(await db.prepare("select status, calls_used from briar_dm_memory_jobs where id = ?").bind(f.claim.workId).first())
      .toEqual({ status: "succeeded", calls_used: 2 });
    expect((await db.prepare("select source_watermark from briar_dm_memory_learning_state where space_id = ?")
      .bind(f.spaceId).first<{ source_watermark: number }>())!.source_watermark).toBe(f.claim.snapshot.sourceEnd);
    await deleteDmMemory(db, f.owner, result.documents[0]!.documentId);
    await expect(submitDmLearningVerification(db, submitted)).rejects.toMatchObject({ code: "scope_revoked" });
  });
  it("records rejection without partial documents or watermark progress and cannot flip that approval", async () => {
    const f = await claimedLearning(), proposalCall = crypto.randomUUID();
    await reserveDmLearningModelCall(db, { ...f.common, callId: proposalCall, stage: "proposing" });
    const proposed = await submitDmLearningProposal(db, { ...f.common, callId: proposalCall, proposal: f.proposal, usage });
    if (proposed.status !== "verifying") throw new Error("Synthetic proposal did not enter verification");
    const verificationCall = crypto.randomUUID();
    await reserveDmLearningModelCall(db, { ...f.common, callId: verificationCall, stage: "verifying" });
    const submit = { ...f.common, callId: verificationCall, proposalId: proposed.proposalId, proposalHash: proposed.proposalHash, usage };
    await expect(submitDmLearningVerification(db, { ...submit, verification: { approved: false, explicitRequestAuthorized: false,
      decisions: [{ changeId: "change-1", verdict: "unsupported" }] } })).rejects.toMatchObject({ code: "verification_rejected" });
    expect((await listDmMemories(db, f.owner)).documents).toHaveLength(1);
    expect((await job(f.spaceId)).status).toBe("failed");
    expect((await db.prepare("select source_watermark from briar_dm_memory_learning_state where space_id = ?")
      .bind(f.spaceId).first<{ source_watermark: number }>())!.source_watermark).toBe(0);
    await expect(submitDmLearningVerification(db, { ...submit, verification: { approved: true, explicitRequestAuthorized: false,
      decisions: [{ changeId: "change-1", verdict: "supported" }] } })).rejects.toMatchObject({ code: "scope_revoked" });
  });
  it("finishes a valid empty proposal after one call but enforces six total reservations", async () => {
    const f = await claimedLearning(), callId = crypto.randomUUID();
    await reserveDmLearningModelCall(db, { ...f.common, callId, stage: "proposing" });
    const submitted = { ...f.common, callId, proposal: { explicitRequest: false, changes: [] }, usage };
    const result = await submitDmLearningProposal(db, submitted);
    expect(result.status).toBe("no_change");
    expect(await submitDmLearningProposal(db, submitted)).toEqual(result);
    await expect(submitDmLearningProposal(db, { ...submitted, proposal: { ...submitted.proposal, explicitRequest: true } }))
      .rejects.toMatchObject({ code: "stale" });
    expect((await job(f.spaceId)).calls_used).toBe(1);
    const next = await claimedLearning();
    for (let i = 0; i < 6; i++) await reserveDmLearningModelCall(db, { ...next.common, callId: crypto.randomUUID(), stage: "proposing" });
    await expect(reserveDmLearningModelCall(db, { ...next.common, callId: crypto.randomUUID(), stage: "proposing" }))
      .rejects.toMatchObject({ code: "budget_exhausted" });
    expect((await job(next.spaceId)).calls_used).toBe(6);
  });
  it("clears terminal model copies after 24 hours and retains the body-free accounting", async () => {
    const f = await claimedLearning(), callId = crypto.randomUUID();
    await reserveDmLearningModelCall(db, { ...f.common, callId, stage: "proposing" });
    await submitDmLearningProposal(db, { ...f.common, callId, proposal: { explicitRequest: false, changes: [] }, usage });
    await cleanupDmLearningPayloads(db, "2026-09-01T23:59:59.000Z");
    expect((await job(f.spaceId)).input_json).not.toBeNull();
    await cleanupDmLearningPayloads(db, "2026-09-02T00:00:00.000Z");
    expect(await job(f.spaceId)).toMatchObject({ status: "no_change", input_json: null, lease_token_hash: null, calls_used: 1 });
    expect(await db.prepare("select proposal_json, normalized_json from briar_dm_memory_proposals where id = ?")
      .bind(callId).first()).toEqual({ proposal_json: null, normalized_json: null });
    expect(await db.prepare("select input_tokens, output_tokens, cost_micro_usd from briar_dm_memory_model_calls where id = ?")
      .bind(callId).first()).toEqual({ input_tokens: 100, output_tokens: 50, cost_micro_usd: 100 });
  });
  it("retires expired attempts without losing the durable input interval or refunding unknown calls", async () => {
    const f = await claimedLearning(), callId = crypto.randomUUID();
    await reserveDmLearningModelCall(db, { ...f.common, callId, stage: "proposing" });
    await reapDmLearningClaims(db, "2026-09-01T00:05:00.000Z", organizationId);
    expect(await job(f.spaceId)).toMatchObject({ status: "retry_wait", input_json: null, input_hash: null,
      lease_token_hash: null, calls_used: 1, source_start: f.claim.snapshot.sourceStart, source_end: f.claim.snapshot.sourceEnd });
    expect(await db.prepare("select status, error_code from briar_dm_memory_model_calls where id = ?")
      .bind(callId).first()).toEqual({ status: "failed", error_code: "model_timeout" });
    expect((await db.prepare("select source_watermark from briar_dm_memory_learning_state where space_id = ?")
      .bind(f.spaceId).first<{ source_watermark: number }>())!.source_watermark).toBe(0);
  });
  it("runs the CLI through generated Connect RPCs and replays a lost commit acknowledgement", async () => {
    const f = await claimedLearning();
    expect(await countExecutionWorkerDeviceSessions(db, deviceId, now)).toBe(1);
    const learningEnv = Object.assign({ DB: db }, { DM_MEMORY_LEARNING_ENABLED: String("true"),
      DM_MEMORY_LEARNING_POLICIES: JSON.stringify({ [organizationId]: syntheticDmLearningPolicy }) }) as Env;
    let lostAcknowledgement = false;
    const rpc = createClient(WorkerQueueService, createRouterTransport((router) =>
      router.service(WorkerQueueService, createWorkerQueueService({
        request: new Request("https://synthetic.example", {
          headers: { Authorization: `Bearer ${workerToken}` },
        }),
        db,
        env: learningEnv,
      }))
    ));
    const unstableRpc = {
      reserveDmMemoryLearningCall: rpc.reserveDmMemoryLearningCall,
      submitDmMemoryLearningProposal: rpc.submitDmMemoryLearningProposal,
      failDmMemoryLearning: rpc.failDmMemoryLearning,
      submitDmMemoryLearningVerification: async (
        ...args: Parameters<typeof rpc.submitDmMemoryLearningVerification>
      ) => {
        const response = await rpc.submitDmMemoryLearningVerification(...args);
        if (!lostAcknowledgement) {
          lostAcknowledgement = true;
          throw new TypeError("Synthetic connection closed after commit");
        }
        return response;
      },
    };
    const models = vi.fn<typeof invokeDmLearningModel>().mockImplementation(async (input) => invokeDmLearningModel({ ...input,
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ model: input.invocation.model.model,
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify(input.invocation.stage === "proposing" ? f.proposal
          : { approved: true, explicitRequestAuthorized: false, decisions: [{ changeId: "change-1", verdict: "supported" }] }) } }],
        usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.0001 } })) }));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(now));
    try {
      const result = await runClaimedDmMemory({ rpc: unstableRpc, projectId, claim: f.claim,
        signal: new AbortController().signal, apiKey: "synthetic-provider-key", invoke: models });
      expect(result.status).toBe("succeeded");
      expect(models).toHaveBeenCalledTimes(2);
      expect(lostAcknowledgement).toBe(true);
      expect((await listDmMemories(db, f.owner)).documents).toHaveLength(2);
      expect((await job(f.spaceId)).calls_used).toBe(2);
      expect(await countExecutionWorkerDeviceSessions(db, deviceId, now)).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it("cancels an in-flight proposal on opt-out and cannot use the previous verification to re-enable memory", async () => {
    const f = await claimedLearning(), callId = crypto.randomUUID();
    await reserveDmLearningModelCall(db, { ...f.common, callId, stage: "proposing" });
    const proposed = await submitDmLearningProposal(db, { ...f.common, callId, proposal: f.proposal, usage });
    if (proposed.status !== "verifying") throw new Error("Synthetic proposal did not enter verification");
    const verifierId = crypto.randomUUID();
    await reserveDmLearningModelCall(db, { ...f.common, callId: verifierId, stage: "verifying" });
    const settings = await updateDmMemorySettings(db, f.owner, { requestId: crypto.randomUUID(),
      memorySpaceId: f.spaceId, expectedMemoryRevision: f.claim.snapshot.memoryRevision, useEnabled: false, autoEnabled: false });
    expect(settings.useEnabled).toBe(false);
    expect(await job(f.spaceId)).toMatchObject({ status: "cancelled", input_json: null, lease_token_hash: null });
    await expect(submitDmLearningVerification(db, { ...f.common, callId: verifierId, proposalId: proposed.proposalId,
      proposalHash: proposed.proposalHash, usage, verification: { approved: true, explicitRequestAuthorized: false,
        decisions: [{ changeId: "change-1", verdict: "supported" }] } })).rejects.toMatchObject({ code: "scope_revoked" });
    expect((await listDmMemories(db, f.owner)).documents).toHaveLength(1);
  });
  it("requires an available learning policy and an explicit opt-in with memory use enabled", async () => {
    const f = await fixture();
    const page = await listDmMemories(db, f.owner);
    const input = { requestId: crypto.randomUUID(), memorySpaceId: f.spaceId,
      expectedMemoryRevision: page.spaces[0]!.memoryRevision, useEnabled: true, autoEnabled: true };
    await expect(updateDmMemorySettings(db, f.owner, input)).rejects.toMatchObject({ code: "memory_learning_unavailable" });
    await expect(updateDmMemorySettings(db, f.owner, { ...input, useEnabled: false }, { learningAvailable: true }))
      .rejects.toMatchObject({ code: "memory_invalid_settings" });
    await message(f.owner.channelId, "Synthetic message before opt-in");
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(now));
    try { expect((await updateDmMemorySettings(db, f.owner, input, { learningAvailable: true })).autoEnabled).toBe(true); }
    finally { vi.useRealTimers(); }
    const after = await message(f.owner.channelId, "Synthetic future preference after opt-in");
    expect((await db.prepare("select message_id from briar_dm_memory_source_events where space_id = ?")
      .bind(f.spaceId).all<{ message_id: string }>()).results.map((row) => row.message_id)).toEqual([after]);
  });
  it("limits an explicit correction snapshot to the request and selected current documents", async () => {
    const f = await fixture();
    const unrelated = await saveDmMemory(db, f.owner, memory("An unrelated private memory."));
    const requestSource = await message(f.owner.channelId, "Correct only the selected preference.");
    await db.prepare(`insert into briar_dm_memory_learning_outbox
      (reply_job_id, space_id, kind, source_end, request_source_id, request_targets_json,
        revocation_epoch, available_at, created_at)
      values (?, ?, 'explicit_request', 0, ?, ?, 0, ?, ?)`)
      .bind(crypto.randomUUID(), f.spaceId, requestSource,
        JSON.stringify([{ documentId: f.documentId, version: 1 }]), now, now).run();
    expect(await scheduleDmLearningJobs(db, organizationId, syntheticDmLearningPolicy, now)).toBe(1);
    const claim = await claimDmLearningJob(db, { organizationId, deviceId, workerId, projectId,
      policy: syntheticDmLearningPolicy, now });
    expect(claim?.snapshot.requestSource).toEqual({ type: "message", id: requestSource, version: 1 });
    expect(claim?.snapshot.documents.map((document) => document.id)).toEqual([f.documentId]);
    expect(claim?.snapshot.documents.map((document) => document.id)).not.toContain(unrelated.documentId);
    await deleteDmMemory(db, f.owner, f.documentId);
    expect(await db.prepare(`select status, input_json, request_targets_json from briar_dm_memory_jobs where id = ?`)
      .bind(claim!.workId).first()).toEqual({ status: "cancelled", input_json: null, request_targets_json: "[]" });
  });
  it("retries a failed interval idempotently without resetting its model-call ceiling", async () => {
    const f = await fixture(); await enable(f.spaceId);
    await message(f.owner.channelId, "Synthetic retry source."); await outbox(f.spaceId, now);
    expect(await scheduleDmLearningJobs(db, organizationId, syntheticDmLearningPolicy, now)).toBe(1);
    const failed = (await db.prepare(`select id from briar_dm_memory_jobs where space_id = ? and kind = 'extract'
      order by created_at desc limit 1`).bind(f.spaceId).first<{ id: string }>())!;
    await db.prepare("update briar_dm_memory_jobs set status = 'failed', calls_used = 2, error_code = 'model_unavailable' where id = ?")
      .bind(failed.id).run();
    const input = { requestId: crypto.randomUUID(), revocationEpoch: 0 };
    expect(await retryDmLearningJob(db, f.owner, failed.id, input, syntheticDmLearningPolicy, now))
      .toEqual({ accepted: true, replayed: false });
    expect(await retryDmLearningJob(db, f.owner, failed.id, input, syntheticDmLearningPolicy, now))
      .toEqual({ accepted: true, replayed: true });
    expect(await db.prepare("select status, calls_used from briar_dm_memory_jobs where id = ?").bind(failed.id).first())
      .toEqual({ status: "pending", calls_used: 2 });
    await db.prepare("update briar_dm_memory_jobs set status = 'failed', calls_used = 6 where id = ?").bind(failed.id).run();
    await expect(retryDmLearningJob(db, f.owner, failed.id,
      { requestId: crypto.randomUUID(), revocationEpoch: 0 }, syntheticDmLearningPolicy, now))
      .rejects.toMatchObject({ code: "memory_retry_blocked" });
  });
  it("keeps forgetting pending until vectors of derived memories have also been removed", async () => {
    const f = await fixture();
    const derived = await saveDmMemory(db, f.owner, memory("Synthetic derived observation."));
    await db.prepare(`insert into briar_dm_memory_sources(space_id, document_id, document_version, source_type, source_id, source_version, source_hash)
      select space_id, ?, 1, source_type, source_id, source_version, source_hash from briar_dm_memory_sources where document_id = ?`)
      .bind(derived.documentId, f.documentId).run();
    const vectorId = crypto.randomUUID();
    await db.prepare(`insert into briar_dm_memory_vectors
      (id, organization_id, space_id, document_id, document_version, chunk_id, embedding_profile, state, available_at, created_at)
      values (?, ?, ?, ?, 1, ?, 'cf-bge-m3-1024-cosine-v1', 'purging', ?, ?)`)
      .bind(vectorId, organizationId, f.spaceId, derived.documentId, crypto.randomUUID(), now, now).run();
    await deleteDmMemory(db, f.owner, f.documentId);
    await reconcileDmMemory(db, null, now, false);
    expect(await deleteDmMemory(db, f.owner, f.documentId)).toMatchObject({ purgeState: "pending" });
    await db.prepare("update briar_dm_memory_vectors set state = 'purged' where id = ?").bind(vectorId).run();
    await reconcileDmMemory(db, null, now, false);
    expect(await deleteDmMemory(db, f.owner, f.documentId)).toMatchObject({ purgeState: "complete" });
  });
  it("invalidates descendants on expiry but ignores links belonging only to old revisions", async () => {
    const f = await fixture();
    const derived = await saveDmMemory(db, f.owner, memory("Earlier derived topic."));
    await db.prepare(`insert into briar_dm_memory_document_links(document_id, document_version, source_document_id, source_document_version)
      values (?, 1, ?, 1)`).bind(derived.documentId, f.documentId).run();
    await saveDmMemory(db, f.owner, { ...memory("A new independent user edit."), expectedVersion: 1 }, derived.documentId!);
    await db.prepare("update briar_dm_memory_documents set expired_version = current_version where id = ?").bind(f.documentId).run();
    expect((await getDmMemory(db, f.owner, derived.documentId!)).status).toBe("active");
    const other = await fixture();
    const current = await saveDmMemory(db, other.owner, memory("Currently derived topic."));
    await db.prepare(`insert into briar_dm_memory_document_links(document_id, document_version, source_document_id, source_document_version)
      values (?, 1, ?, 1)`).bind(current.documentId, other.documentId).run();
    await db.prepare("update briar_dm_memory_documents set expired_version = current_version where id = ?").bind(other.documentId).run();
    expect((await getDmMemory(db, other.owner, current.documentId!)).status).toBe("invalidated");
  });
});
