import { MemoryVaultError } from "./errors";
import type { VaultGitStore } from "./git-store";
import { commitWithRetry, type MemoryVaultDeps } from "./operations";
import { parseRecordPath } from "./records";
import { scrubVaultCommitMessage, vaultCommitMessage, type TrailerRecord } from "./trailers";
import {
  VAULT_REPO_NAME,
  getVault,
  reconcileVault,
  vaultIdFromHex,
  vaultRepoName,
  type VaultRow,
} from "./vault-repository";

/**
 * Forget (spec §10). Step 1 removes the record from the head immediately and
 * revokes what D1 knows about it; step 2, a leased purge job, rebuilds the
 * repository's history without the record into a new generation and deletes
 * the old repository, because a history rewrite alone leaves the old objects
 * readable by hash.
 */
type PurgePath = { readonly path: string; readonly commit: string };

export type MemoryVaultMaintenanceDeps = Pick<MemoryVaultDeps, "db" | "now" | "sleep" | "random"> & {
  readonly store: VaultGitStore;
};

const clock = (deps: { now?: () => Date }) => deps.now?.() ?? new Date();

export async function forgetMemoryVaultRecord(deps: MemoryVaultMaintenanceDeps, input: {
  readonly vaultId: string;
  readonly recordId: string;
  /** `user:<id>` for the owner in the app, `system` for erasure. */
  readonly actor: string;
}) {
  const found = await getVault(deps.db, input.vaultId);
  if (!found) throw new MemoryVaultError("not_found", "Memory vault not found");
  if (found.state === "purging") throw new MemoryVaultError("busy", "Memory is being purged; retry shortly");
  const now = () => clock(deps).toISOString();
  const vault = await reconcileVault(deps.db, deps.store, found, now);
  const row = await deps.db.prepare(`select path from briar_memory_vault_records
    where vault_id = ? and record_id = ? and deleted_at is null`)
    .bind(vault.id, input.recordId).first<{ path: string }>();
  if (!row) throw new MemoryVaultError("not_found", `No memory record ${input.recordId}`);
  const historicPaths = (await deps.db.prepare(`select distinct path from briar_memory_vault_revisions
    where vault_id = ? and record_id = ?`).bind(vault.id, input.recordId).all<{ path: string }>()).results
    .map((revision) => revision.path);

  const outcome = await commitWithRetry<{ removed: string[] }>(deps, vault, async (head) => {
    const files = new Map(head.files);
    const removed = [...files.keys()].filter((path) => parseRecordPath(path)?.id === input.recordId);
    if (removed.length === 0) return { kind: "skip", value: { result: { removed }, records: [], revisions: [] } };
    for (const path of removed) files.delete(path);
    const records: TrailerRecord[] = removed.map((path) => ({ recordId: input.recordId, path, revision: 0 }));
    return {
      kind: "commit",
      files,
      message: vaultCommitMessage(`memory: forget ${input.recordId}`, {
        vaultId: vault.id, operation: "forget", requestId: null, payloadHash: null, actor: input.actor,
        claim: null, records, journalLine: null,
      }),
      timestamp: Math.floor(clock(deps).getTime() / 1000),
      value: { result: { removed }, records: [], revisions: [] },
    };
  });
  const forgetCommit = outcome.kind === "committed" ? outcome.commit : outcome.head;
  const paths = [...new Set([row.path, ...historicPaths, ...outcome.value.result.removed])];
  const purgePaths: PurgePath[] = forgetCommit ? paths.map((path) => ({ path, commit: forgetCommit })) : [];
  const timestamp = now();
  await deps.db.batch([
    ...(outcome.kind === "committed"
      ? [deps.db.prepare(`update briar_memory_vaults set head_commit = ?, synced_at = ?, updated_at = ?
          where id = ? and generation = ? and head_commit is ?`)
          .bind(outcome.commit, timestamp, timestamp, vault.id, vault.generation, outcome.base)]
      : []),
    deps.db.prepare(`update briar_memory_vault_records set deleted_at = coalesce(deleted_at, ?), protected_by_user = 0
      where vault_id = ? and record_id = ?`).bind(timestamp, vault.id, input.recordId),
    deps.db.prepare(`delete from briar_memory_vault_revisions where vault_id = ? and record_id = ?`)
      .bind(vault.id, input.recordId),
    deps.db.prepare(`delete from briar_memory_vault_claim_reads where vault_id = ? and record_id = ?`)
      .bind(vault.id, input.recordId),
    deps.db.prepare(`delete from briar_memory_vault_reply_citations where vault_id = ? and record_id = ?`)
      .bind(vault.id, input.recordId),
    deps.db.prepare(`insert into briar_memory_vault_purges
        (vault_id, source_generation, paths_json, requested_at, updated_at)
      values (?, ?, ?, ?, ?)
      on conflict (vault_id, source_generation) do update set
        paths_json = (select json_group_array(json(value)) from (
          select value from json_each(briar_memory_vault_purges.paths_json)
          union all select value from json_each(excluded.paths_json))),
        updated_at = excluded.updated_at`)
      .bind(vault.id, vault.generation, JSON.stringify(purgePaths), timestamp, timestamp),
    // Existing fences stop every resumed conversation that may have seen it.
    ...(vault.dm_space_id
      ? [deps.db.prepare(`update briar_dm_memory_spaces set revocation_epoch = revocation_epoch + 1,
          memory_revision = memory_revision + 1, updated_at = ? where id = ?`).bind(timestamp, vault.dm_space_id)]
      : []),
  ]);
  const current = await getVault(deps.db, vault.id);
  if (current && outcome.kind === "committed" && current.head_commit !== outcome.commit) {
    await reconcileVault(deps.db, deps.store, current, now);
  }
  return { commit: forgetCommit, purgeGeneration: vault.generation };
}

type PurgeRow = {
  vault_id: string;
  source_generation: number;
  paths_json: string;
  lease_token: string | null;
  attempts: number;
  switched_at: string | null;
};

const PURGE_LEASE_MS = 10 * 60_000;

/** Runs due purge jobs. Leased, resumable and idempotent; safe to call every minute. */
export async function processMemoryVaultPurges(deps: MemoryVaultMaintenanceDeps, options: { readonly limit?: number } = {}) {
  const now = clock(deps).toISOString();
  const due = (await deps.db.prepare(`select vault_id, source_generation from briar_memory_vault_purges
    where completed_at is null and (lease_expires_at is null or lease_expires_at <= ?)
    order by requested_at limit ?`).bind(now, options.limit ?? 2)
    .all<{ vault_id: string; source_generation: number }>()).results;
  const outcomes: { vaultId: string; generation: number; outcome: string }[] = [];
  for (const job of due) {
    const token = crypto.randomUUID();
    const claimed = await deps.db.prepare(`update briar_memory_vault_purges
      set lease_token = ?, lease_expires_at = ?, attempts = attempts + 1, started_at = coalesce(started_at, ?), updated_at = ?
      where vault_id = ? and source_generation = ? and completed_at is null
        and (lease_expires_at is null or lease_expires_at <= ?)`)
      .bind(token, new Date(Date.parse(now) + PURGE_LEASE_MS).toISOString(), now, now,
        job.vault_id, job.source_generation, now).run();
    if ((claimed.meta.changes ?? 0) !== 1) continue;
    try {
      outcomes.push({ vaultId: job.vault_id, generation: job.source_generation, outcome: await runPurge(deps, job, token) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempts = (await deps.db.prepare(`select attempts from briar_memory_vault_purges
        where vault_id = ? and source_generation = ?`).bind(job.vault_id, job.source_generation)
        .first<{ attempts: number }>())?.attempts ?? 1;
      const retryAt = new Date(clock(deps).getTime() + Math.min(30, attempts) * 60_000).toISOString();
      await deps.db.batch([
        deps.db.prepare(`update briar_memory_vault_purges set last_error = ?, lease_token = null, lease_expires_at = ?,
          updated_at = ? where vault_id = ? and source_generation = ? and lease_token = ?`)
          .bind(message.slice(0, 2000), retryAt, clock(deps).toISOString(), job.vault_id, job.source_generation, token),
        // Writes resume until the next attempt; it starts over from the then-current head.
        deps.db.prepare(`update briar_memory_vaults set state = 'active', updated_at = ?
          where id = ? and generation = ? and state = 'purging'`)
          .bind(clock(deps).toISOString(), job.vault_id, job.source_generation),
      ]);
      console.error(JSON.stringify({ message: "memory vault purge failed", vaultId: job.vault_id,
        generation: job.source_generation, error: message }));
      outcomes.push({ vaultId: job.vault_id, generation: job.source_generation, outcome: "failed" });
    }
  }
  return outcomes;
}

const forgottenIdsOf = (paths: readonly PurgePath[]) =>
  new Set(paths.map((entry) => parseRecordPath(entry.path)?.id).filter((id): id is string => Boolean(id)));

async function runPurge(deps: MemoryVaultMaintenanceDeps, job: { vault_id: string; source_generation: number }, token: string) {
  const db = deps.db;
  const now = () => clock(deps).toISOString();
  const finish = (outcome: string) => db.prepare(`update briar_memory_vault_purges
    set completed_at = ?, lease_token = null, lease_expires_at = null, last_error = null, updated_at = ?
    where vault_id = ? and source_generation = ? and lease_token = ?`)
    .bind(now(), now(), job.vault_id, job.source_generation, token).run().then(() => outcome);
  const purge = await db.prepare(`select * from briar_memory_vault_purges where vault_id = ? and source_generation = ?`)
    .bind(job.vault_id, job.source_generation).first<PurgeRow>();
  const generation = job.source_generation;
  const source = vaultRepoName(job.vault_id, generation);
  const target = vaultRepoName(job.vault_id, generation + 1);
  let vault = await getVault(db, job.vault_id);
  if (!purge || !vault) return finish("vault_deleted");
  if (!purge.switched_at) {
    if (vault.generation === generation + 1) {
      await db.prepare(`update briar_memory_vault_purges set switched_at = ? where vault_id = ? and source_generation = ?`)
        .bind(now(), job.vault_id, generation).run();
    } else if (vault.generation !== generation) {
      return finish("stale");
    } else {
      // Writes wait (`busy`) from here until the switch.
      await db.prepare(`update briar_memory_vaults set state = 'purging', updated_at = ? where id = ? and generation = ?`)
        .bind(now(), vault.id, generation).run();
      vault = await reconcileVault(db, deps.store, { ...vault, state: "purging" }, now);
      const paths = JSON.parse(purge.paths_json) as PurgePath[];
      const drops = new Map<string, Set<string>>();
      for (const entry of paths) drops.set(entry.path, (drops.get(entry.path) ?? new Set()).add(entry.commit));
      const rewritten = await deps.store.rewrite(source, target, {
        drops,
        scrubMessage: (message, dropped) => scrubVaultCommitMessage(message, forgottenIdsOf(paths.filter((entry) => dropped.has(entry.path))), dropped),
      });
      if (rewritten.sourceHead !== vault.head_commit) throw new Error("The vault moved while it was being purged");
      const targetTree = await deps.store.headTree(target);
      if (targetTree !== rewritten.sourceHeadTree) {
        throw new Error("The rebuilt repository's head tree differs from the source head tree");
      }
      if (await deps.store.head(source) !== rewritten.sourceHead) throw new Error("The vault moved while it was being purged");
      const mapping = JSON.stringify(Object.fromEntries(rewritten.mapping));
      const switched = `exists (select 1 from briar_memory_vaults where id = ? and generation = ?)`;
      const remap = (table: string) => db.prepare(`update ${table}
        set commit_sha = (select value from json_each(?) where key = ${table}.commit_sha)
        where vault_id = ? and commit_sha in (select key from json_each(?)) and ${switched}`)
        .bind(mapping, job.vault_id, mapping, job.vault_id, generation + 1);
      const timestamp = now();
      const [moved] = await db.batch([
        db.prepare(`update briar_memory_vaults set generation = ?, repo_name = ?, head_commit = ?, state = 'active',
            synced_at = ?, updated_at = ?
          where id = ? and generation = ? and head_commit is ?`)
          .bind(generation + 1, target, rewritten.head, timestamp, timestamp, vault.id, generation, rewritten.sourceHead),
        remap("briar_memory_vault_records"),
        remap("briar_memory_vault_revisions"),
        remap("briar_memory_vault_requests"),
        db.prepare(`update briar_memory_vault_purges set switched_at = ?, updated_at = ?
          where vault_id = ? and source_generation = ? and lease_token = ? and ${switched}`)
          .bind(timestamp, timestamp, vault.id, generation, token, vault.id, generation + 1),
      ]);
      if ((moved.meta.changes ?? 0) !== 1) throw new Error("The vault changed before the purge could switch generations");
    }
  }
  await deps.store.deleteRepo(source);
  if (await deps.store.repoExists(source)) throw new Error("The purged repository still exists after deletion");
  return finish("purged");
}

/** Deletes a whole vault: its D1 rows, then its repository (left to the orphan sweep if that fails). */
export async function deleteMemoryVault(deps: MemoryVaultMaintenanceDeps, vaultId: string) {
  const vault = await getVault(deps.db, vaultId);
  if (!vault) return false;
  await deps.db.prepare(`delete from briar_memory_vaults where id = ?`).bind(vaultId).run();
  try {
    await deps.store.deleteRepo(vaultRepoName(vaultId, vault.generation));
    await deps.store.deleteRepo(vaultRepoName(vaultId, vault.generation + 1));
  } catch (error) {
    console.error(JSON.stringify({ message: "memory vault repository deletion deferred", vaultId,
      error: error instanceof Error ? error.message : String(error) }));
  }
  return true;
}

/**
 * Deletes repositories no vault row owns any more: vaults removed by a cascade
 * (organization, Agent or DM space erasure), old generations, and abandoned
 * purge targets. Conservative: only `mv-<id>-g<n>` names, only after a grace
 * period, and never the live generation or the target of an open purge.
 */
export async function collectOrphanMemoryVaultRepos(deps: MemoryVaultMaintenanceDeps, options: {
  readonly graceMs?: number;
  readonly maxDeletes?: number;
} = {}) {
  const cutoff = clock(deps).getTime() - (options.graceMs ?? 3_600_000);
  const repos = (await deps.store.listRepos()).flatMap((repo) => {
    const match = VAULT_REPO_NAME.exec(repo.name);
    return match && Date.parse(repo.createdAt) < cutoff
      ? [{ name: repo.name, vaultId: vaultIdFromHex(match[1]), generation: Number(match[2]) }]
      : [];
  });
  if (repos.length === 0) return { deleted: [] as string[] };
  const ids = JSON.stringify([...new Set(repos.map((repo) => repo.vaultId))]);
  const vaults = new Map((await deps.db.prepare(`select id, generation from briar_memory_vaults
    where id in (select value from json_each(?))`).bind(ids).all<{ id: string; generation: number }>()).results
    .map((row) => [row.id, row.generation]));
  const openPurges = new Set((await deps.db.prepare(`select vault_id, source_generation from briar_memory_vault_purges
    where completed_at is null and vault_id in (select value from json_each(?))`).bind(ids)
    .all<{ vault_id: string; source_generation: number }>()).results.map((row) => `${row.vault_id}:${row.source_generation}`));
  const deleted: string[] = [];
  for (const repo of repos) {
    if (deleted.length >= (options.maxDeletes ?? 20)) break;
    const live = vaults.get(repo.vaultId);
    const keep = live !== undefined && (
      repo.generation === live ||
      (repo.generation === live + 1 && openPurges.has(`${repo.vaultId}:${live}`))
    );
    if (keep) continue;
    await deps.store.deleteRepo(repo.name);
    deleted.push(repo.name);
  }
  return { deleted };
}

/** Scheduled entry point: purges every minute, orphan sweep and claim-read pruning every six hours. */
export async function runMemoryVaultMaintenance(
  deps: { readonly db: D1Database; readonly store: VaultGitStore | null; readonly now?: () => Date },
  cadence: "minute" | "six_hourly",
) {
  if (!deps.store) return { skipped: "no_artifacts_binding" as const };
  const maintenance = { ...deps, store: deps.store };
  if (cadence === "minute") return { purges: await processMemoryVaultPurges(maintenance) };
  const prunedBefore = new Date(clock(deps).getTime() - 30 * 86_400_000).toISOString();
  const pruned = await deps.db.prepare(`delete from briar_memory_vault_claim_reads where read_at < ?`)
    .bind(prunedBefore).run();
  return {
    orphans: await collectOrphanMemoryVaultRepos(maintenance),
    prunedClaimReads: pruned.meta.changes ?? 0,
  };
}
