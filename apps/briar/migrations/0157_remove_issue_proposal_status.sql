pragma foreign_keys = on;

-- A create proposal has no placement choice: accepting it always creates a
-- backlog issue, while execution requires its own approval. Remove the old
-- constant from mutable proposal storage without rewriting immutable approval
-- evidence. Effect Schema remains authoritative for the rest of the payload.
drop trigger if exists briar_channel_issue_proposal_payload_immutable;
drop trigger if exists briar_conversation_issue_proposal_payload_immutable;
drop trigger if exists briar_channel_issue_proposal_current_insert_guard;
drop trigger if exists briar_channel_issue_proposal_current_update_guard;

update briar_channel_action_proposals
set payload_json = json_remove(payload_json, '$.issue.status')
where action_type = 'request_issue_create'
  and json_type(payload_json, '$.issue.status') is not null;

update briar_channel_action_proposals
set payload_json = json_set(
  payload_json,
  '$.batch.items',
  json((
    select json_group_array(
      json_remove(item.value, '$.issue.status')
    )
    from json_each(payload_json, '$.batch.items') item
  ))
)
where action_type = 'request_issue_create'
  and json_type(payload_json, '$.batch.items') = 'array'
  and exists (
    select 1
    from json_each(payload_json, '$.batch.items') item
    where json_type(item.value, '$.issue.status') is not null
  );

update briar_issue_action_proposals
set payload_json = json_remove(payload_json, '$.issue.status')
where action_type = 'request_issue_create'
  and json_type(payload_json, '$.issue.status') is not null;

create trigger briar_channel_issue_proposal_payload_immutable
before update of action_type, payload_json on briar_channel_action_proposals
when new.action_type is not old.action_type
  or new.payload_json is not old.payload_json
begin
  select raise(abort, 'channel issue proposal payload is immutable');
end;

create trigger briar_conversation_issue_proposal_payload_immutable
before update of action_type, payload_json on briar_issue_action_proposals
when new.action_type is not old.action_type
  or new.payload_json is not old.payload_json
begin
  select raise(abort, 'conversation issue proposal payload is immutable');
end;

create trigger briar_channel_issue_proposal_current_insert_guard
before insert on briar_channel_action_proposals
when new.action_type = 'request_issue_create'
  and (
    json_type(new.payload_json, '$.issue.status') is not null
    or exists (
      select 1
      from json_each(new.payload_json, '$.batch.items') item
      where json_type(item.value, '$.issue.status') is not null
    )
  )
begin
  select raise(abort, 'channel issue proposal payload cannot include status');
end;

create trigger briar_conversation_issue_proposal_current_insert_guard
before insert on briar_issue_action_proposals
when new.action_type = 'request_issue_create'
  and json_type(new.payload_json, '$.issue.status') is not null
begin
  select raise(abort, 'conversation issue proposal payload cannot include status');
end;
