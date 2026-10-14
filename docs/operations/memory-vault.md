# Memory vault operations

The [spec](../plans/memory-vault-spec.md) defines the vault: one Cloudflare
Artifacts Git repository per vault (DM, group channel or project), Markdown
records with server-generated frontmatter, `tools memory …` for the agent, and
D1 holding only ownership, permissions and indexes derived from the repository.
This page is how to run it: configuration, rollout, the D1 → vault migration,
rollback, forget and purge, failure modes, diagnostics and costs.

Code: `apps/briar/worker/src/memory-vault/`. Migrations `0220_memory_vault.sql`
(vault tables) and `0221_memory_vault_cutover.sql` (reply citations, migration
progress).

## Architecture in one paragraph

The Worker CLI's `tools memory` relay calls `WorkerQueueService.MemoryVault*`
with the claim. The API Worker derives the one vault the claim may touch
(`scope.ts`), checks opt-in, and reads or writes the repository through the
`MEMORY_ARTIFACTS` binding with isomorphic-git (clone → commit → push without
force; a non-fast-forward re-runs the whole check). Every commit carries
`Briar-*` trailers, so D1 can always be rebuilt from the repository
(`reconcileVault`). Artifacts tokens are minted per operation inside the API
Worker and never leave it. Before each provider turn the CLI asks
`GetMemoryVaultContext`; an unchanged head and unchanged permissions cost D1
reads only.

## Configuration

| Setting | Where | Meaning |
| --- | --- | --- |
| `MEMORY_ARTIFACTS` | `wrangler.jsonc` `artifacts` binding, namespace `briar-memory` | The Artifacts namespace that holds every vault repository (`mv-<vault id>-g<generation>`). Without it the vault reports `memory_unavailable` and maintenance skips. |
| `MEMORY_VAULT_ENABLED` | `wrangler.jsonc` var, `"false"` | The cutover switch. See the matrix below. |
| `MEMORY_VAULT_MIGRATION_ENABLED` | `wrangler.jsonc` var, `"false"` | Runs the D1 → vault migration while the vault is still off (rollout step 4). The migration also runs whenever `MEMORY_VAULT_ENABLED` is on. |

Runtime does not need the `artifacts:write` OAuth scope: the binding
authenticates by binding. Only `wrangler artifacts …` from a laptop does, and
the local Wrangler OAuth token lacks it (`Authentication error [10000]`); run
`wrangler login` interactively first if you need that CLI.

### What the switch changes

| | `MEMORY_VAULT_ENABLED=false` | `MEMORY_VAULT_ENABLED=true` |
| --- | --- | --- |
| Vault tools (`tools memory`), context injection | `memory_disabled` / `none` | On for every run with an Agent: DM (owner opt-in), group, project |
| DM claim, CLI advertises `memoryVaultProtocol=1` | Legacy descriptor and learning flag exactly as before | No legacy descriptor, no learning flag; DM fence still bound (protocol 0) so vault scope, revocation and conversation resume work |
| DM claim, older CLI (no vault capability) | Legacy as before | No descriptor, no learning flag, no resumed transcript: "no memory". A claim bound before the switch gets a disabled descriptor, a `null` brief and `memory_unavailable` lookups |
| Group / project claim | Unchanged | Unchanged (vault via tools only) |
| Legacy learning (`extract`, `explicit_request`, `consolidate`) | Runs | Not enqueued at completion; Workers are not handed learning jobs |
| Reply citations | Legacy check | UUIDs: legacy check (unchanged). Record ids: kept if this claim read that revision and it is current, else dropped |
| Owner DM memory dialog (`DmMemoryService`, export) | D1 memory | The space's vault; see "Owner dialog" |
| Legacy index/delete jobs (vectors, purges) | Run | Still run (forget of migrated documents relies on them) |

With the switch off, everything behaves as before the vault existed. Vault
data is not touched by turning it off.

## Rollout

1. Merge. `bun run d1:migrate:remote` (0220, 0221: new tables only; 22 lookup
   rows, 0 rows from 0221). `worker:deploy` with both switches `"false"`.
2. Release the Worker CLI with `memory-tools.js`; update Workers. An updated
   CLI advertises `memoryVaultProtocol = 1`.
3. Run the live check (below). It must pass.
4. Set `MEMORY_VAULT_MIGRATION_ENABLED = "true"`, deploy. The minute cron
   migrates one DM space per minute. Watch "Migration status" below until
   every space with active documents has `verified_at` set and no
   `last_error`. Review `skipped_json`.
5. Set `MEMORY_VAULT_ENABLED = "true"` (the migration keeps running under it;
   `MEMORY_VAULT_MIGRATION_ENABLED` may go back to `"false"`), deploy.
6. Watch: Artifacts operations in the dashboard (billing from 2026-10-14), the
   `memory vault storage failed`, `busy` and `memory_unavailable` log lines,
   purge and migration state.

## D1 → vault migration

Code: `legacy-migration.ts`. Per DM memory space with active documents:

* Every revision of every **active** document becomes one commit, in version
  order, authored at the revision's original `created_at`, with trailers
  `Briar-Operation: migrate` and `Briar-Legacy: <document id>@<version>`.
  Actor: `user:<owner>` for owner edits, `agent:<agent>` otherwise.
* `profile` → `person` record; `note` and `log` → `fact` record (deviation
  from spec §11, which said a log becomes a journal line: legacy logs are
  versioned and may be multi-line, a journal line is one immutable line, and
  the body-hash verification needs one record per document). Record id = the
  ASCII slug of the title (`memory` if none), suffixed with the document id's
  first 8 hex digits on collision.
* Body = `# <title>`, the legacy body, a `## Sources` footer for source
  messages and a `## Validity` footer for `observed_at`/`valid_until`.
  `protected_by_user` carries over as D1 control data.
* `briar_memory_vault_legacy_map` records document/version → record/revision/
  commit and the body's SHA-256.

**Rerunnable and idempotent.** A rerun skips mapped versions; migrates only
new ones (e.g. written during a rollback); recovers a version whose commit
landed but whose map row did not (from its `Briar-Legacy` trailer, no duplicate
commit); forgets a migrated record whose legacy document was deleted since;
then reads every mapped revision back from Artifacts and compares hashes.

**Fails loudly**, recording `last_error` on the space and backing off (2^n
minutes, ≤ 6 h), when: a mapped legacy version no longer renders to its map
hash; a record changed in the vault after its last migrated version (the
legacy document was edited during a rollback while the vault copy was edited
too); a read-back hash differs. Nothing is overwritten in those cases; fix by
hand (decide which text wins, then delete the offending map rows or record)
and clear `next_attempt_at`.

**Skipped versions.** A version the vault refuses (secret detector, > 64 KiB)
is listed in `skipped_json` and never retried; the legacy row stays. Review
each: the vault never stores secrets.

Rows written: per migrated version ≈ 5 D1 rows (record upsert, revision, request,
legacy map, vault head update) plus one migration row per space. Production on
2026-10-13 (12 spaces, 14 documents, 13 revisions) is well under 1,000 rows.

### Rollback

Set `MEMORY_VAULT_ENABLED = "false"` (and `MEMORY_VAULT_MIGRATION_ENABLED =
"false"` to stop migrating), deploy. Legacy rows were never modified by the
migration, so the D1 path resumes exactly where it was, minus documents the
owner forgot in the vault dialog (forget purges the mapped legacy documents
too). Vault writes made after the cutover are not visible until the vault is
re-enabled; when it is, the migration picks up legacy versions written during
the rollback, or stops loudly for a record changed on both sides.

## Owner dialog

`DmMemoryService` keeps its RPC shapes (`memory-vault/owner.ts`):

* Document `id` = the record's **handle**, a version-8 UUID derived from vault
  id and record id. Shipped iOS builds parse citation ids as UUIDs and reject
  the whole message otherwise, so record ids never reach clients. A legacy
  document id the migration mapped also resolves (old citations still open).
  No client change was needed on web, iOS or Android (Tauri web view).
* `title` = the body's leading `# ` heading, else the record id. `memoryClass`:
  `person` → profile, `timeline-*` → log, else note.
* Create/update = a `save` commit with actor `user:<id>`, `protected_by_user = 1`
  (agents need `--user-requested` to change it). As with the legacy save, the
  first save turns recall on, and editing an existing record bumps the space's
  revocation epoch.
* `observedAt`, `validUntil`, `sourceLanguage`, `sourceMessage` are accepted and
  not stored; they come back empty. The learning panel and retry are inert.
* List reads the D1 index only (the dialog polls every 5 s); open/export read
  Artifacts.

## Forget and purge

Delete in the dialog = `forgetMemoryVaultRecord` (spec §10):

1. Immediately: a commit removing the record's files; the record row →
   deleted; its revision rows, claim reads and reply citations deleted; the
   space's `revocation_epoch` bumped (every claim and resumed conversation that
   could have seen it ends); legacy documents mapped to it go through
   `deleteDmMemory` (revisions, chunks, vectors, briefs).
2. Minute cron: the purge job clones generation g, rewrites history without the
   forgotten paths into `…-g<g+1>`, verifies the head tree, switches the vault
   row in one guarded statement, deletes repository g and confirms it is gone.
   Writes to that vault return `busy` during an attempt.
3. Six-hourly: the orphan sweep deletes repositories no vault row owns.

**Not covered:** words of the forgotten record the agent also wrote elsewhere —
a journal line, another record, a reply already sent, an export the owner
downloaded. Those are separate records the owner can delete.

## Failure modes

| Symptom | Cause | What happens / what to do |
| --- | --- | --- |
| `memory_unavailable` | Artifacts down, binding missing | Turn runs without memory. Check the binding and Artifacts status. |
| `busy` | 5 lost CAS races, or a purge in progress | Retryable. Persistent: look for a purge stuck in `purging` (below). |
| Purge `last_error` | Artifacts failed mid-rewrite, vault moved | Retried with backoff from the then-current head; vault returns to `active` between attempts. |
| Migration `last_error` | See "Fails loudly" | Space stays on whatever was migrated; fix and clear `next_attempt_at`. |
| Reply citations missing | Agent cited a record it did not read on this claim, or an old revision | Dropped by design (logged `memory vault citations rejected`). |
| Old CLI says nothing about memory in a DM | Expected after the cutover | Update the Worker. |

## Diagnostics

Run against production with `bunx wrangler d1 execute briar-db --remote --command "…"`.

```sql
-- Migration status per space (rollout step 4).
select space.id, space.status, migration.versions_migrated, migration.verified_at,
  migration.last_error, migration.next_attempt_at, migration.skipped_json,
  (select count(*) from briar_dm_memory_documents doc where doc.space_id = space.id and doc.status = 'active') as active_documents
from briar_dm_memory_spaces space
left join briar_memory_vault_legacy_migrations migration on migration.space_id = space.id
where exists (select 1 from briar_dm_memory_documents doc where doc.space_id = space.id and doc.status = 'active')
order by migration.verified_at is null desc, space.id;

-- Vaults by scope and state.
select scope_kind, state, count(*) as vaults, sum(head_commit is null) as empty from briar_memory_vaults group by 1, 2;

-- Open purge jobs.
select vault_id, source_generation, attempts, last_error, lease_expires_at, requested_at
from briar_memory_vault_purges where completed_at is null;

-- Vaults stuck in purging (should be empty outside a running attempt).
select id, generation, updated_at from briar_memory_vaults where state = 'purging';

-- Records and revisions of one vault.
select record_id, record_type, revision, protected_by_user, deleted_at, updated_at
from briar_memory_vault_records where vault_id = ? order by updated_at desc;
```

## Costs

Artifacts open beta (Workers Paid): first 10k operations/month and 1 GB-month
free, then $0.15 per 1,000 operations and $0.50 per GB-month. Roughly: an
unchanged `GetMemoryVaultContext` costs no Artifacts operation; a changed head
costs a ref discovery plus up to three file reads; `read` one; `list` a ref
discovery; `search` a shallow clone; `save`/`journal` a shallow clone and a
push (more on a CAS retry); a purge a full clone, a push and two repository
deletions; the migration about two operations per legacy version. Confirm in
the dashboard after rollout step 6. Storage is Markdown: kilobytes per vault.

## Live check

`bun scripts/memory-vault-live-check.ts [--out docs/operations/evidence/memory-vault-live-store-<date>.md]`
deploys `scripts/memory-vault-live-check/worker.ts` (the production
`ArtifactsVaultGitStore`, bundled unchanged) as
`briar-memory-vault-live-check-<random>` bound to the separate
`briar-memory-live-check` namespace, runs the scenario — create, idempotent
create, empty head/snapshot, CAS writes, two concurrent writers (one commit,
one conflict), old-commit reads, history with `stopAt`, skip, forget commit,
history rewrite into the next generation with equal head tree and no
forgotten text in any commit, deletion purge, listing, cleanup — and deletes
the Worker (also on failure or Ctrl-C). It exits 1 if any step fails. It uses
the caller's Wrangler login or `CLOUDFLARE_API_TOKEN`. The 2026-10-13 ad-hoc
run is in [evidence/memory-vault-live-store-2026-10-13.md](evidence/memory-vault-live-store-2026-10-13.md);
it found that `repo.remote` is an RPC property, so the store reads the remote
URL from `repo.info()`.

## End-to-end check

`bun scripts/memory-vault-e2e/run.ts [--out docs/operations/evidence/memory-vault-e2e-<date>.md]`
(with `CLOUDFLARE_ACCOUNT_ID=459bc0fca39fa1adab8aed615098fcaf`; prerequisites at
the top of `run.ts`) runs the real `briar-api` Worker under `wrangler dev`
against a fresh local D1 with every migration, bound to real Artifacts in the
separate `briar-memory-e2e` namespace, and drives it like production: people
post through `ChannelService`, separate Worker processes claim through
`ClaimWork`, open the real `MemoryVaultInvocation`, and run real `claude -p`
sessions with the production instructions, vault tags, reply schema and
`tools` on PATH. It checks save/journal/voice-guide in the repository and the
D1 index, recall from a fresh session in another process, revisions and
conflicts, pagination, journal dedupe, isolation (other DM, group channel,
finished and expired claims), the README, owner forget plus purge, and deletes
every repository in the namespace at the end. Nothing is deployed and no remote
D1 is touched. It needs wrangler 4.150 (fetched with `npx`): the repository's
4.127 dev bridge cannot carry the Blob `repo.readFile` returns. Evidence:
[evidence/memory-vault-e2e-2026-10-14.md](evidence/memory-vault-e2e-2026-10-14.md).
