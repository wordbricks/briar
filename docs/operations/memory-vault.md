# Memory vault operations

The [spec](../plans/memory-vault-spec.md) defines the vault: one Cloudflare
Artifacts Git repository per vault (DM, group channel or project), Markdown
records with server-generated frontmatter, `tools memory …` for the agent, and
D1 holding only ownership, permissions and indexes derived from the repository.
This page is how to run it: configuration, deployment and rollback, forget and
purge, failure modes, diagnostics and costs. It is the only memory system: the
D1 DM memory it replaced was removed on 2026-10-14
(`0222_remove_legacy_dm_memory.sql`, [history](#history)).

Code: `apps/briar/worker/src/memory-vault/`. Migrations `0220_memory_vault.sql`
(vault tables), `0221_memory_vault_cutover.sql` (reply citations) and
`0222_remove_legacy_dm_memory.sql` (legacy removal, settings idempotency).

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
| `MEMORY_ARTIFACTS` | `wrangler.jsonc` `artifacts` binding, namespace `briar-memory` | The Artifacts namespace that holds every vault repository (`mv-<vault id>-g<generation>`). Without it the vault reports `memory_unavailable` (the turn runs without memory) and maintenance skips. |

There is no switch: every run with an Agent has a vault — DM (owner opt-in),
group channel, project.

Runtime does not need the `artifacts:write` OAuth scope: the binding
authenticates by binding. Only `wrangler artifacts …` from a laptop does, and
the local Wrangler OAuth token lacks it (`Authentication error [10000]`); run
`wrangler login` interactively first if you need that CLI.

### What each Worker CLI gets

| | Worker CLI with `memoryVaultProtocol = 1` (≥ 1.2.233 with `memory-tools.js`) | Older Worker CLI |
| --- | --- | --- |
| DM claim | Fenced to the DM space (`briar_dm_memory_reply_fences`, protocol 0); vault tools and per-turn context; resumes its conversation while the space's revocation epoch holds | Same fence, no memory descriptor, no tools, no context; never resumes a DM transcript. Legacy memory RPCs it might call no longer exist (`unimplemented`), but it only called them when a claim carried the removed descriptor, so it never does |
| Group / project claim | Vault via tools | No memory |
| Reply citations | Record ids it read on this claim at their current revision are kept; others dropped | Legacy document UUIDs are dropped; the reply still completes |
| Legacy learning jobs | None exist | Never handed out (the `dmMemory` work type is gone) |

## Deploying and rolling back

The release with `0222` must deploy code first: the previous code reads the
tables `0222` drops on every channel message read and DM claim, while the new
code also runs on the `0221` schema (only the settings switch needs `0222`'s
new table). Take a restore point, then:

```sh
bunx wrangler d1 time-travel info briar-db   # note the bookmark
BRIAR_WORKER_DEPLOY_ORDER=code-first bun run worker:deploy
bunx wrangler vectorize delete briar-dm-memory-prod-m3-v1 --force   # after the deploy
```

Later releases deploy as usual (`bun run worker:deploy` applies pending D1
migrations first). Rollback is reverting the deploy. `0222` dropped the legacy D1 tables, so the
old D1 memory cannot come back by redeploying an older build alone; that would
need D1 time travel to a bookmark taken before `0222`
(`wrangler d1 time-travel info briar-db`), and is not a supported path.

## Owner dialog

`DmMemoryService` keeps its RPC shapes (`memory-vault/owner.ts`):

* Document `id` = the record's **handle**, a version-8 UUID derived from vault
  id and record id. Shipped iOS builds parse citation ids as UUIDs and reject
  the whole message otherwise, so record ids never reach clients. Citations of
  legacy D1 documents were rewritten to handles by `0222`; a legacy document id
  a client still has cached no longer resolves (`memory_not_found`).
* `title` = the body's leading `# ` heading, else the record id. `memoryClass`:
  `person` → profile, `timeline-*` → log, else note.
* Create/update = a `save` commit with actor `user:<id>`, `protected_by_user = 1`
  (agents need `--user-requested` to change it). As with the legacy save, the
  first save turns recall on, and editing an existing record bumps the space's
  revocation epoch.
* `observedAt`, `validUntil`, `sourceLanguage`, `sourceMessage` are accepted
  from older clients and ignored; documents come back with fixed values for
  them (and `indexState` READY) so shipped clients still decode them. Current
  web, Android and iOS clients neither send nor show them. The learning status
  and `RetryDmMemoryLearning` are gone from the proto (field and RPC reserved).
* Settings (`UpdateDmMemorySettings`): recall (`use_enabled`) and automatic
  writing (`auto_enabled`), idempotent per request id
  (`briar_dm_memory_setting_requests`) and guarded by the space's
  `memory_revision`; turning either off bumps the revocation epoch.
* List reads the D1 index only (the dialog polls every 5 s); open/export read
  Artifacts.

## Forget and purge

Delete in the dialog = `forgetMemoryVaultRecord` (spec §10):

1. Immediately: a commit removing the record's files; the record row →
   deleted; its revision rows, claim reads and reply citations deleted; the
   space's `revocation_epoch` bumped (every claim and resumed conversation that
   could have seen it ends).
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
| Reply citations missing | Agent cited a record it did not read on this claim, or an old revision | Dropped by design (logged `memory vault citations rejected`). |
| Old CLI says nothing about memory | Expected: it has no vault tools | Update the Worker. |

## Diagnostics

Run against production with `bunx wrangler d1 execute briar-db --remote --command "…"`.

```sql
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
deletions. Confirm in the dashboard. Storage is Markdown: kilobytes per vault.

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

## History

Rollout, 2026-10-13 → 2026-10-14: `0220`/`0221` with both switches off; Worker
CLI 1.2.233 with `memory-tools.js`; live check; `MEMORY_VAULT_MIGRATION_ENABLED`
on (the minute cron migrated each DM space's legacy documents, verified by
read-back: 11 documents in two spaces); `MEMORY_VAULT_ENABLED` on. Then the
legacy removal: `0222` rewrote legacy reply citations to vault record
citations and dropped the D1 memory tables, the migration ledger, and the
legacy triggers; the code, both switches, the `DM_MEMORY_INDEX` Vectorize
binding and its flags were removed. After that deploy, delete the index:
`bunx wrangler vectorize delete briar-dm-memory-prod-m3-v1 --force`. The
previous version of this page, with the migration and switch details, is in git
history (`git show dc40e2cc:docs/operations/memory-vault.md`).
