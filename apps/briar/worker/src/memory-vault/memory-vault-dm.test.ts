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
  UpdateDmMemoryDocumentRequestSchema,
  UpdateDmMemorySettingsRequestSchema,
  type CreateDmMemoryDocumentResponse,
  type DeleteDmMemoryDocumentResponse,
  type GetDmMemoryDocumentResponse,
  type ListDmMemoriesResponse,
  type ListDmMemoryRevisionsResponse,
  type UpdateDmMemoryDocumentResponse,
  type UpdateDmMemorySettingsResponse,
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
import { flushDmMemoryActivityRevocations } from "../dm-memory-activity-revocations";
import { bindDmMemoryReplyClaim, excludeForgottenDmSources } from "../dm-memory-claim";
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
  memoryVaultList,
  memoryVaultRead,
  memoryVaultSave,
  type MemoryVaultCaller,
  type MemoryVaultDeps,
} from "./operations";
import { parseVaultCommitMessage } from "./trailers";

/*
  DM memory end to end on the vault: the reply fence every DM claim gets, what
  an older Worker CLI sees, citations, and the owner's DmMemoryService.
*/

const db = cloudflareEnv.DB;

type Deps = MemoryVaultDeps & { store: InMemoryVaultGitStore };

const testEnv = { DB: db } as unknown as Env;

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

describe("DM memory on the vault", () => {
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
  const dmMemoryService = (store: InMemoryVaultGitStore | null, userId = fixture.ownerId) => {
    const service = createAppDmMemoryService({
      request: new Request("https://briar.example"), auth: auth(userId), db, env: testEnv,
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
      // Older clients still send the legacy language field; it is ignored.
      create: (channelId: string, input: { title: string; body: string; memoryClass?: ProtoDmMemoryClass; requestId?: string }) =>
        service.createDmMemoryDocument(create(CreateDmMemoryDocumentRequestSchema, {
          ...scope(channelId), requestId: input.requestId ?? crypto.randomUUID(), title: input.title, body: input.body,
          memoryClass: input.memoryClass ?? ProtoDmMemoryClass.NOTE, sourceLanguage: "en",
        }), context) as Promise<CreateDmMemoryDocumentResponse>,
      update: (channelId: string, documentId: string, expectedVersion: number,
        input: { title: string; body: string; memoryClass?: ProtoDmMemoryClass }) =>
        service.updateDmMemoryDocument(create(UpdateDmMemoryDocumentRequestSchema, {
          ...scope(channelId), documentId, requestId: crypto.randomUUID(), expectedVersion, title: input.title,
          body: input.body, memoryClass: input.memoryClass ?? ProtoDmMemoryClass.NOTE,
        }), context) as Promise<UpdateDmMemoryDocumentResponse>,
      delete: (channelId: string, documentId: string) => service.deleteDmMemoryDocument(
        create(DeleteDmMemoryDocumentRequestSchema, { ...scope(channelId), documentId }),
        context) as Promise<DeleteDmMemoryDocumentResponse>,
      settings: (channelId: string, input: { requestId: string; expectedMemoryRevision: number; use: boolean; auto: boolean }) =>
        service.updateDmMemorySettings(create(UpdateDmMemorySettingsRequestSchema, {
          ...scope(channelId), requestId: input.requestId, expectedMemoryRevision: BigInt(input.expectedMemoryRevision),
          useEnabled: input.use, autoEnabled: input.auto,
        }), context) as Promise<UpdateDmMemorySettingsResponse>,
    };
  };

  const vaultOfSpace = (spaceId: string) => db.prepare(`select * from briar_memory_vaults where dm_space_id = ?`)
    .bind(spaceId).first<{ id: string; repo_name: string; generation: number; head_commit: string | null }>();

  const fenceOf = (jobId: string) => db.prepare(`select protocol, space_id from briar_dm_memory_reply_fences where job_id = ?`)
    .bind(jobId).first<{ protocol: number; space_id: string }>();

  const spaceRow = (spaceId: string) => db.prepare(`select use_enabled, auto_enabled, memory_revision, revocation_epoch
    from briar_dm_memory_spaces where id = ?`).bind(spaceId)
    .first<{ use_enabled: number; auto_enabled: number; memory_revision: number; revocation_epoch: number }>();

  it("fences every DM claim to its space and keeps each vault private to it", async () => {
    await fixture.setVaultCapable(true);
    const deps = memoryVaultDeps(db) as Deps;
    const mine = await fixture.claimChannel("dm", fixture.ownerId, "remember");
    expect(mine.claimed).not.toHaveProperty("memory");
    expect(mine.claimed).not.toHaveProperty("memoryLearningEnabled");
    expect(await fenceOf(mine.jobId)).toMatchObject({ protocol: 0, space_id: await fixture.spaceOf(mine.channelId) });
    await fixture.setDmMemory(mine.channelId, { use: true, auto: true });
    await save(deps, mine.caller, "secret-plan", "Owner A private plan");
    const vault = (await vaultOfSpace(await fixture.spaceOf(mine.channelId)))!;
    expect(vault).toMatchObject({ head_commit: expect.any(String) });
    expect((await read(deps, mine.caller, "secret-plan")).body).toBe("Owner A private plan\n");

    // User B's DM with the same Agent, a group channel and a project run never see it.
    const theirs = await fixture.claimChannel("dm", fixture.otherUserId, "hello");
    await fixture.setDmMemory(theirs.channelId, { use: true, auto: true });
    expect(await listIds(deps, theirs.caller)).toEqual(["readme"]);
    expect(await vaultCode(read(deps, theirs.caller, "secret-plan"))).toBe("not_found");
    const group = await fixture.claimChannel("channel", fixture.ownerId, "hello");
    expect(await fenceOf(group.jobId)).toBeNull();
    expect(await listIds(deps, group.caller)).toEqual(["readme"]);
    expect(await vaultCode(read(deps, group.caller, "secret-plan"))).toBe("not_found");
    const run = await fixture.claimIssueRun();
    expect(await vaultCode(read(deps, run.caller, "secret-plan"))).toBe("not_found");
    const task = await fixture.claimAgentTask();
    expect(await listIds(deps, task.caller)).toEqual(["readme"]);
  });

  it("resumes a vault Worker's conversation while the epoch holds and resets everyone else's", async () => {
    await fixture.setVaultCapable(true);
    const dm = await fixture.claimChannel("dm", fixture.ownerId, "resume");
    const claimTokenHash = await sha256(dm.claimToken);
    const session = async () => db.prepare(`select session.conversation_id from briar_channel_reply_sessions session
      join briar_channel_agent_reply_jobs job on job.session_id = session.id where job.id = ?`)
      .bind(dm.jobId).first<{ conversation_id: string | null }>();
    const setConversation = () => db.prepare(`update briar_channel_reply_sessions set conversation_id = 'conv-1'
      where id = (select session_id from briar_channel_agent_reply_jobs where id = ?)`).bind(dm.jobId).run();
    await setConversation();
    await bindDmMemoryReplyClaim(db, { jobId: dm.jobId, claimTokenHash, vaultCapable: true });
    expect((await session())?.conversation_id).toBe("conv-1");
    // A Worker without the vault cannot honour a later revocation, so it starts fresh.
    await bindDmMemoryReplyClaim(db, { jobId: dm.jobId, claimTokenHash, vaultCapable: false });
    expect((await session())?.conversation_id).toBeNull();
    expect((await fenceOf(dm.jobId))?.protocol).toBe(0);
  });

  it("degrades an older Worker CLI to no memory and drops its legacy citations without failing the reply", async () => {
    await fixture.setVaultCapable(false);
    // What a 1.2.232 Worker advertised: the retired D1 memory protocol and learning.
    await db.prepare(`update briar_execution_workers set runtime_proto_json = json_set(runtime_proto_json,
        '$.capabilities.dmMemoryProtocol', 1, '$.capabilities.dmMemoryLearningRequests', 1) where id = ?`)
      .bind(fixture.workerId).run();
    try {
      const dm = await fixture.claimChannel("dm", fixture.ownerId, "old cli");
      expect(dm.claimed).not.toHaveProperty("memory");
      expect((await fenceOf(dm.jobId))?.protocol).toBe(0);
      const deps = memoryVaultDeps(db) as Deps;
      await fixture.setDmMemory(dm.channelId, { use: true, auto: true });
      // The vault tools still answer for the claim; the old CLI simply never calls them.
      expect(await listIds(deps, dm.caller)).toEqual(["readme"]);
      await completeWith(dm, [{ documentId: crypto.randomUUID(), version: 1 }]);
      const job = (await db.prepare(`select status, reply_message_id from briar_channel_agent_reply_jobs where id = ?`)
        .bind(dm.jobId).first<{ status: string; reply_message_id: string }>())!;
      expect(job.status).toBe("completed");
      expect((await getChannelMessage(db, dm.channelId, job.reply_message_id))?.memoryCitations).toEqual([]);
    } finally {
      await db.prepare(`update briar_execution_workers set runtime_proto_json = json_remove(runtime_proto_json,
          '$.capabilities.dmMemoryProtocol', '$.capabilities.dmMemoryLearningRequests') where id = ?`)
        .bind(fixture.workerId).run();
    }
  });

  it("applies the owner's switches idempotently and revokes running claims when one is turned off", async () => {
    await fixture.setVaultCapable(true);
    const deps = memoryVaultDeps(db) as Deps;
    const dm = await fixture.claimChannel("dm", fixture.ownerId, "settings");
    const spaceId = await fixture.spaceOf(dm.channelId);
    const service = dmMemoryService(deps.store);
    const before = (await spaceRow(spaceId))!;
    const requestId = crypto.randomUUID();
    const on = { requestId, expectedMemoryRevision: before.memory_revision, use: true, auto: true };
    const enabled = await service.settings(dm.channelId, on);
    expect(enabled.space).toMatchObject({ useEnabled: true, autoEnabled: true });
    // Same request id and payload: the stored result, not a version conflict.
    expect((await service.settings(dm.channelId, on)).space).toMatchObject({ useEnabled: true, autoEnabled: true });
    await expect(service.settings(dm.channelId, { ...on, auto: false }))
      .rejects.toMatchObject({ code: "idempotency_conflict" });
    const afterOn = (await spaceRow(spaceId))!;
    expect(afterOn.revocation_epoch).toBe(before.revocation_epoch);
    expect(await listIds(deps, dm.caller)).toEqual(["readme"]);

    // Turning automatic memory off ends the running claim: it is queued again and its activity cleared.
    await service.settings(dm.channelId, {
      requestId: crypto.randomUUID(), expectedMemoryRevision: afterOn.memory_revision, use: true, auto: false,
    });
    expect((await spaceRow(spaceId))!.revocation_epoch).toBe(afterOn.revocation_epoch + 1);
    expect(await db.prepare(`select status from briar_channel_agent_reply_jobs where id = ?`).bind(dm.jobId).first())
      .toEqual({ status: "queued" });
    expect(await vaultCode(listIds(deps, dm.caller))).toBe("claim_inactive");
    const published: string[] = [];
    await flushDmMemoryActivityRevocations(db, testEnv, async (_env, organizationId) => {
      published.push(organizationId);
    });
    expect(published).toContain(fixture.workspaceId);
    expect(await db.prepare(`select count(*) as count from briar_dm_memory_activity_revocations where id = ?`)
      .bind(dm.jobId).first()).toEqual({ count: 0 });
  });

  it("keeps source messages of memories forgotten under the retired D1 memory out of Agent snapshots", async () => {
    await fixture.setVaultCapable(true);
    const dm = await fixture.claimChannel("dm", fixture.ownerId, "forgotten source");
    const spaceId = await fixture.spaceOf(dm.channelId);
    await db.prepare(`insert into briar_dm_memory_exclusions
        (space_id, source_type, source_id, document_id, revocation_epoch, created_at)
      values (?, 'message', ?, ?, 0, ?)`)
      .bind(spaceId, dm.messageId, crypto.randomUUID(), new Date().toISOString()).run();
    const kept = { id: crypto.randomUUID() };
    expect(await excludeForgottenDmSources(db, dm.channelId, [{ id: dm.messageId }, kept])).toEqual([kept]);
  });

  /** Completes a channel reply through the protobuf mapper and the application, as the Worker CLI does. */
  async function completeWith(claim: Awaited<ReturnType<MemoryVaultFixture["claimChannel"]>>, citations: { documentId: string; version: number }[]) {
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
      env: testEnv,
      worker: { principal: { workspaceId: fixture.workspaceId, deviceId: fixture.deviceId },
        binding: { id: fixture.workerId, project_id: fixture.projectId } },
      request,
    });
  }

  it("keeps only citations of records the claim read, shows them by handle, and drops them on forget", async () => {
    await fixture.setVaultCapable(true);
    const deps = memoryVaultDeps(db) as Deps;
    const dm = await fixture.claimChannel("dm", fixture.ownerId, "what do I like?");
    await fixture.setDmMemory(dm.channelId, { use: true, auto: true });
    await save(deps, dm.caller, "drinks", "Tea, no sugar.");
    await save(deps, dm.caller, "unread", "Never read on this claim.");
    await read(deps, dm.caller, "drinks");
    await completeWith(dm, [
      { documentId: "drinks", version: 1 },
      { documentId: "unread", version: 1 },
      { documentId: "drinks", version: 7 },
    ]);
    const job = (await db.prepare(`select status, reply_message_id from briar_channel_agent_reply_jobs where id = ?`)
      .bind(dm.jobId).first<{ status: string; reply_message_id: string }>())!;
    expect(job.status).toBe("completed");
    const vault = (await vaultOfSpace(await fixture.spaceOf(dm.channelId)))!;
    const handle = await vaultRecordHandle(vault.id, "drinks");
    expect((await getChannelMessage(db, dm.channelId, job.reply_message_id))?.memoryCitations)
      .toEqual([{ documentId: handle, version: 1 }]);

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
    const dm = await fixture.claimChannel("dm", fixture.ownerId, "owner edits");
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
    // The first save turns recall on.
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

    // Export is the head tree.
    const url = new URL(`https://briar.example/workspaces/${fixture.workspaceId}/channels/${dm.channelId}/memory/export`);
    const response = (await handleDmMemoryRoute({
      request: new Request(url), url, auth: auth(fixture.ownerId), db, memoryVaultStore: deps.store,
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
    const dm = await fixture.claimChannel("dm", fixture.ownerId, "forget this");
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
      { request: new Request("https://briar.example"), db, env: testEnv },
      create(MemoryVaultListRequestSchema, {}),
      { requireWorkerProjectBinding, memoryVaultStore: () => null },
    )).rejects.toMatchObject({ vaultCode: "claim_inactive", status: 409 });
  });

});
