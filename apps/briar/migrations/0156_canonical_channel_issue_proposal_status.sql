pragma foreign_keys = on;

-- Issue proposals are always created in the backlog. Older persisted payloads
-- could spell the requested state as `queued`, even though acceptance already
-- normalized both values to backlog. Canonicalize the stored contract once.
drop trigger if exists briar_channel_issue_proposal_payload_immutable;

update briar_channel_action_proposals
set payload_json = json_set(payload_json, '$.issue.status', 'backlog')
where action_type = 'request_issue_create'
  and json_extract(payload_json, '$.issue.status') = 'queued';

create trigger briar_channel_issue_proposal_payload_immutable
before update of action_type, payload_json on briar_channel_action_proposals
when new.action_type is not old.action_type
  or new.payload_json is not old.payload_json
begin
  select raise(abort, 'channel issue proposal payload is immutable');
end;

create trigger briar_channel_issue_proposal_current_insert_guard
before insert on briar_channel_action_proposals
when new.action_type = 'request_issue_create'
  and json_extract(new.payload_json, '$.issue.status') is not 'backlog'
begin
  select raise(abort, 'channel issue proposal status must be backlog');
end;

create trigger briar_channel_issue_proposal_current_update_guard
before update of action_type, payload_json on briar_channel_action_proposals
when new.action_type = 'request_issue_create'
  and json_extract(new.payload_json, '$.issue.status') is not 'backlog'
begin
  select raise(abort, 'channel issue proposal status must be backlog');
end;
