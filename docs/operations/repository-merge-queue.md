# Repository merge queue

This design delegates membership, ordering, synthetic commits, and merging to
GitHub's native merge queue. Briar is only the CI executor for the immutable
synthetic SHA named by a signed `merge_group.checks_requested` webhook.

## Security boundary

- Issue/agent tokens cannot configure a validation command or status context.
- The CI definition is loaded from the signed, current `main` base SHA, not the
  pull request tree. A candidate that changes the package/lock manifests,
  compiler/build/audit configuration, Cargo manifests, or CI controller
  scripts receives a deterministic failure instead of choosing what the gate
  executes. Those definition changes require a separately reviewed base/image
  rollout before normal queue traffic resumes.
- Only Workers advertising the `merge_group_ci` v2 isolation attestation can
  claim this providerless lane. The Worker launches one digest-pinned container
  as UID 65532 with no network, a read-only candidate mount, scratch `HOME`, no
  host keychain, and no Briar or GitHub credential in the container.
- Fetch uses a repository-scoped, short-lived installation token before the
  container starts. Status publication runs later in the API with a separate
  short-lived App token; candidate code never shares a process or credential
  boundary with the publisher.
- A live lease, unchanged authoritative GitHub queue tail, exact detached
  worktree HEAD, and clean worktree are checked before publication.
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
- a five-entry build window, with a minimum merge size of two and maximum
  merge size of five;
- a five-minute minimum-group wait, allowing a lone ready PR to make progress
  while giving concurrent ready PRs a deterministic collection window;
- required status checks exactly equal to the four fixed Briar contexts, each
  bound to the Briar GitHub App integration ID;
- `strict_required_status_checks_policy: false`.

GitHub owns cohort sealing and exposes entry state and position for the fixed
five-entry build window. Briar accepts only the highest-position
`AWAITING_CHECKS` entry, atomically supersedes earlier cumulative heads from
that cohort, and leaves later `QUEUED` entries for GitHub's next cohort.
`HEADGREEN` therefore gates the combined tail rather than requiring every
intermediate synthetic SHA. Briar stores no candidate membership or shadow
lifecycle. Changing these limits requires a code and doctor update; there is
no runtime policy mutation endpoint.

Run the read-only verifier from the connected repository:

```sh
briar merge-queue doctor --base-branch main
briar merge-queue doctor --base-branch main --inactive-preflight
```

The command requests effective rules with parent rules included and exits
nonzero for overlapping rulesets, `ALLGREEN`, `strict=true`, wrong or
unbound contexts, any bypass, incompatible build/group limits, or a workflow
without the canonical before-`merged` checkpoint. It also verifies App ID,
approved `administration:read`, `contents:read`, `merge_queues:read`,
`pull_requests:read`, and `statuses:write` permissions, both webhook event
subscriptions, and a live designated isolated Worker.

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

1. `queued` is claimed by the single configured repository/base Worker and
   becomes
   `running` with a token and lease.
2. CI success becomes `validated`; deterministic CI failure becomes `failed`.
   Only infrastructure errors requeue, with a three-attempt bound.
3. Fixed statuses are published to the same SHA. Success becomes `published`;
   a deterministic failure remains `failed` with publication recorded.
4. A deleted/mismatched live ref or replaced GitHub queue tail becomes
   `superseded` with zero new status publications. Auth, rate-limit, network,
   base-read, and 5xx errors remain bounded infrastructure retries.
5. Publication has its own eight-attempt exponential backoff and stored
   per-context receipts. A partial or response-lost publication resumes at the
   first missing context without rerunning CI. Exhausted validation or
   publication remains terminal and visible to administrators instead of
   holding the native queue silently.

The Worker fetches the signed ref to a private local ref, verifies the fetched
SHA and signed base ancestry, always recreates a Briar-managed detached
worktree, and removes both worktree and private ref afterward. It never edits
the connected checkout or an issue worktree, and does not copy
`.worktreeinclude` secrets.

List terminal/retrying jobs and request an explicit administrator recovery:

```sh
briar merge-queue jobs
briar merge-queue retry --job JOB_UUID
```

An infrastructure-exhausted retry reruns isolated CI. A
publication-exhausted retry preserves validation proof and successful context
receipts, so it retries publication only.

## Rollout order — not enabled by this change

**Do not activate the GitHub ruleset while reviewing or merging this code.**
Production rollout is a separate, supervised operation in this order:

1. keep the merge-queue ruleset inactive, capture a D1 Time Travel bookmark,
   and apply the original 0121 plus forward-only cleanup/replacement 0122;
2. deploy the API webhook, App publisher, profile, and recovery endpoints;
3. distribute the matching CLI, configure a digest-pinned executor image, and
   restart the designated isolated Worker. Set
   `BRIAR_MERGE_GROUP_CI_IMAGE=REGISTRY/IMAGE@sha256:DIGEST`; a tag or a missing
   local image keeps the capability unready and prevents claims. The immutable
   image must contain the pinned tools plus offline Bun, Cargo, and Rustup
   caches at `/opt/briar/bun-cache`, `/opt/briar/cargo`, and
   `/opt/briar/rustup`; the executor supplies only bounded tmpfs scratch space;
4. update the GitHub App permissions/events and have an organization owner
   reapprove the installation;
5. save the exact-main profile **disabled** with
   `briar merge-queue configure --disable --worker WORKER_UUID`, verify the
   canonical before-`merged` checkpoint, and run doctor with
   `--inactive-preflight`;
6. enable the profile with `briar merge-queue configure --enable`, then repeat
   the inactive preflight doctor;
7. only then activate the exact main ruleset, run postflight doctor, and
   exercise one supervised synthetic head before normal enqueue traffic.

Rollback disables the ruleset first, runs
`briar merge-queue configure --disable`, then rolls
back Worker/API code. Retain 0122 and its job rows so in-flight state remains
auditable; schema rollback is not part of an incident response.
