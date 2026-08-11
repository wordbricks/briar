# Conversational issue execution approval rollout

Migration `0091_issue_execution_approvals.sql` adds the second, explicit
approval boundary for execution requested in issue and channel conversations.
It must be applied before deploying the Worker that accepts execution cards.

## Compatibility window

- A pre-0091 Worker can continue creating ordinary issue proposals. The new
  `execute_after_create` columns default to `0`, so old create-only output does
  not gain execution authority.
- A post-0091 Worker checks for the execution-approval tables before accepting
  or completing create-and-execute output. If the migration is missing, those
  routes return `503` and leave the reply job retryable. They never fall back to
  direct dispatch.
- Applying 0091 does not backfill, dispatch, reserve, or materialize execution
  proposals from existing messages or create proposals. A new Project Agent
  output and an authenticated member click are required.
- The server, not the client or Agent, generates the opaque dispatch request
  identity. A retry is valid only for the same member and the exact provider,
  model, effort, and Worker selection.

## Release sequence

1. Record a D1 Time Travel bookmark and the current Worker deployment ID.
2. Gate execution-proposal acceptance and drain in-flight Worker requests.
3. Deploy the Worker from the same verified SHA with
   `bun run worker:deploy`. The command applies all pending remote D1
   migrations first and aborts before deployment if migration fails.
4. Smoke-test both issue and channel conversations:
   - Agent output creates one pending execution card and leaves the run in
     `backlog`;
   - create-and-execute requires a create approval and then a separate
     execution approval;
   - execution approval exposes provider, model, effort, and Worker selection;
   - a retry returns the same accepted dispatch, while another member or
     different settings returns a conflict;
   - a legacy project Agent token cannot claim a Worker-dispatched run.
5. Verify one `dispatched` execution audit and one immutable approval audit for
   the opaque request ID before reopening the gate.

## Recovery

Do not roll the Worker back independently after 0091. Keep the gate closed and
prefer a forward fix. If a full rollback is unavoidable, drain the new Worker,
restore the paired pre-migration D1 bookmark, and deploy the matching previous
Worker as one recovery operation.

Agent, Worker, membership, roster, source, or target changes revoke pending
authority. Deleting an identity selected by a committed but still retryable
approval returns the run to a clean `backlog` and requires a new card. Never
repair these rows by copying a dispatch request ID or changing an invalidated
proposal back to pending; retain the tombstone and immutable audit for review.
