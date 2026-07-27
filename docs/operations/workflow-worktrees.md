# Workflow worktrees

Every claimed Auto Hunt issue gets its own git worktree, cut from the freshly
fetched remote base branch. Two runs never share a checkout, no run starts on
another run's uncommitted files, and the connected repository checkout is only
ever used as an object store — never edited by an agent.

## Invocation boundary

Opening a saved project agent does not start Auto Hunt. It starts one ordinary
agent conversation in the connected project workspace:

```text
user starts an agent
  └─ ordinary request → agent completes it in the same conversation
  └─ explicit Auto Hunt request
       └─ agent returns a structured dispatch request
            └─ Briar host runtime claims runs, allocates worktrees,
               starts workers, and monitors them
```

The agent cannot claim queue work or allocate an issue worktree during this
initial turn. It may return `dispatch_auto_hunt` only when the user explicitly
asks to start Auto Hunt or to process queued issues through Auto Hunt; merely
mentioning, inspecting, or discussing an issue remains ordinary single-session
work. The host validates the structured request and owns every subsequent
queue, Git, and worker lifecycle operation.

The initial conversation id is retained as the dispatch coordinator id. Once
all workers terminate, the host resumes that same conversation in read-only
mode with canonical worker reports. This makes the agent that requested the
dispatch the agent that reports the aggregate result, without granting it
control-plane access.

## Where things live

| | Value |
| --- | --- |
| Worktree root | `$BRIAR_WORKTREE_ROOT` → `autoHunt.worktrees.root` → `~/briar/worktrees`, always suffixed with the project id |
| Directory name | `<title-slug>-<first 8 of runId>`, e.g. `fix-login-redirect-3f6b9c21` |
| Branch | `<autoHunt.worktrees.branchPrefix or "briar">/<directory name>` |
| Base | `refs/remotes/origin/HEAD`, else `origin/main`, `origin/master`, `main`, `master` |

The name is derived from the run id, so re-claiming a run after a retry
re-enters the same worktree instead of piling up near-duplicates.

## Why the base is always the remote branch

Probe order puts remote-tracking refs ahead of local branches, and the exact
base branch is fetched immediately before `git worktree add`:

```sh
git -c maintenance.auto=false -c gc.auto=0 \
  fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main
```

Only that one ref is fetched, and repository auto-maintenance is suppressed so
an unrelated `gc` cannot stall issue pickup. The worktree is then created from
the fully qualified `refs/remotes/origin/main`, never from a short name that a
tag could shadow:

```sh
git worktree add --no-track -b briar/<name> <path> refs/remotes/origin/main
```

`--no-track` keeps the base's upstream off the new branch, so `git status`
cannot report a fresh branch as "behind by N" before its first push;
`push.autoSetupRemote=true` is set in the worktree (only when the user has no
value at any scope) so a plain `git push` still creates and tracks the remote
branch.

Two deliberate consequences:

- **The local `main` branch is never moved.** Only the remote-tracking ref is
  refreshed. Nothing in an operator's checkout changes when an issue is claimed.
- **A fetch failure is fatal only when there is no local copy of the base ref.**
  With an existing (possibly slightly stale) ref, allocation proceeds so a
  transient network blip cannot strand an already-claimed run.

## Gitignored files: `.worktreeinclude`

A fresh worktree has no gitignored files, which breaks any project that needs
local secrets or tooling config. List the paths to carry over in a
repository-root `.worktreeinclude`, one literal path per line (`#` comments
allowed; globs and negations are skipped):

```
.env.keys
.dev.vars
```

Entries are **copied**, never symlinked, so an agent editing one issue's file
cannot mutate the shared checkout. Missing entries are skipped silently — a
worktree is never failed over an unavailable include.

Build outputs are not copied. Agents run the project's own install/setup
commands inside the worktree.

## Agent write access

Auto Hunt worktree creation is a host control-plane operation. The desktop
runtime invokes the isolated Briar CLI before starting a worker, so
`git worktree add` writes the connected repository's shared `.git/refs` and
`.git/worktrees` with host authority rather than from inside an agent sandbox.
Only after allocation succeeds does the app start a worker with that exact
worktree as its `cwd`.

Every worker gets its own isolated Briar config snapshot and absolute
`BRIAR_CLI`/`BRIAR_CONFIG_HOME` bindings. Login-shell PATH changes therefore
cannot redirect run reporting to another project's config. The worker is told
to use the assigned run ID explicitly and cannot claim another queue item.

Because the provider starts inside the final checkout, Codex and Claude grant
their normal workspace-write permissions to that checkout and its linked Git
metadata. The broad project worktree root is no longer added as a writable
directory.

Reads are **not** restricted in either sandbox: an agent can read anything the
user can, including other repositories and dotfiles. Only writes are confined —
to the checkout, the declared worktree root, and `/tmp`/`$TMPDIR`. Grok has no
filesystem sandbox at all (its ACP session is approval-gated), so a Grok project
relies on the skill contract rather than on enforcement.

### Opting out of the sandbox

A project can drop the filesystem sandbox entirely:

```sh
briar project configure --enable-full-access --i-understand-the-risk
```

This switches codex to `danger-full-access` and claude to `bypassPermissions`,
so agents can write anywhere the user can. It is off by default, requires the
explicit risk acknowledgement flag, and `--disable-full-access` reverses it.
`briar project doctor` reports the current value under `sandbox.fullAccess`.

Understand what it removes before enabling it. Auto Hunt input — issue titles,
descriptions, attachments, repository content — is untrusted by contract, the
session runs unattended, and network access is already unrestricted. The
sandbox is what stops a prompt injection in that input from writing outside the
worktree. The configured approval policy is deliberately left alone when full
access is on, so pairing it with `on-request` approvals keeps a human gate in
place; combining it with `never` leaves none.

When full access is on, the worker still starts in its assigned worktree, but
there is no filesystem sandbox around it.

## Dispatch groups and worker recovery

One Auto Hunt request is persisted as a dispatch group. Each claimed run is
linked to a stable child worker session and workspace:

```text
dispatchGroupId
  └─ worker sessionId → runId → worktree path → conversationId
```

Allocation, progress messages, approval waits, and terminal worker states are
stored as monotonic cursor events. After each worker terminates, the host reads
that run's canonical evidence with `briar run evidence list --run <id>` and
copies the structured records into `worker_evidence` cursor events. The UI
subscribes live and can reload the same state after its React view is recreated.
If the desktop process itself restarts, its app-server children cannot survive;
startup marks any orphaned running group `interrupted` and preserves its
run/worktree references for inspection. Server claim leases remain
authoritative and make abandoned queued runs recoverable.

After every child reaches a terminal state, Briar resumes the saved project
agent conversation that requested the dispatch. This coordinator turn is
read-only, receives the canonical worker reports, and may only produce the
user-facing aggregate summary; it cannot change outcomes, claim work, or edit a
checkout. Direct Auto Hunt launches that have no initial conversation still
create a fresh coordinator conversation. If the coordinator summary fails, the
runtime preserves all worker results and falls back to a deterministic count
summary.

## Operating it

```sh
briar project doctor                   # worktrees.enabled/root/branchPrefix/baseRef
briar worktree list                    # every worktree under this project's root
briar worktree show                    # the active claim's worktree
briar worktree remove [--path <dir>] [--force]
```

```sh
briar project configure \
  --worktree-root ~/briar/worktrees --branch-prefix briar
```

`--disable-worktrees` returns a project to working directly in its checkout;
`--enable-worktrees` turns it back on. The block is owned by the CLI and is
preserved when the app saves project settings.

Issue conversation replies follow the same isolation rule. When a user mentions
`@briar`, the app resolves the run's recorded branch (or its run-id token before
the branch has been recorded) against Git's registered worktree list and resumes
the agent conversation with that worktree as its workspace. If the original
worktree has already been removed, the reply fails explicitly instead of
running in the shared connected checkout.

Removal is conservative by design:

1. It refuses while the worktree has uncommitted or untracked changes, before
   anything is torn down, so a failed removal leaves an inspectable checkout.
2. The branch is deleted with `-d`. If git refuses only because the local `HEAD`
   is behind, the branch is dropped with `-D` **after** proving it is an
   ancestor of the base ref (no unique commits). Otherwise the branch is kept
   and reported as `preservedBranch`.

## Failure modes

| Symptom | Cause | Action |
| --- | --- | --- |
| `workspaceError` in the claim payload, no workspace | fetch failed with no local base ref, or no base ref exists | record `blocked`; check the remote and `doctor`'s `worktrees.baseRef` |
| `worktrees.baseRef` is `null` | no `origin/HEAD` and no `main`/`master` | `git remote set-head origin -a`, or pass `--base-branch` |
| Removal refuses | uncommitted or untracked files | commit, discard, or pass `--force` |
| `preservedBranch` in the removal result | the branch holds commits the base ref does not | merge, push, or delete it deliberately |
| Worktree missing from `worktree list` | directory deleted outside git | rerun removal; bookkeeping is pruned automatically |

## Remote execution hosts

On an SSH-backed project the worktree is created on that host, next to its
checkout. The CLI runs there against a throwaway copy of `~/.config/briar`, so
allocation never relies on config written by an earlier command: reuse is
detected from `git worktree list` and branch existence.
