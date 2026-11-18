import { env as cloudflareEnv } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { memoryVaultDeps, memoryVaultFixture, type MemoryVaultFixture } from "../test-helpers/memory-vault-fixture";
import { MemoryVaultError } from "./errors";
import {
  collectOrphanMemoryVaultRepos,
  deleteMemoryVault,
  forgetMemoryVaultRecord,
  processMemoryVaultPurges,
  runMemoryVaultMaintenance,
} from "./forget";
import { blobId } from "./git-objects";
import { VaultRepoNotFoundError, VaultStoreUnavailableError } from "./git-store";
import {
  memoryVaultJournal,
  memoryVaultList,
  memoryVaultRead,
  memoryVaultSave,
  memoryVaultSearch,
  type MemoryVaultCaller,
  type MemoryVaultDeps,
} from "./operations";
import { vaultRepoName } from "./vault-repository";

const db = cloudflareEnv.DB;

const save = (deps: MemoryVaultDeps, caller: MemoryVaultCaller, id: string, type: string, content: string, expectedRevision: number | null = null) =>
  memoryVaultSave(deps, caller, {
    requestId: crypto.randomUUID(), id, type, status: null, aliases: [], expectedRevision, userRequested: false, content,
  });

async function code(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof MemoryVaultError) return error.vaultCode;
    throw error;
  }
  return null;
}

type Vault = { id: string; repo_name: string; generation: number; head_commit: string; state: string };

describe("memory vault forget and purge", () => {
  let fixture: MemoryVaultFixture;

  beforeAll(async () => {
    fixture = await memoryVaultFixture(db);
  }, 120_000);

  const vaultFor = (scopeKey: string) => db.prepare(`select * from briar_memory_vaults where scope_key = ?`)
    .bind(scopeKey).first<Vault>();

  it("removes the record now and purges it from every generation of history", async () => {
    const deps = memoryVaultDeps(db);
    const group = await fixture.claimChannel("channel", fixture.ownerId);
    const secret = "forget-me-7731 private detail";
    const first = await save(deps, group.caller, "secret-topic", "fact", secret);
    await save(deps, group.caller, "kept", "fact", "kept v1");
    await save(deps, group.caller, "kept", "fact", "kept v2", 1);
    await memoryVaultRead(deps, group.caller, { target: "secret-topic", revision: null });
    const vault = (await vaultFor(group.channelId))!;
    const secretFile = await deps.store.readFile(vault.repo_name, first.commit, "knowledge/facts/secret-topic.md");
    const secretBlob = await blobId(secretFile!);

    const forgotten = await forgetMemoryVaultRecord(deps, { vaultId: vault.id, recordId: "secret-topic", actor: `user:${fixture.ownerId}` });
    expect(forgotten.purgeGeneration).toBe(1);
    expect((await deps.store.snapshot(vault.repo_name)).files.has("knowledge/facts/secret-topic.md")).toBe(false);
    expect(await db.prepare(`select deleted_at is not null as deleted, protected_by_user from briar_memory_vault_records
      where vault_id = ? and record_id = 'secret-topic'`).bind(vault.id).first()).toEqual({ deleted: 1, protected_by_user: 0 });
    for (const table of ["briar_memory_vault_revisions", "briar_memory_vault_claim_reads"]) {
      expect((await db.prepare(`select count(*) as n from ${table} where vault_id = ? and record_id = 'secret-topic'`)
        .bind(vault.id).first<{ n: number }>())!.n).toBe(0);
    }
    const job = await db.prepare(`select paths_json, completed_at from briar_memory_vault_purges where vault_id = ?`)
      .bind(vault.id).first<{ paths_json: string; completed_at: string | null }>();
    expect(JSON.parse(job!.paths_json)).toEqual([{ path: "knowledge/facts/secret-topic.md", commit: forgotten.commit }]);
    expect(job!.completed_at).toBeNull();
    expect(await code(memoryVaultRead(deps, group.caller, { target: "secret-topic", revision: null }))).toBe("not_found");
    // Before the purge the old objects are still in the repository.
    expect(await deps.store.holdsObject(vault.repo_name, secretBlob)).toBe(true);

    // Writes wait from the start of the rebuild until the switch.
    const rewrite = deps.store.rewrite.bind(deps.store);
    const duringPurge: (string | null)[] = [];
    deps.store.rewrite = async (...args) => {
      duringPurge.push(await code(save(deps, group.caller, "late", "fact", "late")));
      duringPurge.push(await code(memoryVaultJournal(deps, group.caller, {
        requestId: crypto.randomUUID(), text: "late", occurredAt: null, references: [], userRequested: false,
      })));
      return rewrite(...args);
    };
    expect(await processMemoryVaultPurges(deps)).toEqual([{ vaultId: vault.id, generation: 1, outcome: "purged" }]);
    deps.store.rewrite = rewrite;
    expect(duringPurge).toEqual(["busy", "busy"]);

    const switched = (await vaultFor(group.channelId))!;
    expect(switched).toMatchObject({ generation: 2, repo_name: vaultRepoName(vault.id, 2), state: "active" });
    expect(await deps.store.repoExists(vault.repo_name)).toBe(false);
    await expect(deps.store.readFile(vault.repo_name, first.commit, "knowledge/facts/secret-topic.md"))
      .rejects.toBeInstanceOf(VaultRepoNotFoundError);
    expect(await deps.store.holdsObject(switched.repo_name, secretBlob)).toBe(false);
    const history = await deps.store.history(switched.repo_name, { stopAt: null, limit: 100 });
    expect(history.some((commit) => commit.message.includes("secret-topic"))).toBe(false);
    expect(switched.head_commit).toBe(history[0].oid);
    expect((await db.prepare(`select completed_at is not null as done, last_error from briar_memory_vault_purges where vault_id = ?`)
      .bind(vault.id).first())).toEqual({ done: 1, last_error: null });

    // The rest of the vault survived with its revision map pointing into the new generation.
    expect((await memoryVaultRead(deps, group.caller, { target: "kept", revision: 1 })).body).toBe("kept v1\n");
    expect((await memoryVaultRead(deps, group.caller, { target: "kept", revision: null })).body).toBe("kept v2\n");
    expect((await memoryVaultSearch(deps, group.caller, { text: "forget-me-7731", type: null, prefix: null, cursor: null, limit: null })).hits).toEqual([]);
    const after = await save(deps, group.caller, "after-purge", "fact", "writes work again");
    expect(after.revision).toBe(1);
  });

  it("keeps a record re-created under the forgotten id before the purge ran", async () => {
    const deps = memoryVaultDeps(db);
    const group = await fixture.claimChannel("channel", fixture.ownerId);
    const old = await save(deps, group.caller, "renamed", "fact", "old-content-5512");
    const vault = (await vaultFor(group.channelId))!;
    const oldBlob = await blobId((await deps.store.readFile(vault.repo_name, old.commit, "knowledge/facts/renamed.md"))!);
    await forgetMemoryVaultRecord(deps, { vaultId: vault.id, recordId: "renamed", actor: "system" });
    const recreated = await save(deps, group.caller, "renamed", "fact", "new-content");
    expect(recreated.revision).toBe(1);
    await processMemoryVaultPurges(deps);
    const switched = (await vaultFor(group.channelId))!;
    expect(switched.generation).toBe(2);
    expect((await memoryVaultRead(deps, group.caller, { target: "renamed", revision: null })).body).toBe("new-content\n");
    expect(await deps.store.holdsObject(switched.repo_name, oldBlob)).toBe(false);
  });

  it("resumes an interrupted purge and rebuilds a half-built target", async () => {
    const deps = memoryVaultDeps(db);
    const group = await fixture.claimChannel("channel", fixture.ownerId);
    await save(deps, group.caller, "gone", "fact", "x");
    await save(deps, group.caller, "stays", "fact", "y");
    const vault = (await vaultFor(group.channelId))!;
    await forgetMemoryVaultRecord(deps, { vaultId: vault.id, recordId: "gone", actor: "system" });

    const rewrite = deps.store.rewrite.bind(deps.store);
    deps.store.rewrite = async (...args) => {
      await rewrite(...args);
      throw new VaultStoreUnavailableError("worker evicted mid-push");
    };
    expect((await processMemoryVaultPurges(deps))[0].outcome).toBe("failed");
    deps.store.rewrite = rewrite;
    const failed = await db.prepare(`select last_error, lease_expires_at, completed_at from briar_memory_vault_purges where vault_id = ?`)
      .bind(vault.id).first<{ last_error: string; lease_expires_at: string; completed_at: string | null }>();
    expect(failed!.last_error).toContain("worker evicted");
    expect(failed!.completed_at).toBeNull();
    expect((await vaultFor(group.channelId))).toMatchObject({ generation: 1, state: "active" });
    expect(await deps.store.repoExists(vaultRepoName(vault.id, 2))).toBe(true);
    // Not due yet: the backoff holds the job.
    expect(await processMemoryVaultPurges(deps)).toEqual([]);
    await db.prepare(`update briar_memory_vault_purges set lease_expires_at = ? where vault_id = ?`)
      .bind(new Date(Date.now() - 1_000).toISOString(), vault.id).run();
    expect((await processMemoryVaultPurges(deps))[0].outcome).toBe("purged");
    expect((await vaultFor(group.channelId))!.generation).toBe(2);
    expect(await deps.store.repoExists(vaultRepoName(vault.id, 1))).toBe(false);
    expect((await memoryVaultList(deps, group.caller, { type: null, prefix: null, status: null, cursor: null, limit: null }))
      .records.map((record) => record.id)).toEqual(["readme", "stays"]);
  });

  it("bumps the DM space's revocation epoch, which ends claims that may have seen the record", async () => {
    const deps = memoryVaultDeps(db);
    const dm = await fixture.claimChannel("dm", fixture.ownerId);
    await fixture.setDmMemory(dm.channelId, { use: true, auto: true });
    await save(deps, dm.caller, "private", "fact", "x");
    const spaceId = await fixture.spaceOf(dm.channelId);
    const before = await db.prepare(`select revocation_epoch, memory_revision from briar_dm_memory_spaces where id = ?`)
      .bind(spaceId).first<{ revocation_epoch: number; memory_revision: number }>();
    const vault = (await vaultFor(spaceId))!;
    await forgetMemoryVaultRecord(deps, { vaultId: vault.id, recordId: "private", actor: `user:${fixture.ownerId}` });
    expect(await db.prepare(`select revocation_epoch, memory_revision from briar_dm_memory_spaces where id = ?`).bind(spaceId).first())
      .toEqual({ revocation_epoch: before!.revocation_epoch + 1, memory_revision: before!.memory_revision + 1 });
    expect(await code(memoryVaultList(deps, dm.caller, { type: null, prefix: null, status: null, cursor: null, limit: null }))).toBe("claim_inactive");
    expect(await code(forgetMemoryVaultRecord(deps, { vaultId: vault.id, recordId: "private", actor: "system" }))).toBe("not_found");
    // The revoked reply would otherwise be handed out again ahead of later fixtures' replies.
    await db.prepare(`update briar_channel_agent_reply_jobs set status = 'failed' where id = ?`).bind(dm.jobId).run();
  });

  it("sweeps repositories no vault owns, but never a live generation or an open purge target", async () => {
    const deps = memoryVaultDeps(db);
    const group = await fixture.claimChannel("channel", fixture.ownerId);
    await save(deps, group.caller, "x", "fact", "x");
    const vault = (await vaultFor(group.channelId))!;
    const orphan = vaultRepoName(crypto.randomUUID(), 1);
    const stale = vaultRepoName(vault.id, 7);
    const fresh = vaultRepoName(crypto.randomUUID(), 1);
    for (const name of [orphan, stale, fresh, "unrelated-repo"]) await deps.store.createRepo(name);
    const old = new Date(Date.now() - 2 * 3_600_000).toISOString();
    for (const name of [orphan, stale, vault.repo_name, "unrelated-repo"]) deps.store.backdate(name, old);
    const swept = await collectOrphanMemoryVaultRepos(deps);
    expect(swept.deleted.sort()).toEqual([orphan, stale].sort());
    expect(await deps.store.repoExists(vault.repo_name)).toBe(true);
    expect(await deps.store.repoExists(fresh)).toBe(true);
    expect(await deps.store.repoExists("unrelated-repo")).toBe(true);
  });

  it("deletes a whole vault and its repository", async () => {
    const deps = memoryVaultDeps(db);
    const group = await fixture.claimChannel("channel", fixture.ownerId);
    await save(deps, group.caller, "x", "fact", "x");
    const vault = (await vaultFor(group.channelId))!;
    expect(await deleteMemoryVault(deps, vault.id)).toBe(true);
    expect(await vaultFor(group.channelId)).toBeNull();
    expect(await db.prepare(`select count(*) as n from briar_memory_vault_records where vault_id = ?`).bind(vault.id).first())
      .toEqual({ n: 0 });
    expect(await deps.store.repoExists(vault.repo_name)).toBe(false);
  });

  it("skips maintenance without an Artifacts binding", async () => {
    expect(await runMemoryVaultMaintenance({ db, store: null }, "minute")).toEqual({ skipped: "no_artifacts_binding" });
    const deps = memoryVaultDeps(db);
    expect(await runMemoryVaultMaintenance(deps, "six_hourly")).toMatchObject({ orphans: { deleted: [] } });
  });
});
