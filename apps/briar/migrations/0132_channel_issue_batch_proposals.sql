-- Durable local-key to run mappings for channel issue batches. Proposal and
-- run IDs intentionally are not foreign keys: approval evidence survives
-- channel/project cleanup just like briar_channel_issue_approval_audit.
create table briar_channel_issue_batch_items (
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  channel_id text not null,
  proposal_id text not null,
  project_id text not null,
  local_key text not null check (
    length(local_key) between 1 and 64
    and local_key glob '[A-Za-z0-9]*'
    and local_key not glob '*[^A-Za-z0-9._-]*'
  ),
  position integer not null check (position between 0 and 7),
  source_key text not null unique,
  run_id text not null unique,
  created_at text not null,
  primary key (proposal_id, local_key),
  unique (proposal_id, position)
);

create index briar_channel_issue_batch_items_proposal_idx
  on briar_channel_issue_batch_items (proposal_id, position);

create index briar_channel_issue_batch_items_run_idx
  on briar_channel_issue_batch_items (run_id, source_key);

create trigger briar_channel_issue_batch_items_immutable_update
before update on briar_channel_issue_batch_items
BEGIN
  select raise(abort, 'channel issue batch mapping is immutable');
END;

create trigger briar_channel_issue_batch_items_immutable_delete
before delete on briar_channel_issue_batch_items
when exists (
  select 1 from briar_organizations organization
  where organization.id = old.organization_id
)
BEGIN
  select raise(abort, 'channel issue batch mapping is immutable');
END;
