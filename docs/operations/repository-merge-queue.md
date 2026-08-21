# Repository merge queue coordinator

Briar keeps issue development parallel and serializes only delivery to
`main`. Ready pull requests enter one repository lane, form an immutable
cohort, and are queued in their original form through GitHub's native merge
queue. The designated local Worker validates only the final cumulative
merge-group SHA. The lane remains occupied until signed GitHub webhooks confirm
that every original pull request merged.

This feature is default-off. Applying its migration does not change a GitHub
repository, enable a project profile, publish an OCI image, or activate a
ruleset.

## Invariants

The coordinator enforces these boundaries:

- issue agents continue to claim, branch, and open pull requests in parallel;
- one enabled Briar project owns each immutable `(repository ID, main)` lane;
- `ci_qa` completion and the current exact PR identity make a candidate ready;
- a force-push, draft change, close, base retarget, or run revision change
  invalidates a mutable candidate and blocks an already-frozen cohort;
- collection stays open until five minutes after the latest ready candidate;
  reaching the five-PR limit freezes the cohort immediately;
- one transaction freezes at most five candidates with stable ordinals;
- enqueue uses GitHub GraphQL `expectedHeadOid` and `jump: false`, followed by
  an exact identity readback;
- signed `merge_group.checks_requested` deliveries are durable input, but
  arrival order is never authority;
- intermediate cumulative heads are ignored; the Worker selects only a signed
  final-tail SHA whose fully paginated queue entries exactly match the cohort;
- the exact queue ref and protected `main` ref are fetched into private refs,
  verified by SHA, and passed credential-free to the isolated executor;
- validation proof is stored before status publication, so a publication retry
  never reruns CI;
- statuses are posted to the claimed SHA as `signoff/app-worker`,
  `signoff/d1-migrations`, `signoff/rust`, and `signoff/security`;
- Briar never directly resumes member runs. The existing signed-PR path resumes
  them only after the batch itself is complete.

GitHub's Require merge queue rule and branch protection are the authoritative
`main` gate. The D1 lane serializes Briar delivery; it cannot prevent a GitHub
administrator from changing repository rules or using an explicit bypass.
Configure no bypass actors and restrict repository administration accordingly.

## Required GitHub policy

Before enabling a Briar profile, create one repository-level branch ruleset
that targets only `refs/heads/main` and verify all of the following:

- enforcement is active and there are no bypass actors;
- pull requests are required;
- deletion and non-fast-forward updates are blocked;
- merge queue is required with `HEADGREEN` grouping and `SQUASH` merge;
- `max_entries_to_build` and `max_entries_to_merge` are at least the Briar
  profile's maximum batch size (at most five);
- the four `signoff/*` contexts above are required;
- required status checks use `strict_required_status_checks_policy: false`.

Disabling strict branch updates is intentional. The merge queue builds a
cumulative commit against the current protected base, so individual pull
requests do not need to rerun the same CI merely because another pull request
merged first.

The Briar GitHub App needs Pull requests read, Merge queues read, and the Pull
request and Merge group webhook subscriptions. It remains read-only. The local
Worker's existing `gh` credential performs enqueue, queue readback, dequeue,
and exact-SHA status publication.

## Safe rollout

Do not activate the production ruleset as part of a code deployment or pull
request review. Roll out in this order during an explicit maintenance window:

1. Apply the Briar migrations with every merge-queue profile absent or
   disabled.
2. Publish an independently reproduced OCI executor digest and update both the
   audited manifest and compiled digest in one reviewed change. Until then the
   Worker refuses merge-batch claims.
3. Add the GitHub App permission and event subscription, then confirm signed
   Merge group deliveries reach Briar.
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
briar merge-queue configure --disable
briar merge-queue doctor --json
briar merge-queue configure --enable \
  --quiet-window-ms 300000 --max-batch-size 5
```

`doctor` is read-only. It validates the audited local runtime, local `gh`
authentication, immutable repository identity, effective exact-main active
rulesets, no bypass actors, `HEADGREEN`/`SQUASH` queue capacity, branch
protections, the exact four status contexts, and `strict=false`. It never
creates or edits GitHub rulesets.

The profile API is owner/admin-only:

```text
GET /projects/<project-id>/merge-queue-profile
PUT /projects/<project-id>/merge-queue-profile
{
  "enabled": false,
  "quietWindowMs": 300000,
  "maxBatchSize": 5
}
```

The server derives the immutable repository identity from the connected
project and GitHub installation. It does not accept a shell command, status
context list, repository ID, or base branch from the request.

## State and recovery

The normal lane is:

```text
collecting → frozen → enqueueing → waiting_tail
           → validating → publishing → awaiting_merge → completed
```

A deterministic CI failure publishes failure for the same cumulative SHA,
finishes all four durable status results even if GitHub removes the queue ref,
drains the original queue entries, and leaves the lane `blocked` for operator
review. Infrastructure failures release the fenced lease for retry;
they do not publish a false failure. A stale Worker cannot renew, record proof,
publish completion, or release a claim after its lease expires.

Never clear a blocked lane by editing D1 directly. First inspect the exact
cohort and GitHub queue, remove or repair its original entries, and rework the
member runs so new exact heads produce a new cohort.

For rollback, stop new profile claims first, drain or resolve the active cohort,
confirm the GitHub queue is empty, restore the previous protected-branch
policy, and only then disable the Require merge queue ruleset. The API refuses
to disable or retarget a profile while an active batch holds its lane.
