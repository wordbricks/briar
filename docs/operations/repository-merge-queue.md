# Repository merge queue coordinator

Briar keeps issue development parallel and serializes only delivery to
`main`. Ready pull requests enter one repository lane, form an immutable
cohort, and are assembled by the designated local Worker as ordinary merge
commits on `briar/merge-queue/<batch-id>`. The Worker validates that exact
integration SHA and publishes it to `main` with an exact-base lease. The lane
remains occupied until signed GitHub webhooks confirm
that every original pull request merged.

This feature is default-off. Applying its migration does not change a GitHub
repository, enable a project profile, publish an OCI image, or activate a
ruleset.

## Invariants

The coordinator enforces these boundaries:

- issue agents continue to claim, branch, and open pull requests in parallel;
- one enabled Briar project owns each immutable `(repository ID, main)` lane;
- completion of the workflow stage selected by the project and the current
  exact PR identity make a candidate ready;
- a force-push, draft change, close, base retarget, or run revision change
  invalidates a mutable candidate and blocks an already-frozen cohort;
- collection stays open until five minutes after the latest ready candidate;
  reaching the five-PR limit freezes the cohort immediately;
- one transaction freezes at most five candidates with stable ordinals;
- enqueue records a stable internal entry only after an exact OPEN, non-draft
  PR identity readback;
- the Worker fetches every exact PR head, merges the sealed cohort in ordinal
  order, and publishes one immutable integration ref;
- the exact integration ref and protected `main` ref are fetched into private refs,
  verified by SHA, and passed credential-free to the isolated executor;
- validation proof is stored before status publication, so a publication retry
  never reruns CI;
- statuses are posted to the claimed SHA as `signoff/app-worker`,
  `signoff/d1-migrations`, `signoff/rust`, and `signoff/security`;
- Briar never directly resumes member runs. The existing signed-PR path resumes
  them only after the batch itself is complete.

GitHub branch protection remains the authoritative `main` gate. The exact-main
ruleset must grant always-on bypass to exactly one trusted publisher GitHub App
or a dedicated single-member publisher team used by the local Worker's `gh`
credential. The D1 lane and `--force-with-lease`
serialize that publisher; no other user, role, team, or App may bypass it.

## Required GitHub policy

Before enabling a Briar profile, create one repository-level branch ruleset
that targets only `refs/heads/main` and verify all of the following:

- enforcement is active and the same single GitHub App or dedicated publisher
  team has `always` bypass on every effective exact-main ruleset;
- pull requests are required;
- deletion and non-fast-forward updates are blocked;
- linear-history, required-signature, and commit-metadata rules do not apply to
  the publisher; cohort publication intentionally creates merge commits;
- the four `signoff/*` contexts above are required;
- required status checks use `strict_required_status_checks_policy: false`.

Disabling strict branch updates is intentional. The merge queue builds a
cumulative commit against the current protected base, so individual pull
requests do not need to rerun the same CI merely because another pull request
merged first.

The Briar GitHub App needs Pull requests read and the Pull request webhook
subscription. It remains read-only. Neither Merge queues permission nor the
Merge group event is used. The local Worker's existing `gh` credential fetches
PR refs, publishes integration refs and statuses, and performs the lease-fenced
fast-forward to `main`.

## Safe rollout

Do not activate the production ruleset as part of a code deployment or pull
request review. Roll out in this order during an explicit maintenance window:

1. Apply the Briar migrations with every merge-queue profile absent or
   disabled.
2. Publish an independently reproduced OCI executor digest and update both the
   audited manifest and compiled digest in one reviewed change. Until then the
   Worker refuses merge-batch claims.
3. Confirm signed Pull request deliveries reach Briar.
4. Create the exact-main ruleset inactive or in evaluation mode and inspect its
   full JSON, including bypass actors and required check sources.
5. Confirm the designated local Worker has the audited image, repository
   checkout, authenticated `gh`, and one free regular execution slot.
6. Configure the profile disabled, activate the GitHub ruleset, and run the
   fail-closed doctor. It checks the effective rules even while the profile is
   disabled, so no batch can be claimed during this preflight.
7. Enable the project profile last. Start with a canary window and two pull
   requests; candidates arriving after the cohort freezes wait for the next
   batch.

```sh
briar merge-queue configure --disable --readiness-stage ci_qa
briar merge-queue doctor --json
briar merge-queue configure --enable \
  --readiness-stage ci_qa --quiet-window-ms 300000 --max-batch-size 5
```

`doctor` is read-only. It validates the audited local runtime, local `gh`
authentication, immutable repository identity, effective exact-main active
rulesets, exactly one publisher bypass actor, branch protections, the exact
four status contexts, and `strict=false`. It never
creates or edits GitHub rulesets.

The profile API is owner/admin-only:

```text
GET /projects/<project-id>/merge-queue-profile
PUT /projects/<project-id>/merge-queue-profile
{
  "enabled": false,
  "readinessStageId": "ci_qa"
}
```

The authenticated read-only diagnostics endpoint returns up to five recent
batches and twelve recent candidates, with active states first:

```text
GET /projects/<project-id>/merge-queue-status
```

The Workflow UI displays this snapshot with a manual refresh action. It omits
claim credentials, Worker identity, validation logs, and failure detail; only
the PR link, durable state, timestamps, counts, integration SHA, and failure
code are exposed. The response is private and not cached.

`readinessStageId` must name a stage in the current project workflow. The
optional `quietWindowMs` and `maxBatchSize` fields preserve their stored values,
or use the server defaults of 300000 and 5 for a new profile. The Workflow UI
exposes enablement and the readiness boundary; batching controls remain an
operator concern.

An enabled profile prevents workflow updates that remove its readiness stage.
Changing the boundary is also a fresh proof boundary: only completions observed
after that configuration change can become candidates. Runs whose frozen
workflow does not contain the newly selected stage remain ineligible rather
than falling back to another stage.

The server derives the immutable repository identity from the connected
project and GitHub installation. It does not accept a shell command, status
context list, repository ID, or base branch from the request.

## State and recovery

The normal lane is:

```text
collecting → frozen → enqueueing → waiting_tail
           → validating → publishing → awaiting_merge → completed
```

A deterministic CI failure publishes failure for the same integration SHA,
finishes all four durable status results, and leaves the lane `blocked` for operator
review. Infrastructure failures release the fenced lease for retry;
they do not publish a false failure. A stale Worker cannot renew, record proof,
publish completion, or release a claim after its lease expires.

Never clear a blocked lane by editing D1 directly. First inspect the exact
cohort and integration ref, remove or repair its original entries, and rework the
member runs so new exact heads produce a new cohort.

For rollback, stop new profile claims first, drain or resolve the active cohort,
confirm no integration publish is active, restore the previous protected-branch
policy, and only then remove the trusted publisher bypass. The API refuses
to disable or retarget a profile while an active batch holds its lane.
