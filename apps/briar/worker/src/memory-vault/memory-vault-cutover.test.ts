import { env as cloudflareEnv } from "cloudflare:workers";
import { create } from "@bufbuild/protobuf";
import {
  CreateDmMemoryDocumentRequestSchema,
  DeleteDmMemoryDocumentRequestSchema,
  DmMemoryClass as ProtoDmMemoryClass,
  DmMemoryReferenceSchema,
  GetDmMemoryDocumentRequestSchema,
  ListDmMemoriesRequestSchema,
  ListDmMemoryRevisionsRequestSchema,
  RetryDmMemoryLearningRequestSchema,
  UpdateDmMemoryDocumentRequestSchema,
  type CreateDmMemoryDocumentResponse,
  type DeleteDmMemoryDocumentResponse,
  type GetDmMemoryDocumentResponse,
  type ListDmMemoriesResponse,
  type ListDmMemoryRevisionsResponse,
  type RetryDmMemoryLearningResponse,
  type UpdateDmMemoryDocumentResponse,
} from "@briar/contracts/gen/briar/app/v1/dm_memory_pb";
import {
  ChannelReplyClaimIdentitySchema,
  ChannelReplySuccessSchema,
  CompleteChannelReplyRequestSchema,
  MemoryVaultListRequestSchema,
  WorkClaimIdentitySchema,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import type { HandlerContext } from "@connectrpc/connect";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createAppDmMemoryService } from "../app-connect-dm-memory";
import type { BriarAuth } from "../auth";
import { getChannelMessage } from "../channels";
import { sha256 } from "../crypto-digest";
import { bindDmMemoryReplyClaim } from "../dm-memory-claim";
import { getDmMemoryClaimBrief, lookupDmMemoryClaim } from "../dm-memory-claim-application";
import { deleteDmMemory, saveDmMemory } from "../dm-memory-repository";
import { handleDmMemoryRoute } from "../dm-memory-routes";
import { memoryVaultDeps, memoryVaultFixture, type MemoryVaultFixture } from "../test-helpers/memory-vault-fixture";
import { memoryVaultListRpc } from "../worker-connect-memory-vault";
import { completeChannelReplyApplication } from "../worker-reply-completion-application";
import { requireWorkerProjectBinding } from "../worker-route-auth";
import { completeChannelReplyInputFromProto } from "../worker-reply-completion-mappers";
import { MemoryVaultError } from "./errors";
import { processMemoryVaultPurges } from "./forget";
import { vaultRecordHandle } from "./handles";
import type { InMemoryVaultGitStore } from "./in-memory-git-store";
import {
  LegacyMigrationMismatchError,
  runLegacyMemoryMigration,
  verifyLegacyMigration,
} from "./legacy-migration";
import {
  memoryVaultList,
  memoryVaultRead,
  memoryVaultSave,
  type MemoryVaultCaller,
  type MemoryVaultDeps,
} from "./operations";
import { parseVaultCommitMessage } from "./trailers";

const db = cloudflareEnv.DB;

type Deps = MemoryVaultDeps & { store: InMemoryVaultGitStore };

const envWith = (vault: boolean) => ({
  DB: db, DM_MEMORY_RETRIEVAL_ENABLED: "true", DM_MEMORY_MINIMUM_SCORE: "",
  MEMORY_VAULT_ENABLED: vault ? "true" : "false",
}) as unknown as Env;

const save = (deps: MemoryVaultDeps, caller: MemoryVaultCaller, id: string, content: string,
  options: { type?: string; expectedRevision?: number | null; userRequested?: boolean } = {}) =>
  memoryVaultSave(deps, caller, {
    requestId: crypto.randomUUID(), id, type: options.type ?? "fact", status: null, aliases: [],
    expectedRevision: options.expectedRevision ?? null, userRequested: options.userRequested ?? false, content,
  });

const read = (deps: MemoryVaultDeps, caller: MemoryVaultCaller, target: string) =>
  memoryVaultRead(deps, caller, { target, revision: null });

const listIds = async (deps: MemoryVaultDeps, caller: MemoryVaultCaller) =>
  (await memoryVaultList(deps, caller, { type: null, prefix: null, status: null, cursor: null, limit: null }))
    .records.map((record) => record.id);

async function vaultCode(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof MemoryVaultError) return error.vaultCode;
    throw error;
  }
  return null;
}

const context = {} as HandlerContext;

describe("memory vault cutover", () => {
  let fixture: MemoryVaultFixture;

  beforeAll(async () => {
    fixture = await memoryVaultFixture(db);
  }, 120_000);

  // A revoked or finished-in-test claim must not be re-claimed in place of the next test's reply.
  afterEach(async () => {
    await db.prepare(`update briar_channel_agent_reply_jobs set status = 'failed', error = 'test cleanup'
      where agent_id = ? and status in ('queued', 'running')`).bind(fixture.agentId).run();
  });

  const auth = (userId: string) => ({
    api: { getSession: async () => ({ user: { id: userId } }) },
  }) as unknown as BriarAuth;

  /** The app's DmMemoryService, as the owner (or anyone) calls it. */
  const dmMemoryService = (store: InMemoryVaultGitStore | null, userId = fixture.ownerId, vault = true) => {
    const service = createAppDmMemoryService({
      request: new Request("https://briar.example"), auth: auth(userId), db, env: envWith(vault),
      memoryVaultStore: store,
    });
    const scope = (channelId: string) => ({ workspaceId: fixture.workspaceId, channelId });
    return {
      list: (channelId: string) => service.listDmMemories(
        create(ListDmMemoriesRequestSchema, scope(channelId)), context) as Promise<ListDmMemoriesResponse>,
      get: (channelId: string, documentId: string, version?: number) => service.getDmMemoryDocument(
        create(GetDmMemoryDocumentRequestSchema, { ...scope(channelId), documentId, version }),
        context) as Promise<GetDmMemoryDocumentResponse>,
      revisions: (channelId: string, documentId: string) => service.listDmMemoryRevisions(
        create(ListDmMemoryRevisionsRequestSchema, { ...scope(channelId), documentId }),
        context) as Promise<ListDmMemoryRevisionsResponse>,
      create: (channelId: string, input: { title: string; body: string; memoryClass?: ProtoDmMemoryClass; requestId?: string }) =>
        service.createDmMemoryDocument(create(CreateDmMemoryDocumentRequestSchema, {
          ...scope(channelId), requestId: input.requestId ?? crypto.randomUUID(), title: input.title, body: input.body,
          memoryClass: input.memoryClass ?? ProtoDmMemoryClass.NOTE, sourceLanguage: "en",
        }), context) as Promise<CreateDmMemoryDocumentResponse>,
      update: (channelId: string, documentId: string, expectedVersion: number,
        input: { title: string; body: string; memoryClass?: ProtoDmMemoryClass }) =>
        service.updateDmMemoryDocument(create(UpdateDmMemoryDocumentRequestSchema, {
          ...scope(channelId), documentId, requestId: crypto.randomUUID(), expectedVersion, title: input.title,
          body: input.body, memoryClass: input.memoryClass ?? ProtoDmMemoryClass.NOTE, sourceLanguage: "en",
        }), context) as Promise<UpdateDmMemoryDocumentResponse>,
      delete: (channelId: string, documentId: string) => service.deleteDmMemoryDocument(
        create(DeleteDmMemoryDocumentRequestSchema, { ...scope(channelId), documentId }),
        context) as Promise<DeleteDmMemoryDocumentResponse>,
      retry: (channelId: string) => service.retryDmMemoryLearning(create(RetryDmMemoryLearningRequestSchema, {
        ...scope(channelId), jobId: crypto.randomUUID(), requestId: crypto.randomUUID(), revocationEpoch: 0n,
      }), context) as Promise<RetryDmMemoryLearningResponse>,
    };
  };

  const vaultOfSpace = (spaceId: string) => db.prepare(`select * from briar_memory_vaults where dm_space_id = ?`)
    .bind(spaceId).first<{ id: string; repo_name: string; generation: number; head_commit: string | null }>();

  const fenceOf = (jobId: string) => db.prepare(`select protocol, space_id from briar_dm_memory_reply_fences where job_id = ?`)
    .bind(jobId).first<{ protocol: number; space_id: string }>();

  const legacyOwner = (channelId: string) => ({ workspaceId: fixture.workspaceId, channelId, userId: fixture.ownerId });

  const legacyCreate = (channelId: string, input: { title: string; body: string; memoryClass?: "profile" | "note" | "log" }) =>
    saveDmMemory(db, legacyOwner(channelId), {
      requestId: crypto.randomUUID(), title: input.title, body: input.body, memoryClass: input.memoryClass ?? "note",
      sourceLanguage: "en", observedAt: null, validUntil: null,
    });

  const legacyEdit = (channelId: string, documentId: string, expectedVersion: number, body: string, title: string,
    memoryClass: "profile" | "note" | "log" = "note") =>
    saveDmMemory(db, legacyOwner(channelId), {
      requestId: crypto.randomUUID(), title, body, memoryClass, sourceLanguage: "en", observedAt: null,
      validUntil: null, expectedVersion,
    }, documentId);

  it("keeps the legacy DM claim exactly as before while the flag is off", async () => {
    await fixture.setVaultCapable(true);
    const dm = await fixture.claimChannel("dm", fixture.ownerId, "hi", { vaultEnabled: false });
    expect(dm.claimed.memory).toMatchObject({ protocol: 1 });
    expect((await fenceOf(dm.jobId))?.protocol).toBe(1);
    // The vault tools refuse while the deployment switch is off.
    const deps = memoryVaultDeps(db, { env: { MEMORY_VAULT_ENABLED: "false" } }) as Deps;
    expect(await vaultCode(save(deps, dm.caller, "note", "x"))).toBe("memory_disabled");
    // The owner dialog stays on D1 memory: document ids are legacy document UUIDs.
    const created = await dmMemoryService(deps.store, fixture.ownerId, false).create(dm.channelId, { title: "Tea", body: "Likes tea." });
    expect(await db.prepare(`select status from briar_dm_memory_documents where id = ?`).bind(created.documentId).first())
      .toEqual({ status: "active" });
    expect(await vaultOfSpace(await fixture.spaceOf(dm.channelId))).toBeNull();
  });

  it("withholds the legacy descriptor from a vault Worker but keeps the fence the vault scope needs", async () => {
    await fixture.setVaultCapable(true);
    const deps = memoryVaultDeps(db) as Deps;
    const mine = await fixture.claimChannel("dm", fixture.ownerId, "remember", { vaultEnabled: true });
    expect(mine.claimed.memory).toBeNull();
    expect(mine.claimed.memoryLearningEnabled).toBe(false);
    expect(await fenceOf(mine.jobId)).toMatchObject({ protocol: 0, space_id: await fixture.spaceOf(mine.channelId) });
    await fixture.setDmMemory(mine.channelId, { use: true, auto: true });
    await save(deps, mine.caller, "secret-plan", "Owner A private plan");
    const vault = (await vaultOfSpace(await fixture.spaceOf(mine.channelId)))!;
    expect(vault).toMatchObject({ head_commit: expect.any(String) });
    expect((await read(deps, mine.caller, "secret-plan")).body).toBe("Owner A private plan\n");

    // User B's DM with the same Agent, a group channel and a project run never see it.
    const theirs = await fixture.claimChannel("dm", fixture.otherUserId, "hello", { vaultEnabled: true });
    await fixture.setDmMemory(theirs.channelId, { use: true, auto: true });
    expect(await listIds(deps, theirs.caller)).toEqual(["readme"]);
    expect(await vaultCode(read(deps, theirs.caller, "secret-plan"))).toBe("not_found");
    const group = await fixture.claimChannel("channel", fixture.ownerId, "hello", { vaultEnabled: true });
    expect(await listIds(deps, group.caller)).toEqual(["readme"]);
    expect(await vaultCode(read(deps, group.caller, "secret-plan"))).toBe("not_found");
    const run = await fixture.claimIssueRun();
    expect(await vaultCode(read(deps, run.caller, "secret-plan"))).toBe("not_found");
    const task = await fixture.claimAgentTask();
    expect(await listIds(deps, task.caller)).toEqual(["readme"]);

    // The legacy brief refuses a vault claim: it has no legacy memory protocol.
    await expect(getDmMemoryClaimBrief(db, envWith(true), {
      jobId: mine.jobId, workerId: fixture.workerId, deviceId: fixture.deviceId, claimToken: mine.claimToken, revocationEpoch: 0,
    })).rejects.toMatchObject({ code: "memory_scope_revoked" });
  });

  it("resumes a vault Worker's conversation while the epoch holds and resets everyone else's", async () => {
    await fixture.setVaultCapable(true);
    const dm = await fixture.claimChannel("dm", fixture.ownerId, "resume", { vaultEnabled: true });
    const claimTokenHash = await sha256(dm.claimToken);
    const session = async () => db.prepare(`select session.conversation_id from briar_channel_reply_sessions session
      join briar_channel_agent_reply_jobs job on job.session_id = session.id where job.id = ?`)
      .bind(dm.jobId).first<{ conversation_id: string | null }>();
    const setConversation = () => db.prepare(`update briar_channel_reply_sessions set conversation_id = 'conv-1'
      where id = (select session_id from briar_channel_agent_reply_jobs where id = ?)`).bind(dm.jobId).run();
    await setConversation();
    await bindDmMemoryReplyClaim(db, { jobId: dm.jobId, claimTokenHash, supportsMemory: true, enabled: true,
      vaultCutover: true, vaultCapable: true });
    expect((await session())?.conversation_id).toBe("conv-1");
    // An old Worker CLI after the cutover: no memory protocol, so no resumed transcript either.
    await bindDmMemoryReplyClaim(db, { jobId: dm.jobId, claimTokenHash, supportsMemory: true, enabled: true,
      vaultCutover: true, vaultCapable: false });
    expect((await session())?.conversation_id).toBeNull();
    expect((await fenceOf(dm.jobId))?.protocol).toBe(0);
  });

  it("degrades an old Worker CLI to no memory and stops legacy learning after the cutover", async () => {
    await fixture.setVaultCapable(false);
    const before = await fixture.claimChannel("dm", fixture.ownerId, "old cli", { vaultEnabled: false });
    expect(before.claimed.memory).toMatchObject({ protocol: 1 });
    await fixture.setDmMemory(before.channelId, { use: true, auto: true });
    await legacyCreate(before.channelId, { title: "Coffee", body: "Drinks coffee black.", memoryClass: "profile" });
    const scope = {
      jobId: before.jobId, workerId: fixture.workerId, deviceId: fixture.deviceId, claimToken: before.claimToken,
      revocationEpoch: (await db.prepare(`select revocation_epoch from briar_dm_memory_spaces where id = ?`)
        .bind(await fixture.spaceOf(before.channelId)).first<{ revocation_epoch: number }>())!.revocation_epoch,
    };
    // A claim bound before the switch: brief and lookup now return no memory.
    const brief = await getDmMemoryClaimBrief(db, envWith(true), scope);
    expect(brief.brief).toBeNull();
    expect(brief.memory).toMatchObject({ searchEnabled: false, briefState: "disabled" });
    await expect(lookupDmMemoryClaim(db, envWith(true), scope, crypto.randomUUID(),
      { operation: "search", queries: ["coffee"] }, { store: null, minimumScore: null }))
      .rejects.toMatchObject({ status: 503, code: "memory_unavailable" });

    // A new claim by the old CLI gets no descriptor and no learning flag.
    const after = await fixture.claimChannel("dm", fixture.ownerId, "old cli again", { vaultEnabled: true });
    expect(after.claimed.memory).toBeNull();
    expect(after.claimed.memoryLearningEnabled).toBe(false);
    expect((await fenceOf(after.jobId))?.protocol).toBe(0);
  });

  /** Completes a channel reply through the protobuf mapper and the application, as the Worker CLI does. */
  async function completeWith(claim: Awaited<ReturnType<MemoryVaultFixture["claimChannel"]>>, citations: { documentId: string; version: number }[],
    vault: boolean) {
    const request = completeChannelReplyInputFromProto(create(CompleteChannelReplyRequestSchema, {
      requestId: crypto.randomUUID(),
      projectId: fixture.projectId,
      workerId: fixture.workerId,
      work: create(WorkClaimIdentitySchema, {
        workId: claim.jobId,
        runId: claim.runId,
        claimToken: claim.claimToken,
        work: { case: "channelReply", value: create(ChannelReplyClaimIdentitySchema, { workspaceId: fixture.workspaceId }) },
      }),
      outcome: {
        case: "success",
        value: create(ChannelReplySuccessSchema, {
          body: "Answered from memory.",
          memoryCitations: citations.map((citation) => create(DmMemoryReferenceSchema, citation)),
        }),
      },
    }));
    return completeChannelReplyApplication({
      db,
      env: envWith(vault),
      worker: { principal: { workspaceId: fixture.workspaceId, deviceId: fixture.deviceId },
        binding: { id: fixture.workerId, project_id: fixture.projectId } },
      request,
    });
  }

  it("keeps only citations of records the claim read, shows them by handle, and drops them on forget", async () => {
    await fixture.setVaultCapable(true);
    const deps = memoryVaultDeps(db) as Deps;
    const dm = await fixture.claimChannel("dm", fixture.ownerId, "what do I like?", { vaultEnabled: true });
    await fixture.setDmMemory(dm.channelId, { use: true, auto: true });
    await save(deps, dm.caller, "drinks", "Tea, no sugar.");
    await save(deps, dm.caller, "unread", "Never read on this claim.");
    await read(deps, dm.caller, "drinks");
    const outbox = await db.prepare(`select count(*) as count from briar_dm_memory_learning_outbox where reply_job_id = ?`)
      .bind(dm.jobId);
    await completeWith(dm, [
      { documentId: "drinks", version: 1 },
      { documentId: "unread", version: 1 },
      { documentId: "drinks", version: 7 },
    ], true);
    const job = (await db.prepare(`select status, reply_message_id from briar_channel_agent_reply_jobs where id = ?`)
      .bind(dm.jobId).first<{ status: string; reply_message_id: string }>())!;
    expect(job.status).toBe("completed");
    const vault = (await vaultOfSpace(await fixture.spaceOf(dm.channelId)))!;
    const handle = await vaultRecordHandle(vault.id, "drinks");
    expect((await getChannelMessage(db, dm.channelId, job.reply_message_id))?.memoryCitations)
      .toEqual([{ documentId: handle, version: 1 }]);
    expect(await outbox.first()).toEqual({ count: 0 });

    // The citation opens in the owner's dialog by its handle.
    const service = dmMemoryService(deps.store);
    const opened = await service.get(dm.channelId, handle, 1);
    expect(opened.document).toMatchObject({ id: handle, version: 1, body: "Tea, no sugar.\n", title: "drinks" });

    await service.delete(dm.channelId, handle);
    expect((await getChannelMessage(db, dm.channelId, job.reply_message_id))?.memoryCitations).toEqual([]);
    expect(await db.prepare(`select count(*) as count from briar_memory_vault_reply_citations where vault_id = ?`)
      .bind(vault.id).first()).toEqual({ count: 0 });
  });

  it("serves the owner's DmMemoryService from the vault with protected user saves", async () => {
    await fixture.setVaultCapable(true);
    const deps = memoryVaultDeps(db) as Deps;
    const dm = await fixture.claimChannel("dm", fixture.ownerId, "owner edits", { vaultEnabled: true });
    const spaceId = await fixture.spaceOf(dm.channelId);
    await db.prepare(`update briar_dm_memory_spaces set use_enabled = 0, ever_saved = 0, auto_enabled = 0 where id = ?`)
      .bind(spaceId).run();
    const service = dmMemoryService(deps.store);
    const requestId = crypto.randomUUID();
    const created = await service.create(dm.channelId, {
      title: "Home city", body: "Lives in Seoul.", memoryClass: ProtoDmMemoryClass.PROFILE, requestId,
    });
    expect(created).toMatchObject({ version: 1, replayed: false });
    expect(created.documentId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    const again = await service.create(dm.channelId, {
      title: "Home city", body: "Lives in Seoul.", memoryClass: ProtoDmMemoryClass.PROFILE, requestId,
    });
    expect(again).toMatchObject({ documentId: created.documentId, version: 1, replayed: true });
    const vault = (await vaultOfSpace(spaceId))!;
    expect(await db.prepare(`select record_type, path, protected_by_user from briar_memory_vault_records
      where vault_id = ? and record_id = 'home-city'`).bind(vault.id).first())
      .toEqual({ record_type: "person", path: "entities/people/home-city.md", protected_by_user: 1 });
    const [commit] = await deps.store.history(vault.repo_name, { stopAt: null, limit: 1 });
    expect(parseVaultCommitMessage(commit!.message)).toMatchObject({ operation: "save", actor: `user:${fixture.ownerId}` });
    // The first save turns recall on, exactly as the legacy save did.
    const space = () => db.prepare(`select use_enabled, ever_saved, revocation_epoch from briar_dm_memory_spaces where id = ?`)
      .bind(spaceId).first<{ use_enabled: number; ever_saved: number; revocation_epoch: number }>();
    const afterCreate = (await space())!;
    expect(afterCreate).toMatchObject({ use_enabled: 1, ever_saved: 1 });

    const listed = await service.list(dm.channelId);
    expect(listed.capabilities).toMatchObject({ recall: true, automaticLearning: true });
    expect(listed.documents.map((document) => [document.id, document.title, document.version, document.protectedByUser]))
      .toEqual([[created.documentId, "home-city", 1, true]]);
    const got = await service.get(dm.channelId, created.documentId);
    expect(got.document).toMatchObject({ title: "Home city", body: "Lives in Seoul.\n", version: 1 });

    // An agent may not overwrite the owner's record unless the owner asked on this turn.
    await fixture.setDmMemory(dm.channelId, { use: true, auto: true });
    expect(await vaultCode(save(deps, dm.caller, "home-city", "agent guess", { type: "person", expectedRevision: 1 })))
      .toBe("protected_record");

    const updated = await service.update(dm.channelId, created.documentId, 1, {
      title: "Home city", body: "Moved to Busan.", memoryClass: ProtoDmMemoryClass.PROFILE,
    });
    expect(updated).toMatchObject({ documentId: created.documentId, version: 2 });
    expect((await space())!.revocation_epoch).toBe(afterCreate.revocation_epoch + 1);
    await expect(service.update(dm.channelId, created.documentId, 1, { title: "Home city", body: "stale" }))
      .rejects.toMatchObject({ status: 409, code: "version_conflict" });
    const history = await service.revisions(dm.channelId, created.documentId);
    expect(history).toMatchObject({ currentVersion: 2 });
    expect(history.revisions.map((revision) => revision.version)).toEqual([2, 1]);
    expect((await service.get(dm.channelId, created.documentId, 1)).document?.body).toBe("Lives in Seoul.\n");

    // Editing ended the claim that saw the old text (its fence epoch moved).
    expect(await vaultCode(read(deps, dm.caller, "home-city"))).toBe("claim_inactive");
    expect(await service.retry(dm.channelId)).toMatchObject({ accepted: false });

    // Export is the head tree.
    const url = new URL(`https://briar.example/workspaces/${fixture.workspaceId}/channels/${dm.channelId}/memory/export`);
    const response = (await handleDmMemoryRoute({
      request: new Request(url), url, auth: auth(fixture.ownerId), db, env: envWith(true), memoryVaultStore: deps.store,
    }))!;
    const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual(["README.md", "entities/people/home-city.md", "manifest.json"]);
    expect(strFromU8(entries["entities/people/home-city.md"]!)).toContain("Moved to Busan.");
    expect(JSON.parse(strFromU8(entries["manifest.json"]!))).toMatchObject({ format: "briar-memory-vault", vaultId: vault.id });

    // Someone else cannot read the owner's DM memory.
    await expect(dmMemoryService(deps.store, fixture.otherUserId).get(dm.channelId, created.documentId))
      .rejects.toBeDefined();
  });

  it("forgets from the owner dialog: gone from head, revisions, reads and epoch now, history after the purge", async () => {
    await fixture.setVaultCapable(true);
    const deps = memoryVaultDeps(db) as Deps;
    const dm = await fixture.claimChannel("dm", fixture.ownerId, "forget this", { vaultEnabled: true });
    await fixture.setDmMemory(dm.channelId, { use: true, auto: true });
    await save(deps, dm.caller, "diagnosis", "private-detail-5521");
    await save(deps, dm.caller, "kept", "stays");
    await read(deps, dm.caller, "diagnosis");
    const spaceId = await fixture.spaceOf(dm.channelId);
    const vault = (await vaultOfSpace(spaceId))!;
    const epoch = async () => (await db.prepare(`select revocation_epoch from briar_dm_memory_spaces where id = ?`)
      .bind(spaceId).first<{ revocation_epoch: number }>())!.revocation_epoch;
    const before = await epoch();
    const handle = await vaultRecordHandle(vault.id, "diagnosis");
    const service = dmMemoryService(deps.store);
    expect(await service.delete(dm.channelId, handle)).toMatchObject({ deleted: true, purgeState: "pending" });
    expect([...(await deps.store.snapshot(vault.repo_name)).files.keys()].sort())
      .toEqual(["README.md", "knowledge/facts/kept.md"]);
    const count = (table: string) => db.prepare(`select count(*) as count from ${table} where vault_id = ? and record_id = 'diagnosis'`)
      .bind(vault.id).first<{ count: number }>();
    expect(await count("briar_memory_vault_revisions")).toEqual({ count: 0 });
    expect(await count("briar_memory_vault_claim_reads")).toEqual({ count: 0 });
    expect(await epoch()).toBe(before + 1);
    expect((await service.list(dm.channelId)).documents.map((document) => document.title)).toEqual(["kept"]);
    // Deleting again is idempotent and reports the purge state.
    expect(await service.delete(dm.channelId, handle)).toMatchObject({ deleted: true, purgeState: "pending" });

    const oldRepo = vault.repo_name;
    const firstCommit = (await deps.store.history(oldRepo, { stopAt: null, limit: 10 })).at(-2)!.oid;
    // Other tests' vaults live in other in-memory stores; only this one's job matters here.
    expect(await processMemoryVaultPurges(deps, { limit: 20 }))
      .toContainEqual({ vaultId: vault.id, generation: 1, outcome: "purged" });
    expect(await deps.store.repoExists(oldRepo)).toBe(false);
    const current = (await vaultOfSpace(spaceId))!;
    expect(current.generation).toBe(2);
    expect(await deps.store.holdsObject(current.repo_name, firstCommit)).toBe(false);
    for (const commit of await deps.store.history(current.repo_name, { stopAt: null, limit: 20 })) {
      expect(commit.message).not.toContain("diagnosis");
      const snapshot = await deps.store.snapshot(current.repo_name, commit.oid);
      for (const content of snapshot.files.values()) expect(content).not.toContain("private-detail-5521");
    }
    expect(await service.delete(dm.channelId, handle)).toMatchObject({ deleted: true, purgeState: "complete" });
  });

  it("answers a memory tool call without a usable claim with claim_inactive", async () => {
    await expect(memoryVaultListRpc(
      { request: new Request("https://briar.example"), db, env: envWith(true) },
      create(MemoryVaultListRequestSchema, {}),
      { requireWorkerProjectBinding, memoryVaultStore: () => null },
    )).rejects.toMatchObject({ vaultCode: "claim_inactive", status: 409 });
  });

  describe("legacy migration", () => {
    /** A DM with two legacy documents: a profile with two versions and a note with a source message. */
    async function legacySpace() {
      await fixture.setVaultCapable(false);
      const dm = await fixture.claimChannel("dm", fixture.ownerId, "legacy", { vaultEnabled: false });
      const spaceId = await fixture.spaceOf(dm.channelId);
      const profile = await legacyCreate(dm.channelId, { title: "Owner profile", body: "Prefers Korean.", memoryClass: "profile" });
      await legacyEdit(dm.channelId, profile.documentId, 1, "Prefers Korean, short answers.", "Owner profile", "profile");
      const note = await legacyCreate(dm.channelId, { title: "Trip", body: "Flying to Jeju on Friday.", memoryClass: "note" });
      await db.prepare(`update briar_dm_memory_revisions set created_at = ? where document_id = ? and version = 1`)
        .bind("2026-09-01T10:00:00.000Z", profile.documentId).run();
      await db.prepare(`insert into briar_dm_memory_sources
          (space_id, document_id, document_version, source_type, source_id, source_version, source_hash)
        values (?, ?, 1, 'message', ?, 1, ?)`)
        .bind(spaceId, note.documentId, dm.messageId, "f".repeat(64)).run();
      await db.prepare(`update briar_dm_memory_revisions set protected_by_user = 0, origin = 'extract' where document_id = ?`)
        .bind(note.documentId).run();
      return { dm, spaceId, profile: profile.documentId, note: note.documentId };
    }

    const migrationRow = (spaceId: string) => db.prepare(`select * from briar_memory_vault_legacy_migrations where space_id = ?`)
      .bind(spaceId).first<{ last_error: string | null; verified_at: string | null; versions_migrated: number; next_attempt_at: string | null }>();

    const runFor = async (deps: Deps, spaceId: string) => {
      // Other tests' spaces are candidates too; run until this one has been handled.
      for (let round = 0; round < 20; round += 1) {
        const outcomes = await runLegacyMemoryMigration(deps, { limit: 5 });
        const mine = outcomes.find((outcome) => outcome.spaceId === spaceId);
        if (mine) return mine;
        if (outcomes.length === 0) return null;
      }
      return null;
    };

    const legacyCommits = async (deps: Deps, repo: string) =>
      (await deps.store.history(repo, { stopAt: null, limit: 100 }))
        .map((commit) => ({ commit, trailers: parseVaultCommitMessage(commit.message) }))
        .filter((entry) => entry.trailers?.legacy);

    it("migrates each legacy version as one commit with original timestamps, trailers and protection, and reruns as a no-op", async () => {
      const deps = memoryVaultDeps(db) as Deps;
      const legacy = await legacySpace();
      const report = await runFor(deps, legacy.spaceId);
      expect(report).toMatchObject({ migrated: 3, skipped: [], verified: 3 });
      const vault = (await vaultOfSpace(legacy.spaceId))!;
      const commits = await legacyCommits(deps, vault.repo_name);
      expect(commits.map((entry) => entry.trailers!.legacy).reverse()).toEqual([
        `${legacy.profile}@1`, `${legacy.profile}@2`, `${legacy.note}@1`,
      ]);
      expect(commits.at(-1)!.commit.authoredAt).toBe("2026-09-01T10:00:00.000Z");
      const files = (await deps.store.snapshot(vault.repo_name)).files;
      expect(files.get("entities/people/owner-profile.md")).toMatch(
        /^---\nid: owner-profile\ntype: person\nrevision: 2\ncreated_at: .*\nupdated_at: .*\n---\n# Owner profile\n\nPrefers Korean, short answers\.\n$/u);
      expect(files.get("knowledge/facts/trip.md")).toContain(`## Sources\n- message ${legacy.dm.messageId} (v1)`);
      expect((await db.prepare(`select record_id, protected_by_user from briar_memory_vault_records
        where vault_id = ? order by record_id`).bind(vault.id).all()).results)
        .toEqual([{ record_id: "owner-profile", protected_by_user: 1 }, { record_id: "trip", protected_by_user: 0 }]);
      expect((await db.prepare(`select count(*) as count from briar_memory_vault_legacy_map where vault_id = ?`)
        .bind(vault.id).first())).toEqual({ count: 3 });
      expect(await migrationRow(legacy.spaceId)).toMatchObject({ last_error: null, versions_migrated: 3, verified_at: expect.any(String) });

      // Legacy rows are untouched (rollback = flag off).
      expect(await db.prepare(`select count(*) as count from briar_dm_memory_documents where space_id = ? and status = 'active'`)
        .bind(legacy.spaceId).first()).toEqual({ count: 2 });

      // A rerun finds nothing to do; a new legacy version (written during a rollback) moves alone.
      const head = (await vaultOfSpace(legacy.spaceId))!.head_commit;
      expect(await runFor(deps, legacy.spaceId)).toBeNull();
      expect((await vaultOfSpace(legacy.spaceId))!.head_commit).toBe(head);
      await legacyEdit(legacy.dm.channelId, legacy.note, 1, "Flying to Jeju on Saturday.", "Trip");
      expect(await runFor(deps, legacy.spaceId)).toMatchObject({ migrated: 1 });
      expect((await deps.store.snapshot(vault.repo_name)).files.get("knowledge/facts/trip.md")).toContain("revision: 2");

      // The owner dialog shows the migrated records, and an old legacy citation still opens.
      const service = dmMemoryService(deps.store);
      expect((await service.list(legacy.dm.channelId)).documents.map((document) => document.title).sort())
        .toEqual(["owner-profile", "trip"]);
      const byLegacyId = await service.get(legacy.dm.channelId, legacy.profile, 1);
      expect(byLegacyId.document).toMatchObject({ title: "Owner profile", body: "Prefers Korean.\n", version: 1 });
    });

    it("resumes after a crash between the push and the ledger without duplicating a commit", async () => {
      const deps = memoryVaultDeps(db) as Deps;
      const legacy = await legacySpace();
      let pushes = 0;
      deps.store.hooks.afterPush = async () => {
        pushes += 1;
        // Push 1 creates the README; push 3 is the second legacy version.
        if (pushes === 3) throw new Error("worker evicted after the push");
      };
      expect(await runFor(deps, legacy.spaceId)).toMatchObject({ error: expect.stringContaining("worker evicted") });
      expect(await migrationRow(legacy.spaceId)).toMatchObject({ last_error: expect.stringContaining("worker evicted") });
      deps.store.hooks.afterPush = undefined;
      await db.prepare(`update briar_memory_vault_legacy_migrations set next_attempt_at = null where space_id = ?`)
        .bind(legacy.spaceId).run();
      expect(await runFor(deps, legacy.spaceId)).toMatchObject({ recovered: 1, migrated: 1, verified: 3 });
      const vault = (await vaultOfSpace(legacy.spaceId))!;
      expect((await legacyCommits(deps, vault.repo_name)).length).toBe(3);
      expect(await migrationRow(legacy.spaceId)).toMatchObject({ last_error: null });
      expect(await db.prepare(`select protected_by_user from briar_memory_vault_records where vault_id = ? and record_id = 'owner-profile'`)
        .bind(vault.id).first()).toEqual({ protected_by_user: 1 });
    });

    it("fails loudly when a migrated version no longer matches its body hash", async () => {
      const deps = memoryVaultDeps(db) as Deps;
      const legacy = await legacySpace();
      await runFor(deps, legacy.spaceId);
      const vault = (await vaultOfSpace(legacy.spaceId))!;
      // The legacy text under a migrated version changed.
      await db.prepare(`update briar_dm_memory_revisions set body = 'tampered' where document_id = ? and version = 1`)
        .bind(legacy.note).run();
      await db.prepare(`update briar_memory_vault_legacy_migrations set verified_at = null where space_id = ?`)
        .bind(legacy.spaceId).run();
      expect(await runFor(deps, legacy.spaceId)).toMatchObject({ error: expect.stringContaining("changed after it was migrated") });
      expect((await migrationRow(legacy.spaceId))!.last_error).toContain("LegacyMigrationMismatchError");
      // What Artifacts holds no longer matches the ledger.
      await db.prepare(`update briar_memory_vault_legacy_map set body_hash = ? where vault_id = ? and document_id = ?`)
        .bind("0".repeat(64), vault.id, legacy.profile).run();
      await expect(verifyLegacyMigration(deps, vault.id)).rejects.toBeInstanceOf(LegacyMigrationMismatchError);
    });

    it("forgets a migrated record the owner deleted in the legacy dialog, and forget purges the legacy document", async () => {
      const deps = memoryVaultDeps(db) as Deps;
      const legacy = await legacySpace();
      await runFor(deps, legacy.spaceId);
      const vault = (await vaultOfSpace(legacy.spaceId))!;
      // Deleted in legacy while the vault was off: the next run forgets it in the vault.
      await deleteDmMemory(db, legacyOwner(legacy.dm.channelId), legacy.note);
      expect(await runFor(deps, legacy.spaceId)).toMatchObject({ forgotten: 1 });
      expect((await deps.store.snapshot(vault.repo_name)).files.has("knowledge/facts/trip.md")).toBe(false);

      // Forget from the vault dialog purges the mapped legacy document too.
      const service = dmMemoryService(deps.store);
      await service.delete(legacy.dm.channelId, await vaultRecordHandle(vault.id, "owner-profile"));
      expect(await db.prepare(`select status from briar_dm_memory_documents where id = ?`).bind(legacy.profile).first())
        .toEqual({ status: "deleted" });
      expect(await db.prepare(`select count(*) as count from briar_dm_memory_revisions where document_id = ?`)
        .bind(legacy.profile).first()).toEqual({ count: 0 });
      expect(await db.prepare(`select count(*) as count from briar_memory_vault_legacy_map where vault_id = ?`)
        .bind(vault.id).first()).toEqual({ count: 0 });
      // The forgotten records are not resurrected by a rerun.
      expect(await runFor(deps, legacy.spaceId)).toBeNull();
    });
  });
});
