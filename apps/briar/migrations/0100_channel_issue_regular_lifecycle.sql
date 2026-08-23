-- Approval is required for an execution requested inside a channel
-- conversation, and that request is handled by the execution-proposal tables.
-- Once an issue-creation proposal has materialized its backlog issue, a member
-- may manage that issue through the normal issue status endpoint. The old
-- trigger incorrectly treated creation provenance as a permanent execution
-- restriction and rejected the ordinary Backlog -> Todo transition.
drop trigger if exists briar_channel_approved_backlog_status_guard;

-- Keep the rolling-worker safety net, but exempt status events written by the
-- authenticated member status endpoint. Agent/Worker events still cannot turn
-- a channel conversation's backlog issue into executable work on their own.
drop trigger if exists briar_channel_approved_backlog_event_guard;

create trigger briar_channel_approved_backlog_event_guard
before insert on briar_hunt_events
when new.status not in ('backlog', 'cancelled')
  and new.actor not like 'briar-app:%'
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
