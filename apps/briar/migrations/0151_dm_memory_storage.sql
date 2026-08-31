-- Memory is owned by one user/Agent roster generation. Files and vector entries
-- are disposable projections; only these versioned documents are authoritative.
alter table briar_channels add column memory_roster_epoch integer not null default 0;
alter table briar_channel_messages add column memory_source_version integer not null default 1;

create table briar_dm_memory_spaces (
  id text primary key not null,
  organization_id text not null references briar_organizations(id) on delete cascade,
  channel_id text not null,
  owner_user_id text not null references "user"(id) on delete cascade,
  agent_id text not null,
  roster_epoch integer not null,
  status text not null default 'active' check (status in ('active', 'closed')),
  use_enabled integer not null default 0 check (use_enabled in (0, 1)),
  auto_enabled integer not null default 0 check (auto_enabled in (0, 1)),
  auto_enabled_at text,
  ever_saved integer not null default 0 check (ever_saved in (0, 1)),
  memory_revision integer not null default 0,
  revocation_epoch integer not null default 0,
  created_at text not null,
  updated_at text not null,
  unique (organization_id, channel_id, owner_user_id, agent_id, roster_epoch)
);
create index briar_dm_memory_spaces_owner on briar_dm_memory_spaces
  (organization_id, owner_user_id, channel_id, status);

create table briar_dm_memory_documents (
  id text primary key not null,
  space_id text not null references briar_dm_memory_spaces(id) on delete cascade,
  kind text not null check (kind in ('observation', 'topic')),
  title text not null check (length(title) between 1 and 200),
  current_version integer not null check (current_version > 0),
  status text not null default 'active'
    check (status in ('active', 'invalidated', 'superseded', 'deleted')),
  conflicted integer not null default 0 check (conflicted in (0, 1)),
  superseded_by text,
  created_at text not null,
  updated_at text not null,
  unique (space_id, id)
);
create index briar_dm_memory_documents_page on briar_dm_memory_documents
  (space_id, status, id);

create table briar_dm_memory_revisions (
  space_id text not null,
  document_id text not null,
  version integer not null,
  body text not null check (length(cast(body as blob)) between 1 and 65536),
  body_hash text not null,
  memory_class text not null check (memory_class in ('profile', 'log', 'note')),
  evidence_type text not null check (evidence_type in ('explicit_user', 'observed')),
  protected_by_user integer not null check (protected_by_user in (0, 1)),
  source_language text not null,
  observed_at text,
  valid_until text,
  origin text not null check (origin in ('user_edit', 'explicit_request', 'extract', 'consolidate')),
  author_agent_id text,
  policy_version text not null,
  created_at text not null,
  primary key (document_id, version),
  foreign key (space_id, document_id)
    references briar_dm_memory_documents(space_id, id) on delete cascade
);

create table briar_dm_memory_sources (
  space_id text not null,
  document_id text not null,
  document_version integer not null,
  item_id text not null default '',
  source_type text not null check (source_type in ('message', 'user_edit_event')),
  source_id text not null,
  source_version integer not null,
  source_hash text not null,
  primary key (document_id, document_version, item_id, source_type, source_id),
  foreign key (space_id, document_id)
    references briar_dm_memory_documents(space_id, id) on delete cascade,
  foreign key (document_id, document_version)
    references briar_dm_memory_revisions(document_id, version) on delete cascade
);
create index briar_dm_memory_sources_origin on briar_dm_memory_sources
  (source_type, source_id, space_id);

-- This ledger gates every dependent statement in a D1 batch. A rejected CAS
-- cannot leave a revision, source, or index job behind. It stores no body.
create table briar_dm_memory_commits (
  id text primary key not null,
  space_id text not null references briar_dm_memory_spaces(id) on delete cascade,
  request_id text not null,
  document_id text,
  payload_hash text,
  result_version integer,
  applied integer not null default 0 check (applied in (0, 1)),
  created_at text not null,
  unique (space_id, request_id)
);

create table briar_dm_memory_jobs (
  id text primary key not null,
  space_id text not null references briar_dm_memory_spaces(id) on delete cascade,
  kind text not null check (kind in ('index', 'delete', 'extract', 'consolidate', 'explicit_request')),
  dedupe_key text not null unique,
  document_id text,
  document_version integer,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'retry_wait', 'succeeded', 'no_change', 'failed', 'cancelled')),
  stage text,
  attempt integer not null default 0,
  lease_token_hash text,
  lease_expires_at text,
  expected_memory_revision integer not null,
  revocation_epoch integer not null,
  input_json text,
  error_code text,
  mutation_id text,
  available_at text not null,
  created_at text not null,
  updated_at text not null
);
create index briar_dm_memory_jobs_claim on briar_dm_memory_jobs
  (kind, status, available_at, id);

create table briar_dm_memory_exclusions (
  space_id text not null references briar_dm_memory_spaces(id) on delete cascade,
  source_type text not null check (source_type in ('message', 'user_edit_event')),
  source_id text not null,
  document_id text not null,
  revocation_epoch integer not null,
  created_at text not null,
  primary key (space_id, source_type, source_id, document_id)
);

-- Both space creation and the final write guard read this live authorization.
-- A role/name supplied by the client is never an authorization input.
create view briar_dm_memory_live_rosters as
select channel.organization_id, channel.id as channel_id, member.user_id as owner_user_id,
       agent.id as agent_id, channel.memory_roster_epoch as roster_epoch
from briar_channels channel
join briar_channel_members member on member.channel_id = channel.id
join briar_organization_members membership
  on membership.organization_id = channel.organization_id and membership.user_id = member.user_id
join briar_channel_agents roster on roster.channel_id = channel.id
join briar_project_agents agent
  on agent.id = roster.agent_id and agent.organization_id = channel.organization_id
where channel.kind = 'dm' and channel.archived_at is null
  and (select count(*) from briar_channel_members m where m.channel_id = channel.id) = 1
  and (select count(*) from briar_channel_agents a where a.channel_id = channel.id) = 1
  and (agent.project_id is null or (
    membership.role in ('owner', 'co-owner', 'developer')
    and exists (select 1 from briar_teams team
      where team.id = agent.project_id and team.organization_id = channel.organization_id
        and (membership.role in ('owner', 'co-owner') or exists (
          select 1 from briar_project_members pm where pm.project_id = team.id
            and pm.organization_id = team.organization_id and pm.user_id = member.user_id
        )))
  ));

create trigger briar_dm_memory_close_roster
after update of memory_roster_epoch on briar_channels
when old.memory_roster_epoch <> new.memory_roster_epoch
begin
  update briar_dm_memory_spaces set status = 'closed', use_enabled = 0, auto_enabled = 0,
    memory_revision = memory_revision + 1, revocation_epoch = revocation_epoch + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  where channel_id = new.id and status = 'active';
end;

create trigger briar_dm_memory_member_added after insert on briar_channel_members begin
  update briar_channels set memory_roster_epoch = memory_roster_epoch + 1 where id = new.channel_id;
end;
create trigger briar_dm_memory_member_removed after delete on briar_channel_members begin
  update briar_channels set memory_roster_epoch = memory_roster_epoch + 1 where id = old.channel_id;
end;
create trigger briar_dm_memory_agent_added after insert on briar_channel_agents begin
  update briar_channels set memory_roster_epoch = memory_roster_epoch + 1 where id = new.channel_id;
end;
create trigger briar_dm_memory_agent_removed after delete on briar_channel_agents begin
  update briar_channels set memory_roster_epoch = memory_roster_epoch + 1 where id = old.channel_id;
end;
create trigger briar_dm_memory_member_replaced after update of channel_id, user_id on briar_channel_members
when old.channel_id <> new.channel_id or old.user_id <> new.user_id begin
  update briar_channels set memory_roster_epoch = memory_roster_epoch + 1
  where id in (old.channel_id, new.channel_id);
end;
create trigger briar_dm_memory_agent_replaced after update of channel_id, agent_id on briar_channel_agents
when old.channel_id <> new.channel_id or old.agent_id <> new.agent_id begin
  update briar_channels set memory_roster_epoch = memory_roster_epoch + 1
  where id in (old.channel_id, new.channel_id);
end;
create trigger briar_dm_memory_agent_scope_changed
after update of project_id, organization_id on briar_project_agents
when old.project_id is not new.project_id or old.organization_id <> new.organization_id begin
  update briar_channels set memory_roster_epoch = memory_roster_epoch + 1
  where id in (select channel_id from briar_channel_agents where agent_id = new.id);
end;
create trigger briar_dm_memory_channel_changed after update of kind, archived_at on briar_channels
when old.kind <> new.kind or old.archived_at is not new.archived_at begin
  update briar_channels set memory_roster_epoch = memory_roster_epoch + 1 where id = new.id;
end;
create trigger briar_dm_memory_channel_deleted before delete on briar_channels begin
  update briar_dm_memory_spaces set status = 'closed', use_enabled = 0, auto_enabled = 0,
    memory_revision = memory_revision + 1, revocation_epoch = revocation_epoch + 1
  where channel_id = old.id and status = 'active';
end;
create trigger briar_dm_memory_owner_removed before delete on briar_organization_members begin
  -- Reserve a fresh generation so rejoining never reopens the old space and
  -- still permits an explicit new space for the current roster.
  update briar_channels set memory_roster_epoch = memory_roster_epoch + 1
  where organization_id = old.organization_id and id in (
    select channel_id from briar_channel_members where user_id = old.user_id
  );
  update briar_dm_memory_spaces set status = 'closed', use_enabled = 0, auto_enabled = 0,
    memory_revision = memory_revision + 1, revocation_epoch = revocation_epoch + 1
  where organization_id = old.organization_id and owner_user_id = old.user_id and status = 'active';
end;
create trigger briar_dm_memory_role_changed after update of role on briar_organization_members
when old.role <> new.role begin
  update briar_dm_memory_spaces set memory_revision = memory_revision + 1,
    revocation_epoch = revocation_epoch + 1
  where organization_id = new.organization_id and owner_user_id = new.user_id;
end;
create trigger briar_dm_memory_project_access_removed before delete on briar_project_members begin
  update briar_dm_memory_spaces set memory_revision = memory_revision + 1,
    revocation_epoch = revocation_epoch + 1
  where owner_user_id = old.user_id and agent_id in (
    select id from briar_project_agents where project_id = old.project_id
  );
end;

create trigger briar_dm_memory_cancel_revoked after update of revocation_epoch on briar_dm_memory_spaces
when old.revocation_epoch <> new.revocation_epoch begin
  update briar_dm_memory_jobs set status = 'cancelled', input_json = null,
    lease_token_hash = null, lease_expires_at = null, error_code = 'scope_revoked'
  where space_id = new.id and kind in ('extract', 'consolidate', 'explicit_request')
    and status in ('pending', 'running', 'retry_wait');
end;

create trigger briar_dm_memory_message_changed
after update of body, deleted_at on briar_channel_messages
when old.body <> new.body or old.deleted_at is not new.deleted_at
begin
  update briar_channel_messages set memory_source_version = old.memory_source_version + 1
  where id = new.id;
  update briar_dm_memory_spaces set memory_revision = memory_revision + 1,
    revocation_epoch = revocation_epoch + 1
  where id in (select space_id from briar_dm_memory_sources
    where source_type = 'message' and source_id = new.id);
  update briar_dm_memory_documents set status = 'invalidated'
  where status = 'active' and id in (select document_id from briar_dm_memory_sources
    where source_type = 'message' and source_id = new.id);
end;
create trigger briar_dm_memory_message_deleted before delete on briar_channel_messages begin
  update briar_dm_memory_spaces set memory_revision = memory_revision + 1,
    revocation_epoch = revocation_epoch + 1
  where id in (select space_id from briar_dm_memory_sources
    where source_type = 'message' and source_id = old.id);
  update briar_dm_memory_documents set status = 'invalidated'
  where status = 'active' and id in (select document_id from briar_dm_memory_sources
    where source_type = 'message' and source_id = old.id);
end;
