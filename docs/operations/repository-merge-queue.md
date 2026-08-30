# Repository merge queue coordinator

Briar keeps issue development parallel and serializes only delivery to
`main`. Ready pull requests enter one repository lane, form an immutable
cohort, and are assembled by the designated local Worker as ordinary merge
commits on `briar/merge-queue/<batch-id>`. The Worker validates that exact
integration SHA with the repository commands stored on the selected workflow
boundary, then merges each original pull request in order through GitHub's
ordinary pull-request merge API. The lane remains occupied until signed GitHub
webhooks confirm that every original pull request merged.

This feature is default-off. Applying its migration does not change a GitHub
repository or enable a project profile.

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
- the exact integration ref and protected `main` ref are fetched into private
  refs, verified by SHA, and checked out into a temporary credential-scrubbed
  workspace;
- validation commands are snapshotted from the selected workflow stage when
  the profile is saved and copied onto each batch when collection starts;
- validation proof is stored before status publication, so a publication retry
  never reruns CI;
- one combined status is posted to the claimed SHA as `briar/merge-queue`;
- each original PR is merged with its sealed head SHA, using an enabled
  repository merge method, and GitHub applies the repository's existing rules;
- after each merge, `main` must have the same tree as the corresponding
  validated integration prefix before the next PR can merge;
- Briar never directly resumes member runs. The existing signed-PR path resumes
  them only after the batch itself is complete.

GitHub remains the authoritative merge gate. Briar neither reads nor modifies
repository rulesets, branch protection, required checks, reviews, or bypass
actors. Existing repository policy is applied by the same GitHub merge API used
for an ordinary PR. A policy that rejects the GitHub App installation also
rejects the queued merge and is reported as a GitHub merge failure.

The Briar GitHub App needs Contents, Pull requests, and Commit statuses
read/write permissions plus the Pull request webhook subscription. Neither
Merge queues permission nor the Merge group event is used. Repository-scoped
short-lived installation tokens fetch PR refs, publish the integration ref and
status, and merge the original PRs. The App is not a ruleset bypass actor.

## Safe rollout

Roll out in this order:

1. Apply the Briar migrations with every merge-queue profile absent or
   disabled.
2. Confirm the selected readiness stage has repository validation commands.
   These commands must validate an exact detached integration SHA and must not
   deploy, publish, or require a pull-request branch identity.
3. Confirm signed Pull request deliveries reach Briar.
4. Confirm the designated local Worker has the repository checkout, every tool
   required by the validation commands, working GitHub App access, and one free
   regular execution slot.
5. Configure the profile disabled and run the read-only doctor.
6. Enable the project profile last. Start with a canary window and two pull
   requests; candidates arriving after the cohort freezes wait for the next
   batch.

```sh
briar merge-queue configure --disable --readiness-stage ci_qa
briar merge-queue doctor --json
briar merge-queue configure --enable \
  --readiness-stage ci_qa --quiet-window-ms 300000 --max-batch-size 5
```

`doctor` is read-only. It validates the repository validation plan, GitHub App
access, origin remote, and immutable repository identity. It does not
inspect or change GitHub rulesets.

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

`readinessStageId` must name a stage in the current project workflow and that
stage must contain at least one validation command. The server derives and
stores `validationCommands` in the returned profile; clients do not submit a
second command source. The optional `quietWindowMs` and `maxBatchSize` fields
preserve their stored values, or use the server defaults of 300000 and 5 for a
new profile. The Workflow UI exposes enablement and the readiness boundary;
batching controls remain an operator concern.

An enabled profile prevents workflow updates that remove its readiness stage or
change that stage's validation commands. Disable the queue, save the workflow,
then explicitly re-enable it to snapshot the new plan. Changing the boundary or
validation plan is also a fresh proof boundary: only completions observed after
that configuration change can become candidates. Runs whose frozen workflow
does not contain the newly selected stage remain ineligible rather than falling
back to another stage.

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
finishes the durable validation result, and leaves the lane `blocked` for operator
review. Infrastructure failures release the fenced lease for retry;
they do not publish a false failure. A stale Worker cannot renew, record proof,
publish completion, or release a claim after its lease expires.

Never clear a blocked lane by editing D1 directly. First inspect the exact
cohort and integration ref, remove or repair its original entries, and rework the
member runs so new exact heads produce a new cohort.

For rollback, stop new profile claims first, drain or resolve the active cohort,
and confirm no integration publish is active. The API refuses to disable or
retarget a profile while an active batch holds its lane.
