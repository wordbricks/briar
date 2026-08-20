# Repository merge queue delivery

## Authority and scope

GitHub's **Require merge queue** rule is the only authoritative gate on the
protected base branch. Briar never treats a D1 row, an in-memory mutex, or a
Worker lease as a lock on `main`, and the coordinator never passes `--admin`.

Briar's repository policy applies to one immutable GitHub repository ID and
base branch. Issue implementation claims remain concurrent. After an issue's
ordinary `ci_qa` stage passes once, its current attempt, revision, pull request
identity, and head SHA become a delivery candidate. The issue claim is released
until GitHub merges that original pull request.

For each repository/base pair, D1 permits exactly one active batch. Candidates
are collected for the configured quiet window and sorted by:

1. explicit issue priority (P1 first, then P2-P4, then no priority);
2. `readyAt`;
3. immutable run ID.

The cohort is frozen atomically. A later candidate has no batch ID and is moved
to the next batch only after the active batch reaches a terminal state.

## Rollout order

Do not change the production ruleset as part of a coordinator application
deployment. Roll out in this order:

1. Deploy migration `0121_repository_merge_batches.sql`, the API, and the new
   CLI/Workers. Keep the repository merge policy disabled.
2. In GitHub repository settings, add **Require merge queue** to the ruleset
   targeting the base branch. Keep the four required status contexts:
   `signoff/app-worker`, `signoff/d1-migrations`, `signoff/rust`, and
   `signoff/security`. Configure the queue's grouping limits so the intended
   Briar cohort can be represented by one GitHub merge group.
3. On every selected Worker, verify `gh auth status --hostname github.com`.
   The account must be able to read rules/PRs, enqueue PRs, fetch queue refs,
   and create commit statuses. It does not need admin bypass.
4. Activate the Briar policy from the connected repository:

   ```sh
   briar merge-queue configure \
     --repository owner/name \
     --base-branch main \
     --quiet-window-ms 30000
   ```

   Activation first reads the live branch rules and fails closed unless the
   native queue rule is present. The command does not modify GitHub settings.
5. Run `briar project doctor`. An enabled policy must report
   `mergeQueue.healthy: true`. A disabled policy reports no queue health and
   leaves the legacy delivery path unchanged.

To stop admitting new batches without changing GitHub protection, run the same
configure command with `--disable`. An already frozen batch retains its durable
state for diagnosis; disabling is not a destructive dequeue.

## Validation lifecycle

Immediately before each enqueue, the Worker reads the live pull request and
requires the same immutable PR node ID and frozen head SHA; open, non-draft
state; the configured base branch; and GitHub's `MERGEABLE` state.

The GraphQL enqueue mutation always includes `expectedHeadOid`. On retry, the
coordinator first reads `mergeQueueEntry`; an already-enqueued PR is recorded
without issuing a duplicate mutation. Stale, conflicting, closed, draft, or
wrong-base PRs fail closed and stay intact.

After enqueue, the Worker finds a `gh-readonly-queue` ref whose exact commit
contains every frozen member head. It fetches that ref and creates a detached
Briar-managed worktree under the project's `merge-groups` directory. The
connected checkout and every issue worktree remain untouched, while
`.worktreeinclude` inputs are copied with the standard safe-copy rules.

The policy's validation command (default `bun run ci:local`) runs once in that
exact synthetic checkout. Before publishing, the Worker rechecks the worktree
`HEAD`, GitHub's live merge-group ref, and the D1 lease/stored SHA. Only then
are the four statuses posted to that exact synthetic SHA. GitHub still moves
each original PR to `merged:true`; the existing signed `pull_request` webhook
binding resumes each matching current-revision run independently at `merged`.

## Failure and recovery

- **Worker crash or lease expiry:** the batch, frozen ordering, queue entry IDs,
  and member heads remain in D1. After the 15-minute lease expires, a Worker
  reclaims the same batch and detects existing queue entries.
- **Planned Worker update:** the coordinator has no provider conversation to
  transfer. Renewal stops, and lease expiry hands the same frozen batch to an
  updated Worker. Issue worktrees and evidence remain untouched.
- **Partial enqueue or dequeue:** a live PR with no queue entry is enqueued
  again with its original expected head; a live mismatch fails closed.
- **CI or GitHub failure:** the batch becomes `failed` or `blocked`; original
  PRs, issue worktrees, and evidence are preserved. Correct the cause, then run
  `briar merge-queue retry --batch <uuid>`. Retry is refused if any member's
  attempt or revision is no longer current.
- **Conflict or stale revision:** do not force or dequeue unrelated PRs. Rework
  the issue normally; its new revision becomes a later candidate.

## Limits

Native merge queue can run admission checks on each PR and a separate check on
its synthetic merge group. This design does not claim that all repository CI
runs only once. It removes repeated signoff caused by `main` drift, while
running the frozen cohort's full validation once on the exact synthetic SHA.

GitHub controls final group composition and order. If repository queue limits
split a Briar cohort, the coordinator refuses to validate a ref that lacks any
frozen head. Adjust GitHub grouping or the Briar quiet window instead of
weakening the SHA fence.
