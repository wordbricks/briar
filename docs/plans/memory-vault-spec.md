# Memory vault on Cloudflare Artifacts

Status: implementation spec, 2026-10-13. Supersedes the storage half of
[dm-memory-spec.md](dm-memory-spec.md): D1 stops being the source of memory
Markdown. The opt-in, explicit save/correct/delete, protected-record and
citation contracts of that spec stay in force and are restated here where the
mechanism changes.

The user-facing contract is the application-owned README in
`apps/briar/worker/src/memory-vault/memory-vault-readme.md`, copied verbatim
from the user's message `ccc9beb0-b528-4a72-8fdc-4231664a46f6` (2026-10-13,
sha256 `d907567be6ee97bae6df48a58ce4018a1a4e98d5dc628031ef208956a74ba583`).
A test pins that hash. Nobody edits that file to "improve" it; a change to it is
a product decision by the user.

## 1. Verified platform facts (2026-10-13)

Measured with a throwaway Worker (`briar-artifacts-probe`, namespace
`briar-probe`) deployed to account `459bc0fca39fa1adab8aed615098fcaf`:

| Check | Result |
| --- | --- |
| Account access | Workers binding `create`/`get`/`info`/`list`/`delete`/`createToken` all succeed. Artifacts went open beta 2026-10-01, Workers Paid only; billing starts 2026-10-14 (first 10k ops/month and 1 GB-mo free, then $0.15/1k ops, $0.50/GB-mo). |
| Local control plane | The local Wrangler OAuth token lacks the `artifacts:write` scope (`wrangler artifacts …` → `Authentication error [10000]`). Runtime does not need it — bindings authenticate by binding. Re-run `wrangler login` interactively before using `wrangler artifacts` from a laptop. |
| Write path | The binding cannot write files. Writes are Git pushes: `isomorphic-git` 1.44 in the Worker with an in-memory FS (docs' `MemoryFS` plus `readlink`/`symlink`/`chmod` stubs, ENOENT errors carrying `code`). Shallow clone depth 1 ≈ 1.2 s, push ≈ 1.2 s, create ≈ 3.5–4.5 s. |
| Atomic conflict detection | Two writers cloned from the same head: the first push succeeds, the second fails with `PushRejectedError` reason `not-fast-forward`. Branch update is compare-and-swap. |
| History | `repo.log({ref})` returns first-parent commits newest first; `repo.readFile({ref: <commit sha>, path})` reads any old version (~200 ms). |
| Purge | After a force-push that drops a commit, the orphaned commit and blob stay readable by hash through `readCommit`/`readBlob`/`readFile`. History rewriting does **not** purge. Deleting the repo does (`get` → `NOT_FOUND`). |
| Tokens | `art_v2_…?expires=<unix>`; repo-scoped, `read` or `write`, TTL in seconds. |

## 2. Shape

```
agent shell ── `tools memory …` ──► local relay (Worker CLI process, holds the claim)
                                         │ WorkerQueueService.MemoryVault* (Connect)
                                         ▼
briar-api Worker ── D1: vault ownership, permissions, record index, revision map,
                 │      idempotency, sync + purge state (all derived or control data)
                 └─ MEMORY_ARTIFACTS binding + isomorphic-git ──► Artifacts repo (source of truth)
```

* One Artifacts repo per vault, namespace `briar-memory`, branch `main`.
  Repo name `mv-<vault id without dashes>-g<generation>`.
* Markdown and its history live only in Artifacts. D1 rows can be rebuilt from
  the repo (commit trailers + frontmatter), except control data that never was
  in the repo: ownership, opt-in, protection, purge bookkeeping.
* Artifacts tokens are minted per operation inside the API Worker (`write`,
  TTL ≤ 300 s), used for one clone/push and never returned, logged or stored.
  The agent, the Worker CLI and the D1 rows never see them.
* Memory is not mounted in the sandbox and is never written to a workspace
  file. The legacy `briar-dm-memory-*` read-only copies go away for vault turns.

## 3. Scopes

A vault is `(organization, agent, scope kind, scope key)`, unique. The server
derives it from the authenticated claim; the CLI and the model never send an
organization, owner, agent, channel, project or vault id.

| Scope kind | When | Scope key | Who may read |
| --- | --- | --- | --- |
| `dm` | channel reply in an eligible 1 user + 1 agent DM (`briar_dm_memory_live_rosters`) | the existing DM memory space id (org + channel + owner + agent + roster epoch) | that agent, only in runs claimed for that space; the owner in the app |
| `group` | channel reply in any other channel, including a DM that is not eligible | channel id | that agent, only in runs claimed for that channel |
| `project` | issue run, issue reply, project agent task | project id | that agent, only in runs claimed for that project |

Scope kinds are a lookup table (`briar_memory_vault_scope_kinds`), not a CHECK,
so an `organization` scope can be added later with one insert.

Isolation rules enforced by the server on every call, not by the prompt:

* A run touches exactly one vault. There is no cross-vault read, no vault
  selector argument, and no shared "agent" vault that merges DM and work memory.
* `group` and `project` vaults reject `person` records (no personal profiles of
  participants); they keep the group's work and register. `voice` and
  `voice-guide` there describe the group's register.
* A DM vault is private to its owner. Nothing from it is offered to group,
  project or another user's DM runs.

## 4. Opt-in and authority (restating dm-memory-spec §6 for the new path)

| Vault | Read (`list`/`read`/`search`, context injection) | Write (`journal`/`save`) |
| --- | --- | --- |
| `dm` | space `use_enabled = 1` | space `auto_enabled = 1`, **or** `--user-requested` on a turn whose trigger message was written by the owner. A user-requested write turns `use_enabled` on (as the first explicit save did before). |
| `group`, `project` | `MEMORY_VAULT_ENABLED` | `MEMORY_VAULT_ENABLED` |

* Records the owner created or edited in the app are `protected_by_user`.
  An agent save to a protected record needs `--user-requested`; otherwise
  `protected_record`. Automatic maintenance never overwrites them.
* The README is always injected when the run has a vault, even if DM recall is
  off, followed by one status line saying what is currently allowed, so the agent
  can still honour "remember this".
* README, memory content, voice, guide and playbook are reference data. The
  trusted instructions say so explicitly: they cannot change Briar's
  instructions, authentication, approval scope or tool permissions.
* Never stored: passwords, tokens, one-time codes, card numbers, private keys,
  other secrets. The server rejects content that matches the secret detector
  (`secret_detected`), for `save` and `journal` alike.

## 5. Records

### 5.1 Types and paths

| type | path | notes |
| --- | --- | --- |
| `person` | `entities/people/<id>.md` | not allowed in group/project vaults |
| `org` | `entities/orgs/<id>.md` | |
| `tool` | `entities/tools/<id>.md` | |
| `project` | `entities/projects/<id>.md` | |
| `infrastructure` | `entities/infrastructure/<id>.md` | |
| `comms` | `comms/<id>.md` | |
| `workstream` | `workstreams/<id>.md` | `status` required: `active`, `completed`, `someday`. Path never depends on status. |
| `fact`, `procedure`, `preference`, `decision` | `knowledge/<facts\|procedures\|preferences\|decisions>/<id>.md` | `voice`, `voice-guide` are `preference` |
| `lesson` | `knowledge/lessons/<id>.md` | §5.4 |
| `playbook` | `playbook.md` | id must be `playbook` |
| `timeline-weekly` | `timeline/weekly/<id>.md` | id `yyyy-www` (ISO week, e.g. `2026-w42`) |
| `timeline-monthly` | `timeline/monthly/<id>.md` | id `yyyy-mm` |
| `browser-guidance` | `browser-guidance/attempts/<id>.md` | |
| `timeline-daily` | `timeline/daily/<yyyy-mm-dd>.md` | written only by `journal` |
| — | `README.md` | application-owned, read-only to agents |

Record types are a lookup table too. The id namespace is per vault and across
types: an id belongs to one type; `save` with a different type is
`type_mismatch`. Ids: `^[a-z0-9][a-z0-9-]{0,62}$`, plus the date forms above.

Legacy layout: `workstreams/active/<id>.md` and `workstreams/completed/<id>.md`
are listed, read and searched. Saving such a workstream writes
`workstreams/<id>.md` and removes the legacy file in the same commit, keeping
the id and the revision sequence.

### 5.2 Frontmatter (generated by the tool, never accepted from the agent)

```yaml
---
id: bay-area-relocation
type: workstream
status: active            # workstreams only
aliases: [relocation]     # optional
revision: 4
created_at: 2026-10-13T12:40:50Z
updated_at: 2026-10-13T14:02:11Z
---
```

The agent supplies only the body. A body that starts with a frontmatter block
is rejected (`frontmatter_not_allowed`). Body ≤ 64 KiB.

### 5.3 Revisions and conflicts

* `revision` is a per-record integer in the frontmatter, so it survives a
  history rewrite (commit hashes do not). D1 maps `(vault, record, revision)`
  → commit for `read --revision`.
* Updating needs `--expected-revision`; omitting it is allowed only when the
  record does not exist (`expected_revision_required`).
* Inside one write attempt the server shallow-clones the current head, compares
  the record's current revision with the expected one (`revision_conflict`,
  returning the current revision so the agent reads and merges), commits, and
  pushes without force. A `not-fast-forward` rejection means another execution
  advanced the branch: re-clone and re-run the whole check (≤ 5 attempts with
  jitter, then `busy`, retryable). No write is ever based on a stale clone.
* Every commit carries trailers: `Briar-Vault`, `Briar-Operation`
  (`init`/`save`/`journal`/`forget`), `Briar-Request`, `Briar-Payload` (the
  request's payload hash), `Briar-Actor` (`agent:<id>` / `user:<id>` /
  `system`), `Briar-Claim` (work id), then one `Briar-Record` / `Briar-Path` /
  `Briar-Revision` triple per record written or removed (revision 0 for a
  removal), and `Briar-Journal` with the appended line. D1 sync can rebuild
  revisions and idempotency rows from them.

### 5.4 Lessons, playbook, voice, voice guide

Validated by the server so the README's rules hold even when a model drifts:

* `lesson` body contains the headings `Situation`, `What was done`,
  `Next time`, `Evidence` (≥ 1 task id with a `YYYY-MM-DD` date) and
  `Confirmed` (count and last date) — unless its first line is
  `Retracted <YYYY-MM-DD>: <why>`. Saving a retraction removes every playbook
  line that links `[[<lesson id>]]` and journals the reason, in the same commit.
* `playbook`: every non-empty line matches
  `- <when> → <do> (<n>회/times, <YYYY-MM-DD>) [[<lesson-id>]]`; ≤ 4,000 chars.
  Over the limit the tool drops lines lowest count first, then oldest date, and
  returns the dropped lines.
* `voice` (`preference`/`voice`): lines `- <trait> (<n>회/times, <YYYY-MM-DD>)`,
  no quoted messages; ≤ 2,000 chars with the same trimming rule.
* `voice-guide` (`preference`/`voice-guide`): lines `- <rule>`; a line the
  person stated ends `(user, <YYYY-MM-DD>)`. A save that removes or rewrites an
  existing `(user, …)` line needs `--user-requested` (the person changed or
  withdrew it).

## 6. Tools (`tools memory …`)

Invoked from the agent's ordinary shell. Output is one JSON object on stdout;
exit code 0 on success, 1 on a tool error (`{"error":{"code","message","retryable"}}`).

| Command | Behaviour |
| --- | --- |
| `list [--type T] [--prefix P] [--status S] [--cursor C] [--limit N]` | Records of the vault, newest update first, with id, type, path, status, aliases, revision, updated_at. Includes `README.md` and legacy workstream files. |
| `read <id or path> [--revision N]` | Latest revision by default; frontmatter fields + body. `README.md`/`readme` returns the application template. A daily file is read by its date id. Records the run reads are remembered for citation validation. |
| `search <text> [--type T] [--prefix P] [--cursor C] [--limit N]` | Case-insensitive substring match over every Markdown file at one commit (README excluded), and over each record's aliases (any language, ≤ 60 characters, no commas or brackets). Results: id, type, path, revision, line, snippet. `next_cursor` is opaque, pins the commit it started from, and is `null` on the last page. Default 10, max 50. No semantic re-ranking replaces this contract. |
| `journal <text> [--occurred-at ISO8601+offset] [--references id,id] [--user-requested]` | Appends `- HH:MM \| <text>` (UTC; references rendered as ` [[id]]` suffixes) to `timeline/daily/<UTC date>.md`, creating it if needed, keeping lines in time order without rewriting any existing line. Default time = server now. Offset is mandatory; > 5 min in the future is rejected. Single line ≤ 500 chars. An identical line (same minute, text, references) already present is returned as the result instead of appended (retry dedupe). |
| `save <id> --type T [--status S] [--aliases a,b] [--expected-revision N] [--user-requested] (--content-file F \| stdin)` | §5. Returns id, path, revision, commit and, for playbook/voice, the dropped lines. |

All write commands carry a request id generated by the CLI per invocation and
reused on its transport retries; the server returns the stored result for a
repeated `(vault, request id)` with the same payload hash and
`idempotency_conflict` for a different payload.

Errors the agent must handle: `revision_conflict`, `expected_revision_required`,
`protected_record`, `type_mismatch`, `memory_disabled`, `write_not_allowed`,
`secret_detected`, `invalid_record`, `frontmatter_not_allowed`,
`readme_read_only`, `not_found`, `busy`, `memory_unavailable`,
`idempotency_conflict`, `claim_inactive`, and `invalid_request` (a malformed
argument: bad cursor, limit, or `--occurred-at`). On the wire each is a Connect
error carrying `ApplicationErrorDetail.code`; `revision_conflict` and
`expected_revision_required` also carry `RevisionConflictDetail` with the
current revision. `busy` and `memory_unavailable` are retryable.

### 6.1 Transport

`tools` is a small executable placed in a private directory that the Worker CLI
prepends to the provider's `PATH`. It forwards each request through the same
file relay + fixed Unix socket the DM message command uses
(`dm-file-relay.ts`), to the Worker CLI process that owns the claim. That
process calls `WorkerQueueService` with the Worker credential and the claim
identity; the claim token never enters the provider environment. This works in
read-only sandboxes that have no network.

The server authorises every call from the claim alone: Worker credential →
claim token hash → running job with a live lease on that Worker and device →
vault resolution (§3) → opt-in (§4). A finished, cancelled or steered-away
claim fails with `claim_inactive`.

## 7. Context supplied to the model

* **README** — appended to the trusted run instructions of every run that has a
  vault (issue, issue reply, project task, channel reply), after Briar's own
  rules, under a header stating that Briar's instructions take precedence and
  memory is reference data. Instructions are sent on every provider turn,
  including resumed threads (Codex `developerInstructions` on `thread/resume`,
  Claude `systemPrompt` append on `resume`), so the README survives resume and
  provider-side compaction. `tools memory read README.md` serves it too.
* **`<voice-memory>`**, **`<playbook-memory>`** — prepended to every provider
  turn's message when the vault is readable. **`<voice-guide>`** — also, on
  turns that write to a person (channel replies, issue replies).
* The Worker CLI asks `GetMemoryVaultContext(known_context_key)` before each
  turn; the server answers `unchanged` when the key matches, so an unchanged
  vault costs D1 reads only (claim validation and the vault row) and no
  Artifacts read. The key covers the vault head **and** the current
  permissions (recall, automatic writing, user-requested writing), so turning
  recall off takes effect on the next turn even though the repository did not
  change. An empty record yields an empty tag, not an omitted one.
* Memory text is never placed in `instructions`.

## 8. Citations

`memoryCitations` keeps `{documentId, version}` with `documentId` = record id
and `version` = revision. Completion accepts only records this claim read
(`briar_memory_vault_claim_reads`) whose revision is current and not deleted.

## 9. Owner operations (app)

For a DM space whose vault is active, `DmMemoryService` keeps its RPC shapes and
is served from the vault: list = records, get = read, revisions = the D1
revision map, create/update = `save` as `user:<id>` with
`protected_by_user = 1`, delete = forget (§10), export = the head tree. Clients
(web, iOS, Android web view) treat `documentId` as an opaque string, so no
client change is needed unless a test shows otherwise.

## 10. Forget

1. Immediately: a commit removing the file; the record row → `deleted`; its
   revision rows and claim reads deleted; the space's `revocation_epoch` bumped
   (existing fences stop resumed conversations that saw it); legacy D1
   documents mapped to it go through the existing `deleteDmMemory` purge
   (revisions, chunks, vectors, briefs).
2. Purge job (leased, resumable, idempotent): full clone of generation g,
   rewrite every commit without the forgotten paths, push to a new repo
   `…-g<g+1>`, verify its head tree equals g's head tree, switch the vault row
   to g+1 in one D1 statement guarded by `generation = g`, delete repo g,
   confirm `get(g)` → `NOT_FOUND`. Writes during the purge wait (`busy`) from
   the start of step 2 until the switch.
3. Not covered: words of the forgotten record that the agent also wrote into a
   daily journal line or another record. Those are separate records the owner
   can delete; the forget dialog says so.

Deleting a whole vault (space closed, agent deleted, owner opts out and asks to
erase) deletes the repo and all D1 rows.

## 11. Migration from D1 memory

Rerunnable, per DM space, gated by `MEMORY_VAULT_MIGRATION_ENABLED` (or
`MEMORY_VAULT_ENABLED`) and run by the minute cron, one space per run, so it
can finish before the cutover:

* Each active document becomes one record; each of its revisions one commit, in
  version order, with the original timestamps and a `Briar-Legacy` trailer
  (`<document id>@<version>`). `memory_class` maps `profile` → `person`
  (owner profile `entities/people/owner`… id from the title slug), `note` →
  `fact`, `log` → `fact` as well (as built: a legacy log document is versioned
  and may be multi-line, which an immutable single journal line cannot hold,
  and read-back verification needs one record per document). Source message ids
  and `protected_by_user` carry over (sources as a `## Sources` footer, protection
  in D1).
* `briar_memory_vault_legacy_map` records document/version → record/revision/
  commit and the body hash; a rerun skips mapped versions and fails loudly if a
  mapped body hash differs. Verification reads every migrated revision back
  from Artifacts and compares hashes.
* The legacy rows are left untouched, so setting `MEMORY_VAULT_ENABLED=false`
  rolls back to the D1 path (vault writes made after cutover are then not
  visible until re-enabled).
* After cutover the legacy learning pipeline (`extract`/`consolidate`/
  `explicit_request`) no longer enqueues for vault spaces; the agent maintains
  memory with the tools. Legacy brief/lookup RPCs return no memory for vault
  spaces, so an old Worker CLI degrades to "no memory" rather than writing
  somewhere the vault does not see.

Production size on 2026-10-13: 12 spaces, 14 documents, 13 revisions — the
migration writes well under 1,000 D1 rows.

## 12. D1

New tables only; no table rebuild, no CHECK on growable sets (scope kinds and
record types are lookup tables with foreign keys). Estimated writes for the
schema migration: the lookup rows (≈ 20). See §11 for the data migration.

* `briar_memory_vault_scope_kinds`, `briar_memory_record_types` — lookups.
* `briar_memory_vaults` — id, organization, agent, scope kind, scope key, owner
  user (dm), dm space id (dm), repo name, generation, head commit, synced at,
  state (`active`/`purging`, a lookup table `briar_memory_vault_states`),
  timestamps. Unique `(organization_id, agent_id, scope_kind, scope_key)`. A
  deleted vault has no row: its D1 rows go with it and its repository is
  deleted directly or by the orphan sweep (§15).
* `briar_memory_vault_records` — vault, record id, type, path, status, aliases,
  revision, commit, protected_by_user, created/updated.
* `briar_memory_vault_revisions` — vault, record, revision, commit, path, actor,
  created_at.
* `briar_memory_vault_requests` — idempotency.
* `briar_memory_vault_claim_reads` — citation validation.
* `briar_memory_vault_purges` — forget jobs.
* `briar_memory_vault_legacy_map` — migration.

## 13. Failure and recovery

| Failure | Outcome |
| --- | --- |
| Push succeeded, D1 update lost (crash, D1 error) | Every operation compares D1 `head_commit` with the remote head (ls-refs); on mismatch it replays the missing commits from their trailers and frontmatter before serving. The idempotency row is rebuilt from `Briar-Request`, so the agent's retry returns the original result. |
| Concurrent writers | CAS push + full re-check (§5.3). Journal appends re-apply on the new head, so none is lost. |
| Agent/CLI killed mid-call | The retry reuses the request id; the server dedupes. A journal retried by the model with a new request id is deduped by line identity. |
| Artifacts unavailable | `memory_unavailable` (retryable). The turn continues without memory; nothing is cached locally as a substitute. |
| Purge interrupted | Leased job resumes; target generation name is deterministic, an existing half-built target is deleted and rebuilt. |
| Old Worker CLI | Gets no vault and no legacy memory for migrated spaces (§11). |

## 14. Rollout

1. Merge; `bun run d1:migrate:remote`; `worker:deploy` with the
   `MEMORY_ARTIFACTS` binding (namespace `briar-memory`) and
   `MEMORY_VAULT_ENABLED=false`.
2. Release the Worker CLI; update Workers.
3. Run the live check (`docs/operations/memory-vault.md`), then the migration,
   then set `MEMORY_VAULT_ENABLED=true` and deploy.
4. Watch: Artifacts ops in the dashboard (billing from 2026-10-14), `busy` and
   `memory_unavailable` rates in Worker logs, purge job state.

## 15. Phase A implementation notes (2026-10-13)

Decisions the server code made where this spec was silent, and the places it
differs from the text above. Code: `apps/briar/worker/src/memory-vault/`,
migration `0220_memory_vault.sql`.

* **isomorphic-git 1.43.3**, not 1.44.x: the repository's Bun
  `minimumReleaseAge` (3 days) blocks 1.44.x (published 2026-10-12). The API
  used (clone/push/getRemoteInfo2, low-level object reads and writes) is the
  same; bump once 1.44.2 ages in.
* **README in the repository.** The first write creates the repository with a
  `README.md` commit, so `main` always exists, and every later commit keeps
  `README.md` equal to the server copy. `read README.md` and the injected
  README always come from the server copy, never from the repository.
* **Daily files have generated frontmatter** like every record (type
  `timeline-daily`, id = date, revision per append), so they have revisions,
  appear in `list` and can be cited.
* **Search** matches record bodies, not frontmatter; `line` is the 1-based line
  in the whole file (frontmatter included). Hits are ordered by path, then line.
* **`--user-requested`** is honoured when the claim's trigger message was
  written by a person: the DM owner (dm), any person (group), the issue
  message author (issue reply). Issue runs and project Agent tasks have no
  trigger message and never honour it (`write_not_allowed`). A DM write needs
  `auto_enabled = 1` or a user-requested turn; it does not also require
  `use_enabled`.
* **Protected content.** Besides `protected_by_user` records, removing or
  rewriting a `(user, …)` voice-guide line without `--user-requested` is
  `protected_record`.
* **Reserved ids:** `readme` (`readme_read_only`) and `playbook` (only for the
  playbook).
* **Heuristics, kept conservative:** a lesson's Evidence needs a line with a
  valid date and another token containing a digit (the task id); a voice line
  must not contain a quoted span (≥ 8 characters in quotes, ≥ 4 in CJK
  brackets); the secret detector is pattern based (see
  `secret-detector.ts` and its tests for what passes and what is refused).
* **Legacy files** without generated frontmatter are revision 1, typed and
  statused from their path.
* **Idempotency after a lost D1 update.** The request row rebuilt from
  `Briar-Request`/`Briar-Payload` returns the original id, path, revision and
  commit; playbook/voice `droppedLines` are not in the commit, so a replay
  after such a crash reports none.
* **Purge.** Each forgotten path is dropped from every commit up to the forget
  commit that removed it, and kept after it, so a record re-created under the
  same id before the purge ran survives. Commits left empty are omitted;
  messages lose the forgotten records' trailers and a subject naming them. A
  failed attempt records `last_error`, returns the vault to `active` (writes
  resume) and retries with backoff; the next attempt starts over from the then
  current head. Writes during an attempt fail `busy`; a write admitted just
  before the attempt started is caught by the head check before the switch.
* **Orphan sweep** (six-hourly cron): deletes `mv-<id>-g<n>` repositories older
  than one hour whose vault row is gone (cascaded erasure of an organization,
  Agent or DM space), older generations, and abandoned purge targets; never the
  live generation or an open purge's target. This replaces a delete trigger,
  which `delete "user"` cannot afford (it already sits on D1's trigger-depth
  limit, see `cascade-trigger-depth.test.ts`).
* **Owner operations** (§9, Phase C) call `forgetMemoryVaultRecord` with
  `actor = user:<id>`; it also runs `deleteDmMemory` for legacy documents in
  `briar_memory_vault_legacy_map`.

