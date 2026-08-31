-- Plan documents have lived directly on channel messages since migration
-- 0075. Retire the stale proposal variant and seal this table as issue-only.
-- Batch mappings intentionally have no proposal foreign key because valid
-- acceptance evidence outlives a deleted channel. A plan proposal could never
-- create an issue, so any mapping attached to one is invalid legacy data.
drop trigger if exists briar_channel_issue_batch_items_immutable_delete;

delete from briar_channel_issue_batch_items
where exists (
  select 1 from briar_channel_action_proposals proposal
  where proposal.id = briar_channel_issue_batch_items.proposal_id
    and proposal.action_type = 'request_plan_document'
);

create trigger briar_channel_issue_batch_items_immutable_delete
before delete on briar_channel_issue_batch_items
when exists (
  select 1 from briar_organizations organization
  where organization.id = old.organization_id
)
begin
  select raise(abort, 'channel issue batch mapping is immutable');
end;

delete from briar_channel_changes
where entity_type = 'proposal'
  and exists (
    select 1 from briar_channel_action_proposals proposal
    where proposal.id = briar_channel_changes.entity_id
      and proposal.action_type = 'request_plan_document'
  );

delete from briar_channel_action_proposals
where action_type = 'request_plan_document';

create trigger briar_channel_issue_proposal_action_insert_guard
before insert on briar_channel_action_proposals
when new.action_type <> 'request_issue_create'
begin
  select raise(abort, 'channel proposals must create issues');
end;

create trigger briar_channel_issue_proposal_action_update_guard
before update of action_type on briar_channel_action_proposals
when new.action_type <> 'request_issue_create'
begin
  select raise(abort, 'channel proposals must create issues');
end;
