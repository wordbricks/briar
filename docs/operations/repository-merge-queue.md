# Repository merge queue

This design delegates membership, ordering, synthetic commits, and merging to
GitHub's native merge queue. Briar is only the CI executor for the immutable
synthetic SHA named by a signed `merge_group.checks_requested` webhook.

## Security boundary

- Issue/agent tokens cannot configure a validation command or status context.
- The Worker always spawns the argument array `bun`, `run`, `ci:local` with no
  shell and a small allowlisted environment. Repository and Briar credentials
  are not inherited by the validation process.
- Only Workers advertising the `merge_group_ci` protocol can claim this lane.
  A live lease, unchanged GitHub ref, exact detached-worktree HEAD, and exact
  claimed SHA are checked before status publication.
- The only published contexts are `signoff/app-worker`,
  `signoff/d1-migrations`, `signoff/rust`, and `signoff/security`.
- Validation proof and publication are separate. A lost GitHub response can
  retry publication without rerunning CI. Lease loss, a changed queue ref, or
  a planned Worker update stops the whole process group and fences stale work.

## Required GitHub ruleset profile

The single active ruleset that targets only `refs/heads/main` must have no
bypass actors and exactly this merge-queue profile:

- grouping strategy `HEADGREEN` and merge method `SQUASH`;
- check response timeout 60 minutes;
- one entry building, and minimum/maximum merge group size of one;
- minimum-group wait of zero minutes;
- required status checks exactly equal to the four fixed Briar contexts;
- `strict_required_status_checks_policy: false`.

The conservative one-at-a-time limits are the initial fail-closed profile.
Changing them requires a code and doctor update; there is no runtime policy
mutation endpoint. The Worker GitHub credential must report repository
`push: true`, which is required for commit status publication.

Run the read-only verifier from the connected repository:

```sh
briar merge-queue doctor --base-branch main
```

The command exits nonzero for a missing/duplicate exact-main ruleset,
`ALLGREEN`, `strict=true`, wrong contexts, any bypass, incompatible group
limits, insufficient Worker permission, or a workflow without the canonical
before-`merged` checkpoint.

## Exact pull request enqueue

After human approval, enqueue an open non-draft PR with:

```sh
briar merge-queue enqueue \
  --pull-request https://github.com/OWNER/REPOSITORY/pull/NUMBER \
  --base-branch main
```

The command runs doctor first, reads the PR's node ID plus base/head SHAs,
calls `enqueuePullRequest(expectedHeadOid, jump:false)`, and reads the PR back.
Any changed base, head, or queue-entry ID fails closed. It never jumps the
queue and never reconstructs a Briar shadow queue.

## Job lifecycle and recovery

`merge_group_validation_jobs` has one row for immutable
`(repository_id, base_ref, head_sha)` identity. Different webhook delivery IDs
for the same SHA converge on that row.

1. `queued` is claimed capacity-aware by one eligible Worker and becomes
   `running` with a token and lease.
2. CI success becomes `validated`; deterministic CI failure becomes `failed`.
   Only infrastructure errors requeue, with a three-attempt bound.
3. Fixed statuses are published to the same SHA. Success becomes `published`;
   a deterministic failure remains `failed` with publication recorded.
4. A changed/deleted merge-group ref becomes `superseded` with zero new status
   publications. An expired or planned-update lease is fenced before requeue.

The Worker fetches the signed ref to a private local ref, verifies the fetched
SHA and signed base ancestry, creates a Briar-managed detached worktree, and
removes both worktree and private ref afterward. It never edits the connected
checkout or an issue worktree, and does not copy `.worktreeinclude` secrets.

## Rollout order — not enabled by this change

**Do not activate the GitHub ruleset while reviewing or merging this code.**
Production rollout is a separate, supervised operation in this order:

1. capture a D1 Time Travel bookmark and apply migration 0121;
2. deploy the API webhook/job endpoints;
3. distribute the matching CLI and restart eligible Workers;
4. verify Workers advertise `merge_group_ci` and pass a dry claim/lease check;
5. update the GitHub App to Merge queues read and subscribe to Merge group;
6. verify the canonical before-`merged` workflow checkpoint and run doctor;
7. only then create/activate the exact main ruleset.

Rollback disables the ruleset first, then rolls back Worker/API code. Retain
the D1 table during rollback so in-flight state remains auditable; remove it
only in a later reviewed migration.
