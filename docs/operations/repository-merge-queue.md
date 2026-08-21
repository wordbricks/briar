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
- Only Workers advertising the `merge_group_ci` v3 isolation attestation can
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

GitHub remains authoritative for queue membership, ordering, synthetic heads,
and merging. Before enqueue, Briar has one narrow admission coordinator per
repository/base lane: current-revision `ci_qa` completion registers immutable
PR ID/head/base evidence, the App publishes the same four admission contexts
to that exact PR head, and a five-minute collection window seals at most five
ready PRs. Five ready entries seal immediately; a lone entry seals at the
deadline so it cannot starve. Entries becoming ready after sealing belong to
the next generation.

The sealed generation stores only its exact expected PR/head set and an
enqueue cursor. It resumes `enqueuePullRequest(expectedHeadOid, jump:false)`
after a crash and verifies every entry readback. Signed merge-group deliveries
arriving while a generation is collecting/enqueuing are durable but cannot be
claimed. Briar authorizes one executor only after GitHub's fully paginated
queue connection shows the sealed set as one consecutive `AWAITING_CHECKS`
window and its exact cumulative tail equals the signed ref/SHA. External,
late, or reordered entries fail the generation closed; they are never silently
added. No aggregate PR is created, and original PR identities continue to
drive the existing merged-webhook resume invariant.

Run the read-only verifier from the connected repository:

```sh
briar merge-queue doctor --base-branch main
briar merge-queue doctor --base-branch main --inactive-preflight
```

The command reads the App-credentialed server attestation, then requests
effective rules with parent rules included and exits
nonzero for overlapping rulesets, `ALLGREEN`, `strict=true`, wrong or
unbound contexts, any bypass, incompatible build/group limits, or a workflow
without the canonical before-`merged` checkpoint. It also verifies App ID,
approved `administration:read`, `contents:read`, `merge_queues:write`,
`pull_requests:read`, and `statuses:write` permissions, both webhook event
subscriptions, and a live designated isolated Worker.

## Automatic and break-glass enqueue

Normal operation does not call a CLI enqueue command. Current-revision `ci_qa`
completion starts the fenced App admission and sealed-generation flow above.
For incident recovery only, an administrator may enqueue an already-admitted
open non-draft PR with:

```sh
briar merge-queue enqueue \
  --pull-request https://github.com/OWNER/REPOSITORY/pull/NUMBER \
  --base-branch main \
  --break-glass
```

The command runs doctor first, reads the PR's node ID plus base/head SHAs,
calls `enqueuePullRequest(expectedHeadOid, jump:false)`, and reads the PR back.
Any changed base, head, or queue-entry ID fails closed. It never jumps the
queue and never reconstructs a Briar shadow queue.

## Job lifecycle and recovery

The signed webhook first commits an `authority_pending` row, before Worker
readiness or any GitHub REST/GraphQL read. `merge_group_validation_jobs` has one
row for immutable
`(repository_id, base_ref, head_sha)` identity. Different webhook delivery IDs
for the same SHA converge on that row.

1. `authority_pending`/`authority_retry` performs bounded, paginated queue
   convergence checks. Ref deletion, base movement, or identity mismatch is
   stale; auth, network, rate-limit, 5xx, and read-model convergence retry.
2. Only an exact sealed authoritative tail becomes `queued`; it is claimed by
   the single configured repository/base Worker and
   becomes
   `running` with a token and lease.
3. CI success becomes `validated`; deterministic CI failure becomes `failed`.
   Only infrastructure errors requeue, with a three-attempt bound.
4. Fixed statuses are published to the same SHA. Success becomes `published`;
   a deterministic failure remains `failed` with publication recorded.
5. A deleted/mismatched live ref or replaced GitHub queue tail becomes
   `superseded` with zero new status publications. Auth, rate-limit, network,
   base-read, and 5xx errors remain bounded infrastructure retries.
6. Publication has its own eight-attempt exponential backoff and stored
   per-context receipts. A partial or response-lost publication resumes at the
   first missing context without rerunning CI. Exhausted validation or
   publication remains terminal and visible to administrators instead of
   holding the native queue silently.

Each validation stores a bounded log plus its SHA-256, exact image, exit code,
deadline, and truncation flag. A terminal CI/publication/dequeue failure marks
the sealed generation failed/superseded and moves every still-paused exact
member to a new actionable `ci_qa` revision with the job ID and retry route.
This recovery never marks a run merged; only the existing signed
`pull_request closed` with `merged:true` path can resume successful members.

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
3. build `containers/merge-group-ci/Dockerfile` with
   `containers/merge-group-ci/build.sh`, independently reproduce the recorded
   `config/merge-group-ci-image.json` manifest digest, publish that exact OCI
   manifest, distribute the matching CLI, and
   restart the designated isolated Worker. Set
   `BRIAR_MERGE_GROUP_CI_IMAGE=ghcr.io/wordbricks/briar-merge-group-ci@sha256:00fe9667e314d8b388aba1e4f27ceb5b08ba9672060d5c804f7cafc98238196c`;
   any other digest, a tag, or a missing local image keeps the capability
   unready and prevents claims. The immutable
   image uses a digest-pinned Rust base, dated Debian snapshots, checksum-pinned
   Bun/Node/cargo-audit/gitleaks releases, a commit-pinned RustSec database, and
   the exact lockfile audit proof. It contains offline Bun, Cargo, and Rustup
   caches at `/opt/briar/bun-cache`, `/opt/briar/cargo`, and
   `/opt/briar/rustup`; the executor supplies only bounded tmpfs scratch space;
4. update the GitHub App permissions/events and have an organization owner
   reapprove the installation;
5. save the exact-main profile **disabled** with
   `briar merge-queue configure --disable --worker WORKER_UUID`, verify the
   canonical before-`merged` checkpoint, and run doctor with
   `--inactive-preflight`;
6. enable the profile with `briar merge-queue configure --enable`, then run the
   normal postflight doctor;
7. only then activate the exact main ruleset, run postflight doctor, and
   exercise one supervised synthetic head before normal enqueue traffic.

Rollback disables the ruleset first, runs
`briar merge-queue configure --disable`, then rolls
back Worker/API code. Retain 0122 and its job rows so in-flight state remains
auditable; schema rollback is not part of an incident response.
