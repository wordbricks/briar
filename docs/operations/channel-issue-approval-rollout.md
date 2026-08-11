# Channel issue approval rollout

Migration `0090_channel_issue_approval.sql` and its Worker release are one
forward-only security boundary. The migration reserves both channel and issue-
conversation identities, reconciles legacy proposals, and rejects old create or
cross-project transfer shapes that could execute without the current project's
approval.

## Release gate

1. Finish the normal Worker build, migration tests, and signoff from the exact
   `main` SHA to deploy.
2. Record a D1 Time Travel bookmark and the current Worker deployment ID.
3. Before pausing writes, count non-terminal `briar-channel-proposal:*` and
   `briar-conversation-proposal:*` runs that no longer have a matching,
   finalized proposal. Migration 0090 quarantines unverifiable, duplicate, and
   unfinished legacy results even if they are queued or running; record their
   run IDs, status, owner, and recovery decision in the release evidence.
4. Enable a hard maintenance gate that rejects every approval write (including
   channel, issue-conversation, and execution approval), account/project/issue/
   channel deletion, and Slack uninstall. Disable the scheduled archive/cleanup
   invocation as part of the same gate. Existing claimed issue execution may
   continue, but no gated write or cleanup producer/consumer may enter an old
   Worker.
5. Wait for every old-Worker request and scheduled archive/cleanup invocation
   to fully drain. Record the gate activation time, old deployment request
   count, scheduled invocation state, and drain completion in release evidence.
   Abort the deployment unless both the gate and drain are verified; do not
   rely on the migration to make an overlapping old deletion or R2 cleanup safe.
6. Apply migrations with `bun run d1:migrate:remote`.
7. Immediately deploy the Worker from the same verified SHA with
   `bun run worker:deploy`.
8. While the maintenance gate remains closed to normal traffic, allow only the
   recorded release smoke identity and test all of the following: both proposal
   origins create a `backlog` issue with an opaque source key, a retry returns
   the same issue, an unapproved event/claim fails, and transferring a
   previously dispatched approval-created issue requires a fresh target-
   project execution approval.
9. Re-enable the gated approval/deletion routes and scheduled archive/cleanup
   only after the smoke tests pass and the new deployment ID is verified.

After step 6, the database guards make old approval writes fail closed. They do
not make an old account/project/issue/channel deletion, Slack uninstall, or R2
archive cleanup safe. That is why the hard gate and verified drain in steps
4–5 are mandatory. If evidence shows an overlapping old request or scheduled
invocation, keep the gate closed, stop the rollout, reconcile its effects, and
restart from a new bookmark. Gated requests are safe to retry only after the
compatible Worker is verified and the routes reopen in step 9.

## Rollback and recovery

Do not roll the Worker back by itself after migration 0090. An older binary is
incompatible with the new approval boundary and will fail approval writes; an
older transfer path is also rejected by the database.

- Prefer a forward Worker fix while keeping the migration in place.
- If rollback is unavoidable, restore the full step-4 maintenance gate, drain
  new-Worker requests and scheduled cleanup, record the affected time window,
  and restore the paired pre-migration D1 Time Travel bookmark before
  redeploying the matching previous Worker. Treat this as a data recovery event,
  because writes after the bookmark may need reconciliation.
- Never remove or weaken the approval guards as an availability workaround.
  Preserve failed request IDs and audit rows for incident review.
- For an orphan quarantined by 0090, do not revive the old predictable source
  identity. Reapprove the still-pending proposal so it receives a fresh
  `briar-channel-approved:*` or `briar-conversation-approved:*` identity, link
  the replacement run in the incident timeline, and retain the cancelled
  orphan as evidence.

- A quarantined transcript remains unreadable across both project scopes, but
  project/organization erasure is still allowed. Never rebind its ownership by
  hand; preserve the quarantine record until the containing data is erased or
  an audited remediation flow is available.

- Issue, channel, project, and account deletion capture every cascading R2 key
  and commit the D1 deletion in one D1 batch. Never restore the former
  read-then-delete or best-effort direct R2 path. Cleanup rechecks global
  metadata ownership immediately before deleting an object; if a transferred
  project or surviving channel still references the key, discard the stale
  cleanup item and preserve the object.
- Account deletion recomputes sole-member organization ownership inside that
  batch. `ACCOUNT_DELETION_STATE_CHANGED` means a member or owned resource
  changed after the preview; review the current organization state and retry
  instead of bypassing the guard.
- Slack credentials removed by account deletion or workspace uninstall are
  copied to `briar_slack_revocation_queue` in the same D1 batch as the local
  deletion. Revocation runs only after that commit and does not depend on the
  OAuth client or signing-secret configuration. Keep
  `SLACK_TOKEN_ENCRYPTION_KEY` available until the queue drains.
- Slack revocation starts with a five-minute exponential backoff, caps the
  delay at 24 hours, and dead-letters after the eighth failed call. The oldest
  due row runs first; a failure moves its due time forward so the next bounded
  batch can advance newer uninstalls without starving retries. The dead-letter
  transition emits one structured
  `Slack token revocation dead-lettered` error; alert on that message and
  inspect `attempts`, `last_attempt_at`, `last_error`, `dead_lettered_at`, and
  `dead_letter_reason` without exposing the encrypted credential.
- After correcting the Slack or encryption-key incident, manually replay a
  reviewed dead letter by resetting it to a fresh first attempt (substitute the
  reviewed queue ID and an ISO-8601 timestamp):

  ```sql
  update briar_slack_revocation_queue
  set attempts = 0,
      next_attempt_at = '2026-08-11T00:00:00.000Z',
      last_attempt_at = null,
      last_error = null,
      dead_lettered_at = null,
      dead_letter_reason = null
  where id = '<reviewed-queue-id>' and dead_lettered_at is not null;
  ```

  Record the incident and queue ID before replay; never copy token or IV values
  into logs or tickets.

After recovery, repeat the creation, idempotent retry, unapproved-claim, and
cross-project transfer smoke tests before reopening the gated routes and
scheduled cleanup.
