# Workflow worktrees

Every claimed Auto Hunt issue gets its own git worktree, cut from the freshly
fetched remote base branch. Two runs never share a checkout, no run starts on
another run's uncommitted files, and the connected repository checkout is only
ever used as an object store — never edited by an agent.

## Invocation boundary

Opening a saved project agent does not start Auto Hunt. Before every saved-agent
turn, the host fetches the origin default branch, creates a detached temporary
worktree from that exact commit, copies the configured `.worktreeinclude`
inputs, and starts the agent with that worktree as its `cwd`. The connected
checkout is used only as the Git object store and is never the agent workspace:

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
control-plane access. The saved-agent worktree is removed after the turn,
including when the agent fails; a worktree allocation, fetch, or cleanup error
fails the run instead of falling back to the connected checkout.

Approved Project Agent Skill executions claimed by a selected Worker use the
same detached temporary-worktree lifecycle as project-scoped channel turns.
The task UUID selects the isolated checkout path, `.worktreeinclude` inputs are
copied before the provider starts, and the checkout is removed after success,
failure, or cancellation. Allocation never falls back to the connected
checkout.

## Where things live

| | Value |
| --- | --- |
| Worktree root | `$BRIAR_WORKTREE_ROOT` → `autoHunt.worktrees.root` → `~/briar/workspaces`, always suffixed with the project id |
| Directory name | `<title-slug>-<first 8 of runId>`, e.g. `fix-login-redirect-3f6b9c21` |
| Branch | `<autoHunt.worktrees.branchPrefix or "briar">/<directory name>` |
| Base | `refs/remotes/origin/HEAD`, else `origin/main`, `origin/master`, `main`, `master` |

The name is derived from the run id, so re-claiming a run after a retry
re-enters the same worktree instead of piling up near-duplicates.
The desktop runtime passes the real host home separately to its isolated CLI,
so the default root remains under `~/briar/workspaces` even though credentials
and config run with a temporary `HOME`.

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

Project-scoped channel turns and queued-issue replies also receive these inputs
in detached analysis worktrees. A channel turn removes its checkout when the
reply finishes. Queued-issue replies reuse one read-only checkout per issue
conversation until its idle timeout; neither path preserves local changes as
durable issue work.

Build outputs are not copied. Agents run the project's own install/setup
commands inside the worktree.

## Agent write access

Auto Hunt worktree creation is a local runtime control-plane operation. The desktop
runtime invokes the isolated Briar CLI before starting a worker, so
`git worktree add` writes the connected repository's shared `.git/refs` and
`.git/worktrees` with application authority rather than from inside an agent sandbox.
Only after allocation succeeds does the app start a worker with that exact
worktree as its `cwd`.

Every worker gets its own isolated Briar config snapshot and absolute
`BRIAR_CLI`/`BRIAR_CONFIG_HOME` bindings. Login-shell PATH changes therefore
cannot redirect run reporting to another project's config. The worker is told
to use the assigned run ID explicitly and cannot claim another queue item.

Auto Hunt uses unrestricted filesystem access by default. Codex runs with
`danger-full-access` and Claude with `bypassPermissions`, so a worker can write
anywhere the user account can. The worker still starts in its assigned worktree,
and repository instructions still require all project edits to stay there.
Grok has no filesystem sandbox either; its ACP session is approval-gated.

### Enabling the workspace sandbox

A project can confine writes to the assigned checkout, its linked Git metadata,
the declared worktree root, and `/tmp`/`$TMPDIR`:

```sh
briar project configure --disable-full-access
```

This switches Codex to `workspace-write` and enables Claude's workspace
sandbox. Reads remain unrestricted: an agent can read anything the user can,
including other repositories and dotfiles. Restore the default with:

```sh
briar project configure --enable-full-access --i-understand-the-risk
```

The same choice is available in Briar under **Project settings → Agent
configuration → Filesystem access**. `briar project doctor` reports the
resolved value under `sandbox.fullAccess`.

Auto Hunt input — issue titles, descriptions, attachments, repository content —
is untrusted by contract, the session runs unattended, and network access is
already unrestricted. Workspace-only mode limits the impact of prompt injection
that attempts to write outside the assigned worktree. The configured approval
policy remains independent of this setting.

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
briar worktree maintain [--path <dir>] # compact outputs; completed+24h GC when clean
briar worktree maintain --all          # sweep recorded completed worktrees
briar worktree remove [--path <dir>] [--force]
```

```sh
briar project configure \
  --worktree-root ~/briar/workspaces --branch-prefix briar
```

`--disable-worktrees` returns a project to working directly in its checkout;
`--enable-worktrees` turns it back on. The block is owned by the CLI and is
preserved when the app saves project settings.

Issue conversation replies are durable Worker jobs. A reply for an actively
processed run stays on its assigned Worker and reads the existing issue
worktree without modifying it, so answers can include live uncommitted context.
If that required worktree is missing, the reply fails instead of silently
answering from an older checkout.

An issue that has never been assigned has no execution worktree and no
preferred Worker, so any eligible Worker may claim its mention reply. That
Worker creates a detached read-only analysis worktree keyed by run id. Later
replies for the same run reuse that checkout when they land on the same Worker;
conversation continuity itself remains in the durable server messages and does
not depend on local files. The Worker records the last use outside the checkout,
never stores private reply images in it, and removes it after 30 idle minutes.
An automatic sweep runs every five minutes, excludes paths with active replies,
and also reclaims idle records left behind by a Worker restart.

For a completed run, a reply may attach a `request_issue_rework` proposal when
the user's message explicitly asks to revise the result. Creating the proposal
does not change the run. The issue conversation renders an approval button, and
only an authenticated user click applies the rework. Acceptance keeps the same
attempt, branch, pull request, prior events, and evidence, increments the
revision, and invalidates evidence only from the selected workflow stage onward.

An `@briar` reply may also attach `request_issue_update` or
`request_issue_create` when the user's own message explicitly asks to edit the
current issue or create another issue. These actions use the same proposal and
approval flow: the agent cannot write directly, and nothing changes until an
authenticated user clicks the approval button. Updates are rejected if the
source issue changed after the proposal was created, so stale conversation
context cannot overwrite newer edits. Creation adds a new issue to the same
project while leaving the current run, branch, pull request, QA evidence, and
conversation history intact.

Removal is conservative by design:

1. It refuses while the worktree has uncommitted or untracked changes, before
   anything is torn down, so a failed removal leaves an inspectable checkout.
2. The branch is deleted with `-d`. If git refuses only because the local `HEAD`
   is behind, the branch is dropped with `-D` **after** proving it is an
   ancestor of the base ref (no unique commits). Otherwise the branch is kept
   and reported as `preservedBranch`.

## Terminal-run maintenance

After an Auto Hunt Worker exits and evidence capture has finished, Briar runs
worktree maintenance from the connected repository rather than from the
Worker's former current directory. Maintenance has two ordered phases:

1. Compact reproducible directories such as `node_modules`, Cargo `target`,
   `.next`, `dist`, and `build`. A directory is removed only when its name is
   on Briar's allowlist **and** `git check-ignore` confirms that exact path is
   ignored. Tracked source directories and ignored secrets such as `.env` are
   not removed.
2. Record completed worktrees for a 24-hour inspection and fast-rework window.
   The desktop host and registered Worker sweep those records hourly and remove
   the checkout when it is clean. Merge state does not gate checkout removal:
   a branch with commits absent from the base ref is preserved separately, and
   a later retry or rework recreates its worktree from that branch. Source
   changes, an unreadable Git status, or a removal error keeps the checkout.

Maintenance is best-effort and never changes the run outcome. Blocked and
failed runs therefore keep their source checkout for inspection, while their
reproducible dependency and build output can be restored on retry. The same
logic is available manually through `briar worktree maintain`; `--all` sweeps
all recorded completions for the current project.

## Failure modes

| Symptom | Cause | Action |
| --- | --- | --- |
| `workspaceError` in the claim payload, no workspace | fetch failed with no local base ref, or no base ref exists | record `blocked`; check the remote and `doctor`'s `worktrees.baseRef` |
| `worktrees.baseRef` is `null` | no `origin/HEAD` and no `main`/`master` | `git remote set-head origin -a`, or pass `--base-branch` |
| Removal refuses | uncommitted or untracked files | commit, discard, or pass `--force` |
| `preservedBranch` in the removal result | the removed checkout's branch holds commits the base ref does not | keep it for rework, push it, or delete it deliberately |
| Worktree missing from `worktree list` | directory deleted outside git | rerun removal; bookkeeping is pruned automatically |
