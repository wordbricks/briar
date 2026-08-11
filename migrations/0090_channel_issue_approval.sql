-- Persist the opaque issue identity at the same serialization point as the
-- member's approval. Retries must reuse this value even after a Worker restart
-- or configuration rotation; deriving it again could create a second issue.
alter table briar_channel_action_proposals
  add column issue_source_key text;

-- Conversation issue creation uses the same approval-before-side-effect
-- boundary as channel creation. The reservation records the authenticated
-- member before the deterministic result run is inserted; an INSERT trigger
-- below finalizes the proposal in that same SQLite statement.
alter table briar_issue_action_proposals
  add column approval_reserved_by_user_id text
    references "user" (id) on delete set null;

alter table briar_issue_action_proposals
  add column approval_reserved_at text;

alter table briar_issue_action_proposals
  add column issue_source_key text;

-- Approval guards and reconciliation resolve a source identity across project
-- boundaries. The table's uniqueness key starts with project_id, so add the
-- inverse lookup order to avoid a full run-table scan for each approval.
create index briar_hunt_runs_source_identity_project_idx
  on briar_hunt_runs (source, source_key, project_id);

create unique index briar_issue_action_proposals_issue_source_key_idx
  on briar_issue_action_proposals (issue_source_key)
  where issue_source_key is not null;

-- A pre-migration Worker could create the deterministic conversation result
-- and crash before its proposal compare-and-set. The predictable identity
-- cannot prove who created even a canonical-looking backlog row, so every
-- result without a later explicit dispatch audit is quarantined and replaced
-- through a fresh opaque reservation.
create table briar_conversation_issue_approval_quarantine (
  id text primary key not null,
  proposal_id text not null,
  result_run_id text not null,
  proposal_project_id text not null
    references briar_projects (id) on delete cascade,
  result_project_id text not null,
  reason text not null check (
    reason in (
      'unfinalized_legacy_issue', 'duplicate_legacy_issue',
      'unverifiable_legacy_result', 'orphaned_legacy_issue'
    )
  ),
  quarantined_at text not null,
  unique (proposal_id, result_run_id)
);

create index briar_conversation_issue_approval_quarantine_run_idx
  on briar_conversation_issue_approval_quarantine (result_run_id);

create unique index briar_channel_action_proposals_issue_source_key_idx
  on briar_channel_action_proposals (issue_source_key)
  where issue_source_key is not null;

-- A legacy accepted proposal used its public proposal id as the issue key, so
-- it cannot prove which caller won the old create-before-CAS race. Only work
-- with a durable explicit dispatch audit can be safely retained. Keep that
-- run's legacy identity so an in-flight old or new Worker can finish; database
-- guards below bind it to the audit. Never-dispatched results are quarantined
-- and their same proposal is reopened for explicit approval below.
update briar_channel_action_proposals
set project_id = (
      select run.project_id
      from briar_hunt_runs run
      where run.id = briar_channel_action_proposals.result_run_id
    ),
    issue_source_key = (
      select run.source_key
      from briar_hunt_runs run
      where run.id = briar_channel_action_proposals.result_run_id
    ),
    updated_at = coalesce(accepted_at, updated_at)
where status = 'accepted'
  and accepted_at is not null
  and result_run_id is not null
  and issue_source_key is null
  and not exists (
    select 1 from briar_channel_action_proposals duplicate
    where duplicate.id <> briar_channel_action_proposals.id
      and duplicate.result_run_id = briar_channel_action_proposals.result_run_id
  )
  and exists (
    select 1
    from briar_hunt_runs run
    join briar_projects project on project.id = run.project_id
    join briar_channels channel
      on channel.id = briar_channel_action_proposals.channel_id
     and channel.organization_id = project.organization_id
    where run.id = briar_channel_action_proposals.result_run_id
      and run.source = 'issue'
      and run.source_key =
        'briar-channel-proposal:' || briar_channel_action_proposals.id
      and exists (
        select 1 from briar_execution_audit_events execution
        where execution.organization_id = channel.organization_id
          and execution.run_id = run.id
          and execution.action in ('dispatched', 'reassigned')
          and execution.request_id is not null
          and execution.occurred_at >=
            briar_channel_action_proposals.accepted_at
      )
  );

-- Retain the exact legacy identity only long enough to verify the accepted
-- result against a durable execution approval below. Pending proposals receive
-- a fresh opaque identity when a member approves them again, so predictable
-- pre-migration artifacts cannot consume the new approval.
update briar_issue_action_proposals
set issue_source_key = (
      select run.source_key
      from briar_hunt_runs run
      where run.id = briar_issue_action_proposals.result_run_id
    )
where status = 'accepted'
  and action_type = 'request_issue_create'
  and accepted_at is not null
  and result_run_id is not null
  and issue_source_key is null
  and exists (
    select 1 from briar_hunt_runs run
    where run.id = briar_issue_action_proposals.result_run_id
      and run.source = 'issue'
      and run.source_key =
        'briar-conversation-proposal:' || briar_issue_action_proposals.id
  );

-- Approval evidence outlives mutable channel/proposal records, while explicit
-- user erasure anonymizes the actor and organization erasure removes its data.
create table briar_channel_issue_approval_audit (
  id text primary key not null,
  proposal_id text not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  channel_id text not null,
  project_id text,
  run_id text,
  approved_by_user_id text
    references "user" (id) on delete set null,
  approved_at text not null,
  issue_source_key text,
  result_verification text not null check (
    result_verification in (
      'atomic', 'legacy_authorized', 'missing', 'unverifiable'
    )
  ),
  payload_json text not null check (json_valid(payload_json)),
  created_at text not null
);

-- Backfill durable evidence for approvals completed by earlier Workers before
-- a later channel deletion can cascade away the proposal row.
insert into briar_channel_issue_approval_audit (
  id, proposal_id, organization_id, channel_id, project_id, run_id,
  approved_by_user_id, approved_at, issue_source_key, result_verification,
  payload_json, created_at
)
select proposal.id || ':legacy:' || coalesce(run.id, 'missing'),
       proposal.id, channel.organization_id, proposal.channel_id,
       proposal.project_id, run.id, proposal.accepted_by_user_id,
       proposal.accepted_at, run.source_key,
       iif(
         run.id is null,
         'missing',
         iif(
           proposal.issue_source_key is not null
          and run.source = 'issue'
          and run.source_key = proposal.issue_source_key
          and exists (
            select 1 from briar_projects project
            where project.id = run.project_id
              and project.organization_id = channel.organization_id
          )
          and exists (
            select 1 from briar_execution_audit_events execution
            where execution.organization_id = channel.organization_id
              and execution.run_id = run.id
              and execution.action in ('dispatched', 'reassigned')
              and execution.request_id is not null
              and execution.occurred_at >= proposal.accepted_at
          ),
          'legacy_authorized',
          'unverifiable'
         )
       ) as result_verification,
       proposal.payload_json,
       proposal.accepted_at
from briar_channel_action_proposals proposal
join briar_channels channel on channel.id = proposal.channel_id
left join briar_hunt_runs run on run.id = proposal.result_run_id
where proposal.status = 'accepted' and proposal.accepted_at is not null;

-- Conversation approvals share the same immutable run-identity ledger as
-- channel approvals. A synthetic channel id keeps the original schema
-- backward-compatible while the run/source identity drives every execution
-- and transfer guard below.
insert into briar_channel_issue_approval_audit (
  id, proposal_id, organization_id, channel_id, project_id, run_id,
  approved_by_user_id, approved_at, issue_source_key, result_verification,
  payload_json, created_at
)
select proposal.id || ':conversation-legacy:' || coalesce(run.id, 'missing'),
       proposal.id, proposal_project.organization_id,
       'conversation:' || proposal.conversation_run_id,
       proposal.project_id, run.id, proposal.accepted_by_user_id,
       proposal.accepted_at, run.source_key,
       iif(
         run.id is null,
         'missing',
         iif(
           proposal.issue_source_key is not null
          and run.source = 'issue'
          and run.source_key = proposal.issue_source_key
          and exists (
            select 1 from briar_projects result_project
            where result_project.id = run.project_id
              and result_project.organization_id =
                proposal_project.organization_id
          )
          and exists (
            select 1 from briar_execution_audit_events execution
            where execution.organization_id =
                  proposal_project.organization_id
              and execution.run_id = run.id
              and execution.project_id = run.project_id
              and execution.action in ('dispatched', 'reassigned')
              and execution.request_id is not null
              and execution.occurred_at >= proposal.accepted_at
          ),
          'legacy_authorized',
          'unverifiable'
         )
       ),
       proposal.payload_json, proposal.accepted_at
from briar_issue_action_proposals proposal
join briar_projects proposal_project on proposal_project.id = proposal.project_id
left join briar_hunt_runs run on run.id = proposal.result_run_id
where proposal.status = 'accepted'
  and proposal.action_type = 'request_issue_create'
  and proposal.accepted_at is not null;

create index briar_channel_issue_approval_audit_run_identity_idx
  on briar_channel_issue_approval_audit (run_id, issue_source_key);

create index briar_channel_issue_approval_audit_proposal_idx
  on briar_channel_issue_approval_audit (proposal_id, created_at);

-- Older Workers resolve preferred_* before requested_*. Normalize every
-- currently verified dispatch so an old claimant in the rolling-deploy window
-- observes the exact provider/model/effort that the member approved.
update briar_hunt_runs as run
set preferred_agent_provider = requested_agent_provider,
    preferred_agent_model = requested_agent_model,
    preferred_agent_effort = requested_agent_effort
where run.dispatch_request_id is not null
  and run.requested_agent_provider is not null
  and exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.run_id = run.id
      and approval.issue_source_key = run.source_key
      and approval.result_verification in ('atomic', 'legacy_authorized')
  )
  and exists (
    select 1 from briar_execution_audit_events execution
    where execution.run_id = run.id
      and execution.project_id = run.project_id
      and execution.request_id = run.dispatch_request_id
      and execution.action in ('dispatched', 'reassigned')
  );

-- Repair an executable channel issue that an older transfer path already moved
-- before this migration. Its only dispatch audit belongs to the source
-- project, so the target project has never approved execution. Revoke even an
-- overlapping or paused claim and return queued, running, blocked, and failed
-- work to backlog; a fresh target-project dispatch will create a new audit
-- before it can run.
update briar_hunt_runs as run
set status = 'backlog', stage = 'queued', workflow_stage = null,
    agent_id = null, worker_id = null, requested_worker_id = null,
    claim_token_hash = null, claimed_by = null, claimed_at = null,
    lease_expires_at = null, claim_attempts = 0, last_execution_id = null,
    dispatch_mode = null, dispatch_request_id = null, dispatched_at = null,
    requested_by_user_id = null, requested_agent_provider = null,
    requested_agent_model = null, requested_agent_effort = null,
    paused_at = null, resume_requested_at = null, completed_at = null,
    repository = coalesce(
      (select settings.github_repository
       from briar_project_settings settings
       where settings.project_id = run.project_id),
      (select project.name from briar_projects project
       where project.id = run.project_id)
    ),
    workflow_snapshot_json = coalesce(
      (select settings.workflow_json
       from briar_project_settings settings
       where settings.project_id = run.project_id),
      '{"version":2,"requirements":[],"stages":[{"id":"repository_workflow_pending","label":"Repository workflow pending","required":true}],"execution":{"checkpoints":[{"key":"project-after-repository_workflow_pending","stage":"repository_workflow_pending","position":"after"}]},"completion":{"requiredStages":["repository_workflow_pending"]}}'
    ),
    issue_checkpoints_json = '[]',
    updated_at = datetime('now')
where run.status in ('queued', 'running', 'blocked', 'failed')
  and exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.run_id = run.id
      and approval.issue_source_key = run.source_key
      and approval.result_verification = 'legacy_authorized'
  )
  and (
    run.dispatch_request_id is null
    or run.requested_by_user_id is null
    or run.requested_agent_provider is null
    or run.dispatched_at is null
    or run.dispatch_mode is null
    or run.dispatch_mode not in ('any', 'specific')
    or not exists (
      select 1 from briar_execution_audit_events execution
      where execution.run_id = run.id
        and execution.project_id = run.project_id
        and execution.request_id = run.dispatch_request_id
        and execution.action in ('dispatched', 'reassigned')
    )
  );

-- Record only mismatches with durable channel approval plus a dispatch audit
-- in the child's source project. Older transcript endpoints allowed a caller
-- to write an arbitrary foreign run id, so a project-id mismatch alone is not
-- transfer provenance and must never cause untrusted content to be promoted
-- into the run's current project.
create table briar_channel_issue_transfer_reconciliation (
  run_id text not null,
  source_project_id text not null,
  target_project_id text not null,
  detected_at text not null,
  primary key (run_id, source_project_id, target_project_id)
);

insert into briar_channel_issue_transfer_reconciliation (
  run_id, source_project_id, target_project_id, detected_at
)
select distinct run.id, execution.project_id, run.project_id, datetime('now')
from briar_hunt_runs run
join briar_channel_issue_approval_audit approval
  on approval.run_id = run.id
 and approval.issue_source_key = run.source_key
join briar_execution_audit_events execution
  on execution.run_id = run.id
 and execution.project_id <> run.project_id
 and execution.action in ('dispatched', 'reassigned')
 and execution.request_id is not null
where approval.result_verification in ('atomic', 'legacy_authorized');

-- A verified pre-migration transfer could crash after moving the run but
-- before moving project-scoped child rows. Reconcile those children to the
-- run's authoritative current project so source-project agents cannot read or
-- delete stale data. Historical execution audit rows intentionally retain
-- their original project as provenance and are not rewritten here.
update briar_issue_attachments as child
set project_id = (
  select run.project_id from briar_hunt_runs run where run.id = child.run_id
)
where exists (
  select 1
  from briar_hunt_runs run
  join briar_channel_issue_transfer_reconciliation transfer
    on transfer.run_id = run.id
   and transfer.source_project_id = child.project_id
   and transfer.target_project_id = run.project_id
  where run.id = child.run_id and run.project_id <> child.project_id
);

update briar_issue_messages as child
set project_id = (
  select run.project_id from briar_hunt_runs run where run.id = child.run_id
)
where exists (
  select 1
  from briar_hunt_runs run
  join briar_channel_issue_transfer_reconciliation transfer
    on transfer.run_id = run.id
   and transfer.source_project_id = child.project_id
   and transfer.target_project_id = run.project_id
  where run.id = child.run_id and run.project_id <> child.project_id
);

update briar_run_evidence as child
set project_id = (
  select run.project_id from briar_hunt_runs run where run.id = child.run_id
)
where exists (
  select 1
  from briar_hunt_runs run
  join briar_channel_issue_transfer_reconciliation transfer
    on transfer.run_id = run.id
   and transfer.source_project_id = child.project_id
   and transfer.target_project_id = run.project_id
  where run.id = child.run_id and run.project_id <> child.project_id
);

update briar_run_evidence_images as child
set project_id = (
  select run.project_id from briar_hunt_runs run where run.id = child.run_id
)
where exists (
  select 1
  from briar_hunt_runs run
  join briar_channel_issue_transfer_reconciliation transfer
    on transfer.run_id = run.id
   and transfer.source_project_id = child.project_id
   and transfer.target_project_id = run.project_id
  where run.id = child.run_id and run.project_id <> child.project_id
);

update briar_issue_agent_reply_jobs as child
set project_id = (
      select run.project_id from briar_hunt_runs run where run.id = child.run_id
    ),
    preferred_worker_id = null,
    claimed_worker_id = null
where exists (
  select 1
  from briar_hunt_runs run
  join briar_channel_issue_transfer_reconciliation transfer
    on transfer.run_id = run.id
   and transfer.source_project_id = child.project_id
   and transfer.target_project_id = run.project_id
  where run.id = child.run_id and run.project_id <> child.project_id
);

update briar_log_archives as child
set project_id = (
  select run.project_id from briar_hunt_runs run where run.id = child.run_id
)
where child.run_id is not null
  and child.archive_kind not in ('execution_audit', 'agent_transcript')
  and exists (
    select 1
    from briar_hunt_runs run
    join briar_channel_issue_transfer_reconciliation transfer
      on transfer.run_id = run.id
     and transfer.source_project_id = child.project_id
     and transfer.target_project_id = run.project_id
    where run.id = child.run_id and run.project_id <> child.project_id
  );

-- Cleanup workers may overlap scheduled invocations while deletion producers
-- refresh the same object key. A monotonic generation gives the worker a CAS
-- identity, while due/dead-letter fields keep permanent R2 failures from
-- starving newer privacy cleanup work.
alter table briar_archive_cleanup_queue
  add column generation integer not null default 1 check (generation >= 1);
alter table briar_archive_cleanup_queue add column next_attempt_at text;
alter table briar_archive_cleanup_queue add column dead_lettered_at text;
alter table briar_archive_cleanup_queue
  add column alert_state text not null default 'none'
    check (alert_state in ('none', 'pending', 'acknowledged'));
alter table briar_archive_cleanup_queue
  add column alert_detail_json text
    check (alert_detail_json is null or json_valid(alert_detail_json));

create index briar_archive_cleanup_queue_due_idx
  on briar_archive_cleanup_queue (
    dead_lettered_at, next_attempt_at, queued_at, bucket, object_key
  );

update briar_archive_cleanup_queue as child
set project_id = (
  select run.project_id from briar_hunt_runs run where run.id = child.run_id
), generation = generation + 1
where exists (
  select 1
  from briar_hunt_runs run
  join briar_channel_issue_transfer_reconciliation transfer
    on transfer.run_id = run.id
   and transfer.source_project_id = child.project_id
   and transfer.target_project_id = run.project_id
  where run.id = child.run_id and run.project_id <> child.project_id
);

update briar_run_pull_requests as child
set project_id = (
  select run.project_id from briar_hunt_runs run where run.id = child.run_id
)
where exists (
  select 1
  from briar_hunt_runs run
  join briar_channel_issue_transfer_reconciliation transfer
    on transfer.run_id = run.id
   and transfer.source_project_id = child.project_id
   and transfer.target_project_id = run.project_id
  where run.id = child.run_id and run.project_id <> child.project_id
);

-- Legacy transcript writes did not prove that run_id belonged to the caller's
-- project. Even a source dispatch audit therefore cannot distinguish a real
-- partial-transfer transcript from content injected after the run moved. Keep
-- every mismatch hidden by current-run read guards and record it for manual
-- review instead of promoting untrusted prompt content into the target.
create table briar_channel_issue_transfer_quarantine (
  entity_kind text not null check (
    entity_kind in ('agent_transcript_session', 'agent_transcript_archive')
  ),
  entity_id text not null,
  run_id text not null,
  source_project_id text not null,
  target_project_id text not null,
  reason text not null check (reason = 'unverified_transcript_ownership'),
  detected_at text not null,
  primary key (entity_kind, entity_id)
);

insert into briar_channel_issue_transfer_quarantine (
  entity_kind, entity_id, run_id, source_project_id, target_project_id,
  reason, detected_at
)
select 'agent_transcript_session', session.session_id, session.run_id,
       session.project_id, run.project_id, 'unverified_transcript_ownership',
       datetime('now')
from briar_agent_transcript_sessions session
join briar_hunt_runs run on run.id = session.run_id
where session.project_id <> run.project_id;

insert into briar_channel_issue_transfer_quarantine (
  entity_kind, entity_id, run_id, source_project_id, target_project_id,
  reason, detected_at
)
select 'agent_transcript_archive', archive.id, archive.run_id,
       archive.project_id, run.project_id, 'unverified_transcript_ownership',
       datetime('now')
from briar_log_archives archive
join briar_hunt_runs run on run.id = archive.run_id
where archive.archive_kind = 'agent_transcript'
  and archive.project_id <> run.project_id;

-- Old Workers still try to move every transcript relation during the rolling
-- window. Quarantine is fail-closed: only deletion or a future explicit,
-- audited remediation flow may change ownership of these ambiguous records.
create trigger briar_quarantined_transcript_session_project_guard
before update of project_id, run_id on briar_agent_transcript_sessions
when (new.project_id <> old.project_id or new.run_id is not old.run_id)
  and exists (
    select 1 from briar_channel_issue_transfer_quarantine quarantine
    where quarantine.entity_kind = 'agent_transcript_session'
      and quarantine.entity_id = old.session_id
  )
BEGIN
  select raise(abort, 'quarantined transcript ownership is immutable');
END;

create trigger briar_quarantined_transcript_archive_project_guard
before update of project_id on briar_log_archives
when new.project_id <> old.project_id
  and exists (
    select 1 from briar_channel_issue_transfer_quarantine quarantine
    where quarantine.entity_kind = 'agent_transcript_archive'
      and quarantine.entity_id = old.id
  )
BEGIN
  select raise(abort, 'quarantined transcript ownership is immutable');
END;

-- A rolling old archiver may select an already-mismatched session. Quarantine
-- the resulting manifest immediately, and never let archival purge erase the
-- source record that operators need to review.
create trigger briar_mismatched_transcript_archive_quarantine
after insert on briar_log_archives
when new.archive_kind = 'agent_transcript'
  and new.run_id is not null
  and exists (
    select 1 from briar_hunt_runs run
    where run.id = new.run_id and run.project_id <> new.project_id
  )
BEGIN
  insert into briar_channel_issue_transfer_quarantine (
    entity_kind, entity_id, run_id, source_project_id, target_project_id,
    reason, detected_at
  )
  select 'agent_transcript_archive', new.id, new.run_id, new.project_id,
         run.project_id, 'unverified_transcript_ownership', datetime('now')
  from briar_hunt_runs run where run.id = new.run_id
  on conflict (entity_kind, entity_id) do nothing;

  insert into briar_channel_issue_transfer_quarantine (
    entity_kind, entity_id, run_id, source_project_id, target_project_id,
    reason, detected_at
  )
  select 'agent_transcript_session', new.scope_id, new.run_id, new.project_id,
         run.project_id, 'unverified_transcript_ownership', datetime('now')
  from briar_hunt_runs run where run.id = new.run_id
  on conflict (entity_kind, entity_id) do nothing;

  update briar_log_archives
  set status = 'failed',
      failure_count = failure_count + 1,
      last_error = 'Transcript archive ownership requires remediation'
  where id = new.id and status in ('verified', 'complete');
END;

create trigger briar_mismatched_transcript_archive_verify_guard
before update of status on briar_log_archives
when new.archive_kind = 'agent_transcript'
  and new.status in ('verified', 'complete')
  and new.run_id is not null
  and exists (
    select 1 from briar_hunt_runs run
    where run.id = new.run_id and run.project_id <> new.project_id
  )
BEGIN
  select raise(abort, 'transcript archive ownership requires remediation');
END;

create trigger briar_mismatched_run_archive_insert_guard
before insert on briar_log_archives
when new.archive_kind not in ('execution_audit', 'agent_transcript')
  and new.run_id is not null
  and not exists (
    select 1 from briar_hunt_runs run
    where run.id = new.run_id and run.project_id = new.project_id
  )
BEGIN
  select raise(abort, 'run archive project does not match current run');
END;

create trigger briar_transcript_session_run_insert_guard
before insert on briar_agent_transcript_sessions
when new.run_id is not null
  and not exists (
    select 1 from briar_hunt_runs run
    where run.id = new.run_id and run.project_id = new.project_id
  )
BEGIN
  select raise(abort, 'transcript run does not belong to project');
END;

create trigger briar_transcript_session_run_update_guard
before update of run_id, project_id on briar_agent_transcript_sessions
when new.run_id is not null
  and not exists (
    select 1 from briar_hunt_runs run
    where run.id = new.run_id and run.project_id = new.project_id
  )
  and not exists (
    select 1 from briar_channel_issue_transfer_quarantine quarantine
    where quarantine.entity_kind = 'agent_transcript_session'
      and quarantine.entity_id = old.session_id
  )
BEGIN
  select raise(abort, 'transcript run does not belong to project');
END;

-- Never let a resumed old archive purge current-project rows through metadata
-- that still names a stale project. Verified, proven transfers were rebound
-- above; every remaining mismatch requires explicit remediation.
update briar_log_archives as archive
set status = 'failed',
    failure_count = failure_count + 1,
    last_error = 'Archive ownership changed before hot-row purge'
where archive.status = 'verified'
  and archive.archive_kind <> 'execution_audit'
  and archive.run_id is not null
  and not exists (
    select 1 from briar_hunt_runs run
    where run.id = archive.run_id and run.project_id = archive.project_id
  );

update briar_issue_rework_proposals as child
set project_id = (
      select run.project_id from briar_hunt_runs run where run.id = child.run_id
    ),
    updated_at = datetime('now')
where exists (
  select 1
  from briar_hunt_runs run
  join briar_channel_issue_transfer_reconciliation transfer
    on transfer.run_id = run.id
   and transfer.source_project_id = child.project_id
   and transfer.target_project_id = run.project_id
  where run.id = child.run_id and run.project_id <> child.project_id
);

update briar_issue_action_proposals as child
set project_id = (
      select run.project_id
      from briar_hunt_runs run where run.id = child.conversation_run_id
    ),
    updated_at = datetime('now')
where exists (
  select 1
  from briar_hunt_runs run
  join briar_channel_issue_transfer_reconciliation transfer
    on transfer.run_id = run.id
   and transfer.source_project_id = child.project_id
   and transfer.target_project_id = run.project_id
  where run.id = child.conversation_run_id
    and run.project_id <> child.project_id
);

insert into briar_conversation_issue_approval_quarantine (
  id, proposal_id, result_run_id, proposal_project_id, result_project_id,
  reason, quarantined_at
)
select result.id || ':conversation-quarantine',
       coalesce(
         proposal.id,
         substr(
           result.source_key,
           length('briar-conversation-proposal:') + 1
         )
       ),
       result.id, coalesce(proposal.project_id, result.project_id),
       result.project_id,
       iif(
         proposal.id is null,
         'orphaned_legacy_issue',
         iif(
           proposal.status = 'pending',
           'unfinalized_legacy_issue',
           iif(
             proposal.result_run_id <> result.id,
             'duplicate_legacy_issue',
             'unverifiable_legacy_result'
           )
         )
       ),
       datetime('now')
from briar_hunt_runs result
left join briar_issue_action_proposals proposal
  on result.source_key = 'briar-conversation-proposal:' || proposal.id
 and proposal.action_type = 'request_issue_create'
where result.source = 'issue'
  and result.source_key like 'briar-conversation-proposal:%'
  and not exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.run_id = result.id
      and approval.issue_source_key = result.source_key
      and approval.channel_id like 'conversation:%'
      and approval.result_verification = 'legacy_authorized'
  );
--> statement-breakpoint

delete from briar_issue_dependencies
where exists (
  select 1 from briar_channel_issue_transfer_reconciliation transfer
  where transfer.source_project_id = briar_issue_dependencies.project_id
    and transfer.run_id in (
      briar_issue_dependencies.prerequisite_run_id,
      briar_issue_dependencies.dependent_run_id
    )
)
and not exists (
  select 1
  from briar_hunt_runs prerequisite
  join briar_hunt_runs dependent
    on dependent.id = briar_issue_dependencies.dependent_run_id
  where prerequisite.id = briar_issue_dependencies.prerequisite_run_id
    and prerequisite.project_id = briar_issue_dependencies.project_id
    and dependent.project_id = briar_issue_dependencies.project_id
);

-- Publish source-project tombstones for repaired channel transfers. The
-- current project is authoritative; prior execution audit projects are the
-- durable provenance of dashboards that may still cache the moved issue.
insert into briar_dashboard_changes (
  project_id, entity_type, entity_id, operation, created_at
)
select distinct transfer.source_project_id, 'run', transfer.run_id,
       'delete', datetime('now')
from briar_channel_issue_transfer_reconciliation transfer
where not exists (
    select 1 from briar_dashboard_changes existing
    where existing.project_id = transfer.source_project_id
      and existing.entity_type = 'run'
      and existing.entity_id = transfer.run_id
      and existing.operation = 'delete'
  );

insert into briar_dashboard_sync_state (project_id, current_version)
select project_id, max(version)
from briar_dashboard_changes
group by project_id
on conflict (project_id) do update
set current_version = max(
  briar_dashboard_sync_state.current_version, excluded.current_version
);

-- Project deletion must not cascade through a child row whose project scope
-- no longer matches its authoritative run. The view is also used by the HTTP
-- preflight so R2 cleanup is never planned from stale ownership metadata.
create view briar_run_child_storage_a_project_mismatches as
select child.project_id as stale_project_id,
       run.project_id as current_project_id,
       run.id as run_id, 'issue_attachment' as entity_kind,
       child.id as entity_id
from briar_issue_attachments child
join briar_hunt_runs run on run.id = child.run_id
where child.project_id <> run.project_id
union all
select child.project_id, run.project_id, run.id, 'issue_message', child.id
from briar_issue_messages child
join briar_hunt_runs run on run.id = child.run_id
where child.project_id <> run.project_id
union all
select child.project_id, run.project_id, run.id, 'run_evidence', child.id
from briar_run_evidence child
join briar_hunt_runs run on run.id = child.run_id
where child.project_id <> run.project_id
union all
select child.project_id, run.project_id, run.id, 'run_evidence_image', child.id
from briar_run_evidence_images child
join briar_hunt_runs run on run.id = child.run_id
where child.project_id <> run.project_id;

create view briar_run_child_storage_b_project_mismatches as
select child.project_id as stale_project_id,
       run.project_id as current_project_id,
       run.id as run_id, 'issue_reply_job' as entity_kind,
       child.id as entity_id
from briar_issue_agent_reply_jobs child
join briar_hunt_runs run on run.id = child.run_id
where child.project_id <> run.project_id
union all
select child.project_id, run.project_id, run.id, 'log_archive', child.id
from briar_log_archives child
join briar_hunt_runs run on run.id = child.run_id
where child.archive_kind <> 'execution_audit'
  and child.project_id <> run.project_id
  and not exists (
    select 1 from briar_channel_issue_transfer_quarantine quarantine
    where quarantine.entity_kind = 'agent_transcript_archive'
      and quarantine.entity_id = child.id
  )
union all
select child.project_id, run.project_id, run.id, 'archive_cleanup',
       child.bucket || ':' || child.object_key
from briar_archive_cleanup_queue child
join briar_hunt_runs run on run.id = child.run_id
where child.run_id is not null and child.project_id <> run.project_id;

create view briar_run_child_relation_a_project_mismatches as
select child.project_id as stale_project_id,
       run.project_id as current_project_id,
       run.id as run_id, 'run_pull_request' as entity_kind,
       child.run_id || ':' || child.attempt || ':' || child.revision || ':' ||
       child.repository_id || ':' || child.pull_request_number as entity_id
from briar_run_pull_requests child
join briar_hunt_runs run on run.id = child.run_id
where child.project_id <> run.project_id
union all
select child.project_id, run.project_id, run.id, 'transcript_session',
       child.session_id
from briar_agent_transcript_sessions child
join briar_hunt_runs run on run.id = child.run_id
where child.run_id is not null and child.project_id <> run.project_id
  and not exists (
    select 1 from briar_channel_issue_transfer_quarantine quarantine
    where quarantine.entity_kind = 'agent_transcript_session'
      and quarantine.entity_id = child.session_id
  )
union all
select child.project_id, run.project_id, run.id, 'rework_proposal', child.id
from briar_issue_rework_proposals child
join briar_hunt_runs run on run.id = child.run_id
where child.project_id <> run.project_id
union all
select child.project_id, run.project_id, run.id, 'action_proposal', child.id
from briar_issue_action_proposals child
join briar_hunt_runs run on run.id = child.conversation_run_id
where child.project_id <> run.project_id;

create view briar_run_child_relation_b_project_mismatches as
select child.project_id as stale_project_id,
       run.project_id as current_project_id,
       run.id as run_id, 'dependency_prerequisite' as entity_kind,
       child.prerequisite_run_id || ':' || child.dependent_run_id
         as entity_id
from briar_issue_dependencies child
join briar_hunt_runs run on run.id = child.prerequisite_run_id
where child.project_id <> run.project_id
union all
select child.project_id, run.project_id, run.id, 'dependency_dependent',
       child.prerequisite_run_id || ':' || child.dependent_run_id
from briar_issue_dependencies child
join briar_hunt_runs run on run.id = child.dependent_run_id
where child.project_id <> run.project_id
union all
select child.project_id, run.project_id, run.id, 'channel_proposal', child.id
from briar_channel_action_proposals child
join briar_hunt_runs run on run.id = child.result_run_id
where child.status = 'accepted' and child.project_id is not null
  and child.project_id <> run.project_id;

create trigger briar_project_stranded_run_child_delete_guard
before delete on briar_projects
when exists (
  select 1 from briar_run_child_storage_a_project_mismatches mismatch
  where mismatch.stale_project_id = old.id
     or mismatch.current_project_id = old.id
)
or exists (
  select 1 from briar_run_child_storage_b_project_mismatches mismatch
  where mismatch.stale_project_id = old.id
     or mismatch.current_project_id = old.id
)
or exists (
  select 1 from briar_run_child_relation_a_project_mismatches mismatch
  where mismatch.stale_project_id = old.id
     or mismatch.current_project_id = old.id
)
or exists (
  select 1 from briar_run_child_relation_b_project_mismatches mismatch
  where mismatch.stale_project_id = old.id
     or mismatch.current_project_id = old.id
)
BEGIN
  select raise(abort, 'project has stranded transferred issue data');
END;

create trigger briar_channel_issue_approval_audit_immutable_update
before update on briar_channel_issue_approval_audit
when not (
  old.approved_by_user_id is not null
  and new.approved_by_user_id is null
  and new.id is old.id
  and new.proposal_id is old.proposal_id
  and new.organization_id is old.organization_id
  and new.channel_id is old.channel_id
  and new.project_id is old.project_id
  and new.run_id is old.run_id
  and new.approved_at is old.approved_at
  and new.issue_source_key is old.issue_source_key
  and new.result_verification is old.result_verification
  and new.payload_json is old.payload_json
  and new.created_at is old.created_at
)
BEGIN
  select raise(abort, 'channel issue approval audit is immutable');
END;

create trigger briar_channel_issue_proposal_payload_immutable
before update of action_type, payload_json on briar_channel_action_proposals
when new.action_type is not old.action_type
  or new.payload_json is not old.payload_json
BEGIN
  select raise(abort, 'channel issue proposal payload is immutable');
END;

create trigger briar_conversation_issue_proposal_payload_immutable
before update of action_type, payload_json on briar_issue_action_proposals
when new.action_type is not old.action_type
  or new.payload_json is not old.payload_json
BEGIN
  select raise(abort, 'conversation issue proposal payload is immutable');
END;

-- Detect and quarantine legacy create-before-CAS artifacts. Pending legacy
-- issues never reached an accepted proposal, and extra runs from a target race
-- are not the accepted result. Preserve a durable reconciliation record while
-- preventing an unverified, non-terminal artifact from executing. Historical
-- backlog data is safely rebound above; progressed work also needs a durable
-- explicit dispatch audit to remain live.
create table briar_channel_issue_approval_reconciliation (
  run_id text primary key not null,
  proposal_id text not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  channel_id text,
  reason text not null check (
    reason in (
      'unfinalized_legacy_issue', 'duplicate_legacy_issue',
      'unverifiable_legacy_result', 'orphaned_legacy_issue'
    )
  ),
  detected_at text not null
);

insert into briar_channel_issue_approval_reconciliation (
  run_id, proposal_id, organization_id, channel_id, reason, detected_at
)
select run.id, proposal.id, channel.organization_id, proposal.channel_id,
       iif(
         proposal.status = 'pending',
         'unfinalized_legacy_issue',
         'duplicate_legacy_issue'
       ) as reason,
       datetime('now')
from briar_channel_action_proposals proposal
join briar_channels channel on channel.id = proposal.channel_id
join briar_hunt_runs run
  on run.source = 'issue'
 and run.source_key = 'briar-channel-proposal:' || proposal.id
where proposal.status = 'pending'
   or proposal.result_run_id is null
   or proposal.result_run_id <> run.id;

insert into briar_channel_issue_approval_reconciliation (
  run_id, proposal_id, organization_id, channel_id, reason, detected_at
)
select run.id, proposal.id, channel.organization_id, proposal.channel_id,
       'unverifiable_legacy_result', datetime('now')
from briar_channel_action_proposals proposal
join briar_channels channel on channel.id = proposal.channel_id
join briar_hunt_runs run on run.id = proposal.result_run_id
join briar_channel_issue_approval_audit approval
  on approval.proposal_id = proposal.id
 and approval.run_id = run.id
where proposal.status = 'accepted'
  and approval.result_verification = 'unverifiable'
on conflict (run_id) do nothing;

-- A channel or proposal could have been deleted after an old Worker created
-- its predictable run but before acceptance was durably finalized. The
-- reserved source namespace proves this was channel work, yet no approval can
-- be reconstructed. Preserve a reconciliation record and quarantine it below.
insert into briar_channel_issue_approval_reconciliation (
  run_id, proposal_id, organization_id, channel_id, reason, detected_at
)
select run.id,
       substr(run.source_key, length('briar-channel-proposal:') + 1),
       project.organization_id, null, 'orphaned_legacy_issue', datetime('now')
from briar_hunt_runs run
join briar_projects project on project.id = run.project_id
where run.source = 'issue'
  and run.source_key like 'briar-channel-proposal:%'
  and not exists (
    select 1 from briar_channel_action_proposals proposal
    where run.source_key = 'briar-channel-proposal:' || proposal.id
  )
on conflict (run_id) do nothing;

insert into briar_channel_issue_approval_reconciliation (
  run_id, proposal_id, organization_id, channel_id, reason, detected_at
)
select quarantine.result_run_id, quarantine.proposal_id,
       project.organization_id, null, quarantine.reason,
       quarantine.quarantined_at
from briar_conversation_issue_approval_quarantine quarantine
join briar_projects project on project.id = quarantine.result_project_id
on conflict (run_id) do nothing;

update briar_hunt_runs
set stage = 'cancelled', status = 'cancelled', workflow_stage = null,
    detail = 'Quarantined during channel approval reconciliation',
    completed_at = coalesce(completed_at, datetime('now')),
    claim_token_hash = null, claimed_by = null, claimed_at = null,
    lease_expires_at = null, agent_id = null, worker_id = null,
    requested_worker_id = null, dispatch_mode = null,
    dispatch_request_id = null, dispatched_at = null,
    updated_at = datetime('now')
where id in (
  select run_id from briar_channel_issue_approval_reconciliation
)
and status not in ('completed', 'cancelled');

-- Keep the immutable legacy audit and quarantined run, but reopen the same
-- proposal so the member can explicitly approve a fresh opaque backlog issue.
-- The later atomic audit uses a separate id and therefore records both acts.
update briar_channel_action_proposals
set status = 'pending', accepted_by_user_id = null, accepted_at = null,
    result_run_id = null, issue_source_key = null, updated_at = datetime('now')
where action_type = 'request_issue_create'
  and exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.proposal_id = briar_channel_action_proposals.id
      and approval.result_verification in ('missing', 'unverifiable')
  );

update briar_issue_action_proposals
set status = 'pending', accepted_by_user_id = null, accepted_at = null,
    approval_reserved_by_user_id = null, approval_reserved_at = null,
    result_run_id = null, issue_source_key = null, updated_at = datetime('now')
where action_type = 'request_issue_create'
  and exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.proposal_id = briar_issue_action_proposals.id
      and approval.channel_id =
        'conversation:' || briar_issue_action_proposals.conversation_run_id
      and approval.result_verification in ('missing', 'unverifiable')
  );

-- 0075 dropped proposal change-feed triggers while rebuilding the table. Emit
-- migration upserts explicitly so already-connected clients observe both
-- legacy rebounds and proposals reopened for approval.
insert into briar_channel_changes (
  organization_id, channel_id, entity_type, entity_id, operation, created_at
)
select channel.organization_id, proposal.channel_id, 'proposal', proposal.id,
       'upsert', datetime('now')
from briar_channel_action_proposals proposal
join briar_channels channel on channel.id = proposal.channel_id
where exists (
  select 1 from briar_channel_issue_approval_audit approval
  where approval.proposal_id = proposal.id
);

insert into briar_channel_sync_state (organization_id, current_version)
select organization_id, max(version)
from briar_channel_changes
group by organization_id
on conflict (organization_id) do update
set current_version = max(
  briar_channel_sync_state.current_version, excluded.current_version
);

-- Reconciled artifacts are permanently quarantined. A rolling old Worker can
-- still address their predictable source key, so reject both its event insert
-- and any attempt to change the terminal status retained for audit.
create trigger briar_channel_reconciled_run_event_guard
before insert on briar_hunt_events
when exists (
  select 1 from briar_channel_issue_approval_reconciliation finding
  where finding.run_id = new.run_id
)
BEGIN
  select raise(abort, 'reconciled channel proposal issue is quarantined');
END;

create trigger briar_channel_reconciled_run_status_guard
before update of status on briar_hunt_runs
when new.status <> old.status
  and exists (
    select 1 from briar_channel_issue_approval_reconciliation finding
    where finding.run_id = old.id
  )
BEGIN
  select raise(abort, 'reconciled channel proposal issue is quarantined');
END;

-- Old Workers accepted source/sourceKey events without a run id. Once an
-- approved issue exists, block those events while it is still backlog. The
-- normal dispatch path updates the run directly, after which claimed Worker
-- events start from queued/running and remain unaffected.
create trigger briar_channel_approved_backlog_event_guard
before insert on briar_hunt_events
when new.status not in ('backlog', 'cancelled')
  and exists (
    select 1
    from briar_hunt_runs run
    join briar_channel_issue_approval_audit approval
      on approval.run_id = run.id
     and approval.issue_source_key = run.source_key
    where run.id = new.run_id
      and run.source = 'issue'
      and run.status in ('backlog', 'cancelled')
      and approval.result_verification in ('atomic', 'legacy_authorized')
  )
BEGIN
  select raise(
    abort, 'channel-approved issue execution requires explicit dispatch'
  );
END;

-- A backlog event with the same status could otherwise rewrite context and
-- later turn a transfer into a full-auto workflow. Channel issue edits and
-- transfers do not mutate context, so freeze it until explicit dispatch.
create trigger briar_channel_approved_backlog_context_guard
before update of context_json on briar_hunt_runs
when old.status in ('backlog', 'cancelled')
  and new.context_json is not old.context_json
  and exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.run_id = old.id
      and approval.issue_source_key = old.source_key
      and approval.result_verification in ('atomic', 'legacy_authorized')
  )
BEGIN
  select raise(
    abort, 'channel-approved issue context is immutable before dispatch'
  );
END;

-- Pending proposals move atomically with their conversation. If an accept
-- request loaded the old source project just before that transfer, its issue
-- INSERT must still prove that the pending proposal and conversation are
-- current in the destination it is about to mutate. Update/rework accepts
-- already carry equivalent project predicates on their atomic DB writes.
create trigger briar_conversation_issue_creation_project_guard
before insert on briar_hunt_runs
when new.source = 'issue'
  and (
    new.source_key like 'briar-conversation-approved:%'
    or new.source_key like 'briar-conversation-proposal:%'
  )
  and not exists (
    select 1 from briar_hunt_runs existing
    where existing.project_id = new.project_id
      and existing.source = new.source
      and existing.source_key = new.source_key
  )
  and (
    new.status <> 'backlog'
    or new.stage <> 'queued'
    or new.workflow_stage is not null
    or new.worker_id is not null
    or new.agent_id is not null
    or new.requested_worker_id is not null
    or new.claim_token_hash is not null
    or new.claimed_by is not null
    or new.claimed_at is not null
    or new.lease_expires_at is not null
    or new.last_execution_id is not null
    or new.dispatch_mode is not null
    or new.dispatch_request_id is not null
    or new.dispatched_at is not null
    or new.requested_by_user_id is not null
    or new.requested_agent_provider is not null
    or new.requested_agent_model is not null
    or new.requested_agent_effort is not null
    or new.completed_at is not null
    or new.paused_at is not null
    or new.resume_requested_at is not null
    or not exists (
      select 1
      from briar_issue_action_proposals proposal
      join briar_hunt_runs conversation
        on conversation.id = proposal.conversation_run_id
       and conversation.project_id = proposal.project_id
      where proposal.status = 'pending'
        and proposal.action_type = 'request_issue_create'
        and proposal.project_id = new.project_id
        and proposal.approval_reserved_by_user_id is not null
        and proposal.approval_reserved_at is not null
        and proposal.issue_source_key = new.source_key
        and new.title = json_extract(proposal.payload_json, '$.issue.title')
        and new.issue_description is
          json_extract(proposal.payload_json, '$.issue.description')
        and new.priority is
          json_extract(proposal.payload_json, '$.issue.priority')
        and new.issue_checkpoints_json = '[]'
        and new.preferred_agent_provider is null
        and new.preferred_agent_model is null
        and new.preferred_agent_effort is null
        and json_extract(new.context_json, '$.origin') =
          'briar-conversation'
        and json_extract(new.context_json, '$.proposalId') = proposal.id
        and json_extract(new.context_json, '$.conversationRunId') =
          proposal.conversation_run_id
        and json_extract(new.context_json, '$.fullAuto') = 0
    )
    or exists (
      select 1 from briar_hunt_runs existing
      where existing.source = new.source
        and existing.source_key = new.source_key
        and existing.project_id <> new.project_id
    )
  )
BEGIN
  select raise(abort, 'conversation proposal no longer belongs to project');
END;

create trigger briar_conversation_issue_creation_finalize
after insert on briar_hunt_runs
when new.source = 'issue'
  and new.source_key like 'briar-conversation-approved:%'
BEGIN
  update briar_issue_action_proposals
  set status = 'accepted',
      accepted_by_user_id = approval_reserved_by_user_id,
      accepted_at = approval_reserved_at,
      result_run_id = new.id,
      updated_at = approval_reserved_at
  where status = 'pending'
    and action_type = 'request_issue_create'
    and project_id = new.project_id
    and approval_reserved_by_user_id is not null
    and approval_reserved_at is not null
    and issue_source_key = new.source_key;
END;

-- Finalization is valid only for the reservation tuple and an untouched
-- deterministic backlog result. This rejects a delayed old-Worker CAS after
-- the migration and direct writes that bypass the approval route.
create trigger briar_conversation_issue_creation_finalize_guard
before update of status on briar_issue_action_proposals
when old.status = 'pending'
  and new.status = 'accepted'
  and old.action_type = 'request_issue_create'
  and not (
    old.approval_reserved_by_user_id is not null
    and old.approval_reserved_at is not null
    and old.issue_source_key is not null
    and new.approval_reserved_by_user_id is
      old.approval_reserved_by_user_id
    and new.approval_reserved_at is old.approval_reserved_at
    and new.issue_source_key is old.issue_source_key
    and new.accepted_by_user_id is old.approval_reserved_by_user_id
    and new.accepted_at = old.approval_reserved_at
    and new.result_run_id is not null
    and exists (
      select 1
      from briar_hunt_runs conversation
      where conversation.id = old.conversation_run_id
        and conversation.project_id = old.project_id
    )
    and exists (
      select 1
      from briar_hunt_runs result
      where result.id = new.result_run_id
        and result.project_id = old.project_id
        and result.source = 'issue'
        and result.source_key = old.issue_source_key
        and result.status = 'backlog' and result.stage = 'queued'
        and result.workflow_stage is null
        and result.worker_id is null
        and result.agent_id is null
        and result.requested_worker_id is null
        and result.claim_token_hash is null
        and result.claimed_by is null and result.claimed_at is null
        and result.lease_expires_at is null
        and result.last_execution_id is null
        and result.dispatch_mode is null
        and result.dispatch_request_id is null
        and result.dispatched_at is null
        and result.requested_by_user_id is null
        and result.requested_agent_provider is null
        and result.requested_agent_model is null
        and result.requested_agent_effort is null
        and result.completed_at is null
        and result.paused_at is null
        and result.resume_requested_at is null
    )
  )
BEGIN
  select raise(abort, 'conversation proposal acceptance requires reservation');
END;

create trigger briar_conversation_issue_reservation_immutable
before update of approval_reserved_by_user_id, approval_reserved_at,
                 issue_source_key
on briar_issue_action_proposals
when old.action_type = 'request_issue_create'
  and old.issue_source_key is not null
  and not (
    new.issue_source_key is old.issue_source_key
    and (
      (
        new.approval_reserved_at is old.approval_reserved_at
        and (
          new.approval_reserved_by_user_id is
            old.approval_reserved_by_user_id
          or (
            old.approval_reserved_by_user_id is not null
            and new.approval_reserved_by_user_id is null
          )
        )
      )
      or (
        old.approval_reserved_by_user_id is null
        and new.approval_reserved_by_user_id is not null
        and new.approval_reserved_at is not null
      )
    )
  )
BEGIN
  select raise(abort, 'conversation proposal reservation is immutable');
END;

create trigger briar_conversation_issue_approval_audit_insert
after update of status on briar_issue_action_proposals
when old.status = 'pending'
  and new.status = 'accepted'
  and old.action_type = 'request_issue_create'
BEGIN
  insert into briar_channel_issue_approval_audit (
    id, proposal_id, organization_id, channel_id, project_id, run_id,
    approved_by_user_id, approved_at, issue_source_key, result_verification,
    payload_json, created_at
  )
  select old.id || ':conversation-approval:' || new.result_run_id,
         old.id, project.organization_id,
         'conversation:' || old.conversation_run_id,
         old.project_id, new.result_run_id, new.accepted_by_user_id,
         new.accepted_at, old.issue_source_key, 'atomic', old.payload_json,
         new.accepted_at
  from briar_projects project where project.id = old.project_id
  on conflict (id) do nothing;
END;

-- A reserved acceptance and a legacy create-before-CAS result are short-lived
-- authorization state. Freeze both the conversation and result ownership (and
-- deletion) until atomic finalization has made the proposal immutable.
create trigger briar_conversation_issue_acceptance_transfer_guard
before update of project_id on briar_hunt_runs
when new.project_id <> old.project_id
  and exists (
    select 1 from briar_issue_action_proposals proposal
    where proposal.status = 'pending'
      and proposal.action_type = 'request_issue_create'
      and (
        (
          proposal.conversation_run_id = old.id
          and proposal.approval_reserved_by_user_id is not null
        )
        or (
          old.source = 'issue'
          and proposal.issue_source_key is not null
          and old.source_key = proposal.issue_source_key
        )
      )
  )
BEGIN
  select raise(abort, 'conversation proposal acceptance in progress');
END;

-- A verified archive is between durable R2 upload and hot-row purge. Freeze
-- run ownership for that short window so the archive cannot purge rows after
-- they have moved to another project. Execution-audit archives are scoped to
-- their immutable audit project and do not own the run.
create trigger briar_verified_run_archive_transfer_guard
before update of project_id on briar_hunt_runs
when new.project_id <> old.project_id
  and exists (
    select 1 from briar_log_archives archive
    where archive.run_id = old.id and archive.status = 'verified'
      and archive.archive_kind <> 'execution_audit'
  )
BEGIN
  select raise(abort, 'verified run archive prevents transfer');
END;

-- A Worker from before this migration could clear dispatch identity while
-- moving a queued, blocked, or failed issue, then leave it retryable in the
-- target project. That old transfer shape would let target-project execution
-- reuse the source project's approval. During a rolling deploy, only the new
-- fail-closed shape may cross projects: it must return to backlog with every
-- dispatch and claim identity cleared so the target project has to approve
-- execution again.
create trigger briar_channel_approved_retryable_transfer_guard
before update of project_id, status on briar_hunt_runs
when old.status in ('queued', 'blocked', 'failed')
  and new.project_id <> old.project_id
  and exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.run_id = old.id
      and approval.issue_source_key = old.source_key
      and approval.result_verification in ('atomic', 'legacy_authorized')
  )
  and not (
    new.status = 'backlog'
    and new.stage = 'queued'
    and new.workflow_stage is null
    and new.agent_id is null
    and new.worker_id is null
    and new.requested_worker_id is null
    and new.claim_token_hash is null
    and new.claimed_by is null
    and new.claimed_at is null
    and new.lease_expires_at is null
    and new.last_execution_id is null
    and new.dispatch_mode is null
    and new.dispatch_request_id is null
    and new.dispatched_at is null
    and new.requested_by_user_id is null
    and new.requested_agent_provider is null
    and new.requested_agent_model is null
    and new.requested_agent_effort is null
    and new.paused_at is null
    and new.resume_requested_at is null
    and new.completed_at is null
  )
BEGIN
  select raise(
    abort, 'channel-approved retryable transfer requires execution reset'
  );
END;

-- A terminal channel result must not be moved into a project that never
-- approved its execution. Keeping the result terminal is insufficient because
-- completed work can later be reworked. New Workers reject this transfer in
-- application code; this guard also stops an older Worker during rollout.
create trigger briar_channel_approved_terminal_transfer_guard
before update of project_id on briar_hunt_runs
when old.status in ('completed', 'cancelled')
  and new.project_id <> old.project_id
  and exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.run_id = old.id
      and approval.issue_source_key = old.source_key
      and approval.result_verification in ('atomic', 'legacy_authorized')
  )
BEGIN
  select raise(
    abort, 'channel-approved terminal issue transfer is not allowed'
  );
END;

-- An approved dispatch authorizes one execution lifecycle. Once that lifecycle
-- is terminal, its retained request/provider/model/effort snapshot is historical
-- evidence rather than authority for another execution. A future explicit
-- execution-approval flow must establish a fresh snapshot before this
-- fail-closed guard can be deliberately replaced.
create trigger briar_channel_approved_terminal_reactivation_guard
before update of status on briar_hunt_runs
when old.status in ('completed', 'cancelled')
  and new.status not in ('completed', 'cancelled')
  and exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.run_id = old.id
      and approval.issue_source_key = old.source_key
      and approval.result_verification in ('atomic', 'legacy_authorized')
  )
BEGIN
  select raise(
    abort, 'approved issue terminal reactivation requires fresh execution approval'
  );
END;

-- Cancelling a Worker assignment clears the dispatch identity. A Worker from
-- before this migration left the run queued, which let an agent-token claim it
-- again without a fresh member approval. New Workers return verified channel
-- work to backlog; reject every older executable clear shape during rollout.
create trigger briar_channel_approved_dispatch_clear_guard
before update of dispatch_request_id, status on briar_hunt_runs
when old.dispatch_request_id is not null
  and new.dispatch_request_id is null
  and new.status not in ('backlog', 'completed', 'cancelled')
  and exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.run_id = old.id
      and approval.issue_source_key = old.source_key
      and approval.result_verification in ('atomic', 'legacy_authorized')
  )
BEGIN
  select raise(
    abort, 'channel-approved dispatch cancellation requires backlog reset'
  );
END;

-- Dispatch always carries an immutable requested_* snapshot. Mirror it into
-- preferred_* for channel issues so a Worker from before this migration also
-- resolves the approved values. This intentionally applies even when the new
-- dispatcher did not ask to persist defaults; preferred_* cannot be a second,
-- mutable execution authority for an already-dispatched channel run.
create trigger briar_channel_approved_dispatch_preference_snapshot
after update of dispatch_request_id on briar_hunt_runs
when new.dispatch_request_id is not null
  and new.dispatch_request_id is not old.dispatch_request_id
  and new.requested_agent_provider is not null
  and exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.run_id = new.id
      and approval.issue_source_key = new.source_key
      and approval.result_verification in ('atomic', 'legacy_authorized')
  )
BEGIN
  update briar_hunt_runs
  set preferred_agent_provider = new.requested_agent_provider,
      preferred_agent_model = new.requested_agent_model,
      preferred_agent_effort = new.requested_agent_effort
  where id = new.id;
END;

-- Once a verified dispatch exists, preference edits may either be a no-op,
-- converge to that same requested snapshot, or arrive as part of an exact new
-- dispatch/reassign. Any other change could substitute execution settings for
-- a rolling old Worker and therefore fails closed at the database boundary.
create trigger briar_channel_approved_dispatch_preference_guard
before update of preferred_agent_provider, preferred_agent_model,
  preferred_agent_effort on briar_hunt_runs
when old.dispatch_request_id is not null
  and exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.run_id = old.id
      and approval.issue_source_key = old.source_key
      and approval.result_verification in ('atomic', 'legacy_authorized')
  )
  and not (
    new.preferred_agent_provider is old.preferred_agent_provider
    and new.preferred_agent_model is old.preferred_agent_model
    and new.preferred_agent_effort is old.preferred_agent_effort
  )
  and not (
    new.dispatch_request_id is old.dispatch_request_id
    and new.requested_agent_provider is old.requested_agent_provider
    and new.requested_agent_model is old.requested_agent_model
    and new.requested_agent_effort is old.requested_agent_effort
    and new.preferred_agent_provider is old.requested_agent_provider
    and new.preferred_agent_model is old.requested_agent_model
    and new.preferred_agent_effort is old.requested_agent_effort
  )
  and not (
    new.project_id is old.project_id
    and new.source is old.source
    and new.source_key is old.source_key
    and new.dispatch_request_id is not null
    and new.dispatch_request_id is not old.dispatch_request_id
    and new.dispatched_at is not null
    and new.requested_by_user_id is not null
    and new.requested_agent_provider is not null
    and new.status = 'queued'
    and new.stage = 'queued'
    and new.workflow_stage is null
    and new.dispatch_mode in ('any', 'specific')
    and (
      (new.dispatch_mode = 'any' and new.requested_worker_id is null)
      or
      (new.dispatch_mode = 'specific' and new.requested_worker_id is not null)
    )
    and new.worker_id is null
    and new.claim_token_hash is null
    and new.claimed_by is null
    and new.claimed_at is null
    and new.lease_expires_at is null
    and new.preferred_agent_provider is new.requested_agent_provider
    and new.preferred_agent_model is new.requested_agent_model
    and new.preferred_agent_effort is new.requested_agent_effort
  )
BEGIN
  select raise(
    abort, 'approved channel issue dispatch preferences are immutable'
  );
END;

-- Defend the run row itself as a second boundary. A backlog may only enter the
-- queue through the exact fresh shape written by dispatchHuntRun, which is the
-- endpoint that collects provider/model/effort and explicit user approval.
create trigger briar_channel_approved_backlog_status_guard
before update of status on briar_hunt_runs
when old.status in ('backlog', 'cancelled')
  and new.status not in ('backlog', 'cancelled')
  and exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.run_id = old.id
      and approval.issue_source_key = old.source_key
      and approval.result_verification in ('atomic', 'legacy_authorized')
  )
  and not (
    old.status = 'backlog'
    and new.source = old.source
    and new.source_key = old.source_key
    and new.project_id = old.project_id
    and new.status = 'queued'
    and new.stage = 'queued'
    and new.workflow_stage is null
    and new.requested_by_user_id is not null
    and new.requested_agent_provider is not null
    and new.dispatch_request_id is not null
    and new.dispatch_request_id is not old.dispatch_request_id
    and new.dispatched_at is not null
    and new.last_event_at = new.dispatched_at
    and new.updated_at = new.dispatched_at
    and new.dispatch_mode in ('any', 'specific')
    and (
      (
        new.dispatch_mode = 'any'
        and new.requested_worker_id is null
      )
      or (
        new.dispatch_mode = 'specific'
        and new.requested_worker_id is not null
      )
    )
    and new.worker_id is null
    and new.claim_token_hash is null
    and new.claimed_by is null
    and new.claimed_at is null
    and new.lease_expires_at is null
    and new.completed_at is null
    and new.paused_at is null
  )
BEGIN
  select raise(
    abort, 'channel-approved issue execution requires explicit dispatch'
  );
END;

-- Every valid post-migration acceptance is performed by the run INSERT trigger
-- after it has written the matching atomic audit. This also rejects a delayed
-- old CAS that resumes after the new route persisted an opaque reservation.
create trigger briar_channel_legacy_issue_approval_finalize_guard
before update of status on briar_channel_action_proposals
when old.status = 'pending' and new.status = 'accepted'
  and old.action_type = 'request_issue_create'
  and not exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.proposal_id = old.id
      and approval.result_verification = 'atomic'
      and approval.run_id = new.result_run_id
      and approval.project_id = new.project_id
      and approval.issue_source_key = new.issue_source_key
      and approval.approved_by_user_id is new.accepted_by_user_id
      and approval.approved_at = new.accepted_at
  )
BEGIN
  select raise(abort, 'legacy channel proposal acceptance is disabled');
END;

-- Channel proposal IDs are organization-wide action identities. Older Workers
-- created the issue before their pending -> accepted compare-and-set, so two
-- concurrent approvals could otherwise materialize the same proposal in two
-- projects. Preserve normal per-project idempotency while rejecting a second
-- cross-project materialization at the database boundary.
drop trigger if exists briar_hunt_runs_channel_proposal_project_guard;
create trigger briar_hunt_runs_channel_proposal_project_guard
before insert on briar_hunt_runs
when new.source = 'issue'
  and (
    new.source_key like 'briar-channel-approved:%'
    or new.source_key like 'briar-channel-proposal:%'
  )
  and not exists (
    select 1 from briar_hunt_runs existing
    where existing.source = new.source
      and existing.source_key = new.source_key
      and existing.project_id = new.project_id
  )
  and exists (
    select 1 from briar_hunt_runs existing
    where existing.source = new.source
      and existing.source_key = new.source_key
      and existing.project_id <> new.project_id
  )
BEGIN
  select raise(abort, 'channel proposal issue project conflict');
END;

-- A persisted approval identity belongs to its reserved project. Keep this
-- invariant at the database boundary as well as in the HTTP route.
drop trigger if exists briar_hunt_runs_channel_proposal_reservation_guard;
create trigger briar_hunt_runs_channel_proposal_reservation_guard
before insert on briar_hunt_runs
when new.source = 'issue'
  and exists (
    select 1 from briar_channel_action_proposals proposal
    where proposal.issue_source_key = new.source_key
      and proposal.project_id is not null
      and proposal.project_id <> new.project_id
  )
BEGIN
  select raise(abort, 'channel proposal issue project conflict');
END;

-- Opaque approval identities are never general-purpose run identities. If the
-- proposal disappeared (for example via channel deletion), abort rather than
-- leaving an orphan issue without its approval/audit record. The reservation
-- also binds every field written by createApprovedChannelProposalIssue: an old
-- or compromised writer cannot consume the opaque identity with executable or
-- otherwise user-altered work before the approving request resumes.
drop trigger if exists briar_hunt_runs_channel_proposal_reservation_required;
create trigger briar_hunt_runs_channel_proposal_reservation_required
before insert on briar_hunt_runs
when new.source = 'issue'
  and new.source_key like 'briar-channel-approved:%'
  and not exists (
    select 1 from briar_hunt_runs existing
    where existing.project_id = new.project_id
      and existing.source = new.source
      and existing.source_key = new.source_key
  )
  and not exists (
    select 1
    from briar_channel_action_proposals proposal
    join briar_channels channel on channel.id = proposal.channel_id
    join briar_projects project
      on project.id = proposal.project_id
     and project.organization_id = channel.organization_id
    where proposal.status = 'pending'
      and proposal.action_type = 'request_issue_create'
      and proposal.project_id = new.project_id
      and proposal.issue_source_key = new.source_key
      and proposal.accepted_by_user_id is not null
      and proposal.accepted_at is not null
      and (
        length(new.source_key) = 87
        and substr(new.source_key, 1, 23) = 'briar-channel-approved:'
        and substr(new.source_key, 24) not glob '*[^0-9a-f]*'
      )
      and (
        json_type(proposal.payload_json) = 'object'
        and (select count(*) from json_each(proposal.payload_json)) = 1
        and json_type(proposal.payload_json, '$.issue') = 'object'
        and (
          select count(*)
          from json_each(proposal.payload_json, '$.issue')
        ) = 4
        and json_type(proposal.payload_json, '$.issue.title') = 'text'
        and json_type(
          proposal.payload_json, '$.issue.description'
        ) in ('text', 'null')
        and json_type(
          proposal.payload_json, '$.issue.priority'
        ) in ('integer', 'null')
        and json_type(proposal.payload_json, '$.issue.status') = 'text'
        and json_extract(
          proposal.payload_json, '$.issue.status'
        ) in ('backlog', 'queued')
      )
      and (
        new.title = json_extract(proposal.payload_json, '$.issue.title')
        and new.issue_description is
          json_extract(proposal.payload_json, '$.issue.description')
        and new.priority is
          json_extract(proposal.payload_json, '$.issue.priority')
        and new.status = 'backlog'
        and new.stage = 'queued'
        and new.workflow_stage is null
        and new.issue_checkpoints_json = '[]'
        and new.detail =
          '채널 대화에서 사용자가 승인한 제안으로 생성된 이슈입니다.'
        and new.repository = coalesce(
          (select settings.github_repository
           from briar_project_settings settings
           where settings.project_id = proposal.project_id),
          project.name
        )
      )
      and (
        new.assignee_user_id is null
        and new.agent_id is null
        and new.worker_id is null
        and new.requested_worker_id is null
        and new.claim_token_hash is null
        and new.claimed_by is null
        and new.claimed_at is null
        and new.lease_expires_at is null
        and new.claim_attempts = 0
        and new.current_attempt = 1
        and new.current_revision = 1
      )
      and (
        new.last_execution_id is null
        and new.dispatch_mode is null
        and new.dispatch_request_id is null
        and new.dispatched_at is null
        and new.requested_by_user_id is null
        and new.requested_agent_provider is null
        and new.requested_agent_model is null
        and new.requested_agent_effort is null
        and new.preferred_agent_provider is null
        and new.preferred_agent_model is null
        and new.preferred_agent_effort is null
      )
      and (
        new.branch is null
        and new.commit_sha is null
        and new.tracker_provider is null
        and new.tracker_issue_id is null
        and new.tracker_issue_identifier is null
        and new.tracker_issue_url is null
        and new.tracker_issue_state is null
        and new.result_summary is null
        and new.structured_result_json is null
        and new.pull_request_urls = '[]'
        and new.target_sha is null
        and new.staging_qa_status is null
        and new.production_qa_status is null
        and new.staging_qa_detail is null
        and new.production_qa_detail is null
        and new.execution_metrics_json is null
      )
      and (
        new.completed_at is null
        and new.paused_at is null
        and new.resume_requested_at is null
        and new.waiting_checkpoint_key is null
        and new.waiting_checkpoint_revision is null
        and new.event_count = 0
        and new.source_created_at = proposal.created_at
        and new.started_at = proposal.created_at
        and new.last_event_at = proposal.created_at
        and new.created_at = new.updated_at
      )
      and (
        json_type(new.context_json) = 'object'
        and (select count(*) from json_each(new.context_json)) = 6
        and json_type(new.context_json, '$.origin') = 'text'
        and json_extract(new.context_json, '$.origin') = 'briar-channel'
        and json_type(new.context_json, '$.proposalId') = 'text'
        and json_extract(new.context_json, '$.proposalId') = proposal.id
        and json_type(new.context_json, '$.channelId') = 'text'
        and json_extract(new.context_json, '$.channelId') = proposal.channel_id
        and json_type(new.context_json, '$.issueId') = 'text'
        and json_extract(new.context_json, '$.issueId') = proposal.id
        and json_type(new.context_json, '$.attachmentCount') = 'integer'
        and json_extract(new.context_json, '$.attachmentCount') = 0
        and json_type(new.context_json, '$.fullAuto') = 'false'
      )
  )
BEGIN
  select raise(abort, 'channel proposal approval reservation not found');
END;

-- Materializing the backlog run is the approval commit. Finalize the proposal
-- in the same SQLite statement so no externally mutable, user-visible run can
-- exist between issue creation and proposal acceptance.
drop trigger if exists briar_hunt_runs_finalize_channel_proposal_approval;
create trigger briar_hunt_runs_finalize_channel_proposal_approval
after insert on briar_hunt_runs
when new.source = 'issue'
  and new.source_key like 'briar-channel-approved:%'
  and exists (
    select 1
    from briar_channel_action_proposals proposal
    join briar_channels channel on channel.id = proposal.channel_id
    join briar_projects project
      on project.id = proposal.project_id
     and project.organization_id = channel.organization_id
    where proposal.status = 'pending'
      and proposal.action_type = 'request_issue_create'
      and proposal.project_id = new.project_id
      and proposal.issue_source_key = new.source_key
      and proposal.accepted_by_user_id is not null
      and proposal.accepted_at is not null
      and (
        length(new.source_key) = 87
        and substr(new.source_key, 1, 23) = 'briar-channel-approved:'
        and substr(new.source_key, 24) not glob '*[^0-9a-f]*'
      )
      and (
        json_type(proposal.payload_json) = 'object'
        and (select count(*) from json_each(proposal.payload_json)) = 1
        and json_type(proposal.payload_json, '$.issue') = 'object'
        and (
          select count(*)
          from json_each(proposal.payload_json, '$.issue')
        ) = 4
        and json_type(proposal.payload_json, '$.issue.title') = 'text'
        and json_type(
          proposal.payload_json, '$.issue.description'
        ) in ('text', 'null')
        and json_type(
          proposal.payload_json, '$.issue.priority'
        ) in ('integer', 'null')
        and json_type(proposal.payload_json, '$.issue.status') = 'text'
        and json_extract(
          proposal.payload_json, '$.issue.status'
        ) in ('backlog', 'queued')
      )
      and (
        new.title = json_extract(proposal.payload_json, '$.issue.title')
        and new.issue_description is
          json_extract(proposal.payload_json, '$.issue.description')
        and new.priority is
          json_extract(proposal.payload_json, '$.issue.priority')
        and new.status = 'backlog'
        and new.stage = 'queued'
        and new.workflow_stage is null
        and new.issue_checkpoints_json = '[]'
        and new.detail =
          '채널 대화에서 사용자가 승인한 제안으로 생성된 이슈입니다.'
        and new.repository = coalesce(
          (select settings.github_repository
           from briar_project_settings settings
           where settings.project_id = proposal.project_id),
          project.name
        )
      )
      and (
        new.assignee_user_id is null
        and new.agent_id is null
        and new.worker_id is null
        and new.requested_worker_id is null
        and new.claim_token_hash is null
        and new.claimed_by is null
        and new.claimed_at is null
        and new.lease_expires_at is null
        and new.claim_attempts = 0
        and new.current_attempt = 1
        and new.current_revision = 1
      )
      and (
        new.last_execution_id is null
        and new.dispatch_mode is null
        and new.dispatch_request_id is null
        and new.dispatched_at is null
        and new.requested_by_user_id is null
        and new.requested_agent_provider is null
        and new.requested_agent_model is null
        and new.requested_agent_effort is null
        and new.preferred_agent_provider is null
        and new.preferred_agent_model is null
        and new.preferred_agent_effort is null
      )
      and (
        new.branch is null
        and new.commit_sha is null
        and new.tracker_provider is null
        and new.tracker_issue_id is null
        and new.tracker_issue_identifier is null
        and new.tracker_issue_url is null
        and new.tracker_issue_state is null
        and new.result_summary is null
        and new.structured_result_json is null
        and new.pull_request_urls = '[]'
        and new.target_sha is null
        and new.staging_qa_status is null
        and new.production_qa_status is null
        and new.staging_qa_detail is null
        and new.production_qa_detail is null
        and new.execution_metrics_json is null
      )
      and (
        new.completed_at is null
        and new.paused_at is null
        and new.resume_requested_at is null
        and new.waiting_checkpoint_key is null
        and new.waiting_checkpoint_revision is null
        and new.event_count = 0
        and new.source_created_at = proposal.created_at
        and new.started_at = proposal.created_at
        and new.last_event_at = proposal.created_at
        and new.created_at = new.updated_at
      )
      and (
        json_type(new.context_json) = 'object'
        and (select count(*) from json_each(new.context_json)) = 6
        and json_type(new.context_json, '$.origin') = 'text'
        and json_extract(new.context_json, '$.origin') = 'briar-channel'
        and json_type(new.context_json, '$.proposalId') = 'text'
        and json_extract(new.context_json, '$.proposalId') = proposal.id
        and json_type(new.context_json, '$.channelId') = 'text'
        and json_extract(new.context_json, '$.channelId') = proposal.channel_id
        and json_type(new.context_json, '$.issueId') = 'text'
        and json_extract(new.context_json, '$.issueId') = proposal.id
        and json_type(new.context_json, '$.attachmentCount') = 'integer'
        and json_extract(new.context_json, '$.attachmentCount') = 0
        and json_type(new.context_json, '$.fullAuto') = 'false'
      )
  )
BEGIN
  insert into briar_channel_issue_approval_audit (
    id, proposal_id, organization_id, channel_id, project_id, run_id,
    approved_by_user_id, approved_at, issue_source_key, result_verification,
    payload_json, created_at
  )
  select proposal.id || ':approval:' || proposal.issue_source_key,
         proposal.id, channel.organization_id, proposal.channel_id,
         proposal.project_id, new.id, proposal.accepted_by_user_id,
         proposal.accepted_at, proposal.issue_source_key, 'atomic',
         proposal.payload_json, proposal.accepted_at
  from briar_channel_action_proposals proposal
  join briar_channels channel on channel.id = proposal.channel_id
  where proposal.status = 'pending'
    and proposal.action_type = 'request_issue_create'
    and proposal.project_id = new.project_id
    and proposal.issue_source_key = new.source_key
    and proposal.accepted_by_user_id is not null
    and proposal.accepted_at is not null;
  update briar_channel_action_proposals
  set status = 'accepted', result_run_id = new.id, updated_at = accepted_at
  where status = 'pending' and action_type = 'request_issue_create'
    and project_id = new.project_id and issue_source_key = new.source_key
    and accepted_by_user_id is not null and accepted_at is not null;
END;

-- Once this migration is active, fail closed on every *new* predictable legacy
-- identity for a channel proposal. Existing exact runs remain updatable so
-- previously accepted work can finish, but an in-flight old Worker must retry
-- on a new binary and use the opaque atomic approval flow.
drop trigger if exists briar_hunt_runs_legacy_channel_proposal_guard;
create trigger briar_hunt_runs_legacy_channel_proposal_guard
before insert on briar_hunt_runs
when new.source = 'issue'
  and new.source_key like 'briar-channel-proposal:%'
  and not exists (
    select 1 from briar_hunt_runs existing
    where existing.project_id = new.project_id
      and existing.source = new.source
      and existing.source_key = new.source_key
  )
BEGIN
  select raise(abort, 'legacy channel proposal issue creation is disabled');
END;

-- 0075 rebuilt the proposal table to remove its Ideas foreign key. SQLite
-- drops table-owned triggers during that swap, so restore the 0074 channel
-- change-feed projections for both new and updated proposal cards.
drop trigger if exists briar_channel_changes_proposals_insert_sync;
create trigger briar_channel_changes_proposals_insert_sync
after insert on briar_channel_action_proposals BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) select channel.organization_id, new.channel_id, 'proposal', new.id,
           'upsert', datetime('now')
    from briar_channels channel where channel.id = new.channel_id;
  insert into briar_channel_sync_state (organization_id, current_version)
  select channel.organization_id, last_insert_rowid()
  from briar_channels channel where channel.id = new.channel_id
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
END;

drop trigger if exists briar_channel_changes_proposals_update_sync;
create trigger briar_channel_changes_proposals_update_sync
after update on briar_channel_action_proposals BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) select channel.organization_id, new.channel_id, 'proposal', new.id,
           'upsert', datetime('now')
    from briar_channels channel where channel.id = new.channel_id;
  insert into briar_channel_sync_state (organization_id, current_version)
  select channel.organization_id, last_insert_rowid()
  from briar_channels channel where channel.id = new.channel_id
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
END;

-- Account deletion uses a short-lived transaction-local job row so the final
-- eligibility check, destructive cascades, and durable cleanup outboxes all
-- share one D1 batch snapshot. These rows intentionally do not reference the
-- user or organization being erased.
create table briar_account_deletion_jobs (
  id text primary key not null,
  user_id text not null unique,
  email text not null,
  created_at text not null
);

create table briar_account_deletion_job_organizations (
  job_id text not null
    references briar_account_deletion_jobs (id) on delete cascade,
  organization_id text not null,
  primary key (job_id, organization_id)
);

-- Slack revocation is an external side effect. Preserve the encrypted token
-- without a foreign key so a failed or temporarily unconfigured revoke can be
-- retried after the Briar account transaction commits.
create table briar_slack_revocation_queue (
  id text primary key not null check (
    length(id) = 64 and id not glob '*[^0-9a-f]*'
  ),
  team_id text not null,
  encrypted_bot_token text not null,
  token_iv text not null,
  queued_at text not null,
  next_attempt_at text not null,
  attempts integer not null default 0 check (attempts >= 0),
  last_attempt_at text,
  last_error text,
  dead_lettered_at text,
  dead_letter_reason text,
  check (
    (dead_lettered_at is null and dead_letter_reason is null)
    or (dead_lettered_at is not null and dead_letter_reason is not null)
  )
);

-- Process the oldest due work first. A failed row moves its due time forward,
-- allowing later uninstalls through on the next bounded batch while ensuring
-- retries also make progress; dead letters require manual replay.
create index briar_slack_revocation_queue_due_idx
  on briar_slack_revocation_queue (
    dead_lettered_at, next_attempt_at, queued_at, id
  );
