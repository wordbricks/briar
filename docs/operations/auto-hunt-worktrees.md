# Auto Hunt per-issue worktrees

Every claimed Auto Hunt issue gets its own git worktree, cut from the freshly
fetched remote base branch. Two runs never share a checkout, no run starts on
another run's uncommitted files, and the connected repository checkout is only
ever used as an object store — never edited by an agent.

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

Worktrees live outside the checkout, so the agent's write sandbox has to be
widened to include the root. The app resolves the root the same way the CLI
does, creates it, and passes it to the provider before the session starts:

- **Codex** — `--config sandbox_workspace_write.writable_roots=["<root>"]` on
  `codex app-server`, alongside the existing `network_access` override.
- **Claude** — `additionalDirectories` in the Agent SDK options.
- **Grok** — nothing to widen; its ACP session is approval-gated rather than
  filesystem-sandboxed.

Turning worktrees off (`--disable-worktrees`) also stops the extra writable
root from being granted.

## Operating it

```sh
briar auto-hunt doctor                 # worktrees.enabled/root/branchPrefix/baseRef
briar auto-hunt worktree list          # every worktree under this project's root
briar auto-hunt worktree show          # the active claim's worktree
briar auto-hunt worktree remove [--path <dir>] [--force]
```

```sh
briar auto-hunt configure --velen-org <slug> \
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
| `worktreeError` in the `next` payload, no worktree | fetch failed with no local base ref, or no base ref exists | record `blocked`; check the remote and `doctor`'s `worktrees.baseRef` |
| `worktrees.baseRef` is `null` | no `origin/HEAD` and no `main`/`master` | `git remote set-head origin -a`, or pass `--base-branch` |
| Removal refuses | uncommitted or untracked files | commit, discard, or pass `--force` |
| `preservedBranch` in the removal result | the branch holds commits the base ref does not | merge, push, or delete it deliberately |
| Worktree missing from `worktree list` | directory deleted outside git | rerun removal; bookkeeping is pruned automatically |

## Remote execution hosts

On an SSH-backed project the worktree is created on that host, next to its
checkout. The CLI runs there against a throwaway copy of `~/.config/briar`, so
allocation never relies on config written by an earlier command: reuse is
detected from `git worktree list` and branch existence.
