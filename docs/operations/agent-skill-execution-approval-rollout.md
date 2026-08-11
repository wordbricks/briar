# Conversational Agent Skill execution approval rollout

Migration `0092_agent_skill_execution_approvals.sql` adds the explicit approval
boundary for natural-language requests that match a saved Project Agent Skill.
Apply it before deploying the Worker that emits or accepts Skill execution
cards.

## Compatibility window

- Applying 0092 does not create a task or Agent session for an existing
  conversation. A new completed Agent reply and an authenticated member's
  explicit approval are both required.
- The Agent, Skill, request, provider, model, and effort are immutable server
  snapshots. Approval adds exactly one selected Worker; there is no automatic
  or `Any Worker` selection.
- Organization Agents cannot execute a Project Agent Skill directly. A card is
  emitted only by the delegated Project Agent reply, with the Organization
  Agent retained as provenance.
- Existing direct Project Agent tasks keep a null proposal linkage and continue
  through their current route. Conversational tasks have a non-null linkage and
  cannot be claimed without the matching immutable approval audit.
- After 0092, direct and conversational task completions record an immutable
  receipt keyed by project, task, exact Worker, and claim-token hash. The
  receipt and task transition are committed in one D1 batch. Replaying the same
  normalized summary, conversation ID, and error returns the canonical hot or
  R2-archived session; a different payload, token, or Worker conflicts.
- A linked task's terminal result and canonical Agent session are one database
  projection. A failed session projection rolls the task completion back so a
  Worker retry cannot leave the task terminal while the UI still shows it as
  running. An error receipt records either the retryable `queued` result or the
  terminal `failed` result, so one claim cannot consume an attempt twice. An
  exact replay of a successful legacy direct task repairs its canonical session
  from the stored task result when necessary.
- Hunt runs and Project Agent tasks share one device-wide concurrency budget
  across every project Worker binding on that device. The count is the sum of
  live-leased Hunt runs and running Agent tasks. Approval, task claim, and Hunt
  claim recheck capacity; a claim race returns HTTP 200 with `work: null` and
  does not consume a queued task attempt. Database triggers remain the final
  backstop.
- Removing or disabling the approved Agent, Skill, Worker, Worker device, or
  organization membership fails the linked task and session instead of moving
  the approval to another Worker. Transient liveness, readiness, or provider
  health changes remain claim-time eligibility checks and never change the
  approved Worker identity.
- Approved sessions are server-owned. Client session upserts cannot replace
  them, even after the linked task is removed, because ownership is resolved
  from the immutable approval audit. Idempotent approval retries validate the
  same canonical session from hot or archived storage.
- If 0092 has not been applied, new cards, proposals, and acceptance fail closed
  with 503. They must not fall back to the direct task endpoint. Existing direct
  task claim and completion continue without receipt replay, but completion
  still requires a running task, exact Worker, and live claim-token hash. A
  zero-row, wrong-token, or stale-token update returns 409 and never returns an
  existing session as a false success.

## Completion delivery

The CLI executes a provider turn once per live claim. After provider success it
keeps the lease-renewal loop active and retries only the identical completion
body when delivery fails through transport or non-HTTP errors, HTTP 408, HTTP
429, or HTTP 5xx. Retry delay starts at 250 ms, doubles to a maximum of five
seconds, and continues until acknowledgement or claim abort. A lost success
acknowledgement is never translated into a provider failure. If the provider
itself fails, only the corresponding error completion is retried under the same
rules. Other HTTP 4xx responses, including 409, are not retryable.

The receipt provides per-claim server-transition deduplication; it is not a
distributed exactly-once guarantee for external side effects after a CLI
process crash or lease loss. A side-effectful saved Skill must therefore use
its own provider-specific idempotency key or reconciliation procedure.

## Release sequence

1. Close the conversational approval gate and stop new conversation reply,
   approval, Project Agent task, and Hunt claims.
2. Drain in-flight conversation replies, approvals, task and Hunt completions,
   completion-delivery retries, lease-renewal loops, and scheduled archive or
   cleanup work.
3. Once D1 is quiescent, record a D1 Time Travel bookmark and the current Worker
   deployment ID as one recovery pair.
4. Deploy the Worker from the same verified SHA with
   `bun run worker:deploy`. The command applies all pending remote D1
   migrations first and aborts before deployment if migration fails.
5. While the gate remains closed to normal traffic, smoke-test all three
   origins:
   - a direct Project Agent channel request;
   - an Organization Agent request delegated to a Project Agent;
   - an issue conversation assigned to its Project Agent.
6. For every origin, verify that the natural-language match creates one pending
   card and creates no task, session, or audit before approval. Confirm that an
   unmatched request and an Organization Agent's own reply create no card.
7. Approve with one exact, available, policy-allowed Worker. Verify one linked
   queued task, one canonical session, and one immutable approval audit are
   committed together; then claim and complete that task on the selected
   Worker. Confirm the task result and terminal session are committed together,
   including summary, conversation identity, error, and terminal event. Drop
   the first completion response and retry the identical completion; verify the
   immutable receipt returns the same session and the provider invocation count
   remains one. Changing the result, claim token, or Worker must conflict. Also
   replay one retryable error and verify its claim consumes only one attempt.
8. Set a Worker device's maximum concurrency to one. Race two task claims and
   verify exactly one succeeds. Then verify a running task blocks a Hunt claim
   and a live-leased Hunt run blocks a task claim across project bindings. Every
   saturated claim must return HTTP 200 with `work: null`, leave task attempts
   unchanged, and succeed after capacity is released.
9. Retry approval with the same member and Worker and verify the existing
    session is returned. A different member or Worker must receive a conflict
    and must not create another task, session, or audit.
10. Before reopening the gate, verify pending cards are invalidated by relevant
   Agent, Skill, source message, issue assignment, channel archive, and channel
   roster changes. Verify a claimed conversational task is rejected when its
   approval audit, immutable linkage, or live saved Skill no longer matches.
11. Remove or disable each approved authority in a disposable fixture: Agent,
    Skill, exact Worker binding/device, Worker owner's organization membership,
    and an allowlist grant. Verify the linked task and session fail together,
    no other Worker can claim the task, and the accepted card keeps its original
    immutable Worker/Agent/Skill history.
12. Archive a completed approved session, repeat the same-member/same-Worker
    approval request, and verify the archived canonical session is returned.
    Attempt a normal client session upsert for the same ID and verify it is
    rejected as server-owned.

## Recovery

Do not repair a failed approval by inserting a task, session, or audit row by
hand, clearing its proposal linkage, changing its Worker, or returning an
invalidated card to pending. Keep the approval gate closed and prefer a forward
Worker or migration fix so the atomic acceptance statement remains the only
materialization boundary.

If full rollback is unavoidable:

1. Keep the gate closed, stop new CLI Workers and claims, and drain the new
   Worker's completion-delivery retries, lease-renewal loops, task and Hunt
   completions, and scheduled archive or cleanup work.
2. Preserve affected proposal, task, session, audit, completion-receipt, and R2
   archive object identifiers as incident evidence.
3. Restore the quiescent pre-0092 D1 Time Travel bookmark.
4. Only after D1 restore completes, deploy the matching previous Worker. Never
   run the previous Worker against the post-0092 database.
5. Inventory and reconcile R2 archive objects created after the bookmark. D1
   Time Travel does not restore or delete those objects, so remove confirmed
   orphans through the normal archive cleanup procedure rather than by an
   unscoped bulk deletion.
6. Repeat the no-preapproval-materialization, exact-Worker,
   wrong/stale-token, completion-replay, capacity, idempotency, delegation, and
   claim-audit smoke tests, then reopen the gate.
