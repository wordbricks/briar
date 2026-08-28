alter table briar_channel_action_proposals
  add column declined_by_user_id text;

alter table briar_channel_action_proposals
  add column declined_at text;

-- A decline is a terminal proposal decision even though the legacy status
-- column remains constrained to pending/accepted for rolling-deploy safety.
-- Readers project declined_at as the public `declined` status.
create trigger briar_channel_issue_proposal_decline_guard
before update of declined_by_user_id, declined_at
on briar_channel_action_proposals
when not (
  old.action_type = 'request_issue_create'
  and old.status = 'pending'
  and old.declined_by_user_id is null
  and old.declined_at is null
  and old.accepted_by_user_id is null
  and old.accepted_at is null
  and old.issue_source_key is null
  and new.declined_by_user_id is not null
  and new.declined_at is not null
)
begin
  select raise(abort, 'channel issue proposal decline is immutable');
end;

create trigger briar_channel_issue_proposal_declined_accept_guard
before update of status, accepted_by_user_id, accepted_at, issue_source_key
on briar_channel_action_proposals
when old.action_type = 'request_issue_create'
  and old.declined_at is not null
  and (
    new.status is not old.status
    or new.accepted_by_user_id is not old.accepted_by_user_id
    or new.accepted_at is not old.accepted_at
    or new.issue_source_key is not old.issue_source_key
  )
begin
  -- Match the guarded approval repository's normal conflict contract: ignore
  -- the UPDATE so RETURNING yields no row and the route responds with 409.
  select raise(ignore);
end;
