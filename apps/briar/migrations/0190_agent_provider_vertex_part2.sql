pragma defer_foreign_keys = on;

CREATE TRIGGER briar_channel_changes_channels_update_sync
after update on briar_channels
when old.memory_roster_epoch = new.memory_roster_epoch
  or old.id is not new.id
  or old.organization_id is not new.organization_id
  or old.slug is not new.slug
  or old.name is not new.name
  or old.topic is not new.topic
  or old.visibility is not new.visibility
  or old.default_project_id is not new.default_project_id
  or old.created_by_user_id is not new.created_by_user_id
  or old.archived_at is not new.archived_at
  or old.created_at is not new.created_at
  or old.updated_at is not new.updated_at
  or old.kind is not new.kind
  or old.dm_key is not new.dm_key
BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) values (
    new.organization_id, new.id, 'channel', new.id, 'upsert', datetime('now')
  );
  insert into briar_channel_sync_state (organization_id, current_version)
  values (new.organization_id, last_insert_rowid())
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  values (new.organization_id, 1)
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id = new.organization_id
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id = new.organization_id
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER briar_channel_changes_messages_update_sync
after update on briar_channel_messages
when old.memory_source_version = new.memory_source_version
  or old.id is not new.id
  or old.channel_id is not new.channel_id
  or old.parent_message_id is not new.parent_message_id
  or old.author_user_id is not new.author_user_id
  or old.author_agent_id is not new.author_agent_id
  or old.author_agent_name is not new.author_agent_name
  or old.author_agent_provider is not new.author_agent_provider
  or old.author_webhook_id is not new.author_webhook_id
  or old.author_webhook_name is not new.author_webhook_name
  or old.webhook_event_id is not new.webhook_event_id
  or old.body is not new.body
  or old.created_at is not new.created_at
  or old.updated_at is not new.updated_at
  or old.blocks_json is not new.blocks_json
  or old.deleted_at is not new.deleted_at
BEGIN
  insert into briar_channel_changes (
    organization_id, channel_id, entity_type, entity_id, operation, created_at
  ) select channel.organization_id, new.channel_id, 'message', new.id,
           'upsert', datetime('now')
    from briar_channels channel where channel.id = new.channel_id;
  insert into briar_channel_sync_state (organization_id, current_version)
  select channel.organization_id, last_insert_rowid()
  from briar_channels channel where channel.id = new.channel_id
  on conflict (organization_id) do update
    set current_version = excluded.current_version;
  insert into briar_organization_inbox_sync_state (
    organization_id, current_version
  )
  select channel.organization_id, 1
  from briar_channels channel where channel.id = new.channel_id
  on conflict (organization_id) do update set
    current_version = briar_organization_inbox_sync_state.current_version + 1;
  insert into briar_mobile_push_outbox (organization_id, version, updated_at)
  select state.organization_id, state.current_version,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channels channel where channel.id = new.channel_id
  )
  on conflict(organization_id) do update set
    version = max(briar_mobile_push_outbox.version, excluded.version),
    updated_at = excluded.updated_at;
  insert into briar_organization_inbox_realtime_outbox (
    organization_id, version, updated_at
  )
  select state.organization_id, state.current_version, datetime('now')
  from briar_organization_inbox_sync_state state
  where state.organization_id in (
    select channel.organization_id
    from briar_channels channel where channel.id = new.channel_id
  )
  on conflict (organization_id) do update set
    version = max(
      briar_organization_inbox_realtime_outbox.version,
      excluded.version
    ),
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER briar_dm_memory_close_roster
after update of memory_roster_epoch on briar_channels
when old.memory_roster_epoch <> new.memory_roster_epoch
begin
  update briar_dm_memory_spaces set status = 'closed', use_enabled = 0, auto_enabled = 0,
    memory_revision = memory_revision + 1, revocation_epoch = revocation_epoch + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  where channel_id = new.id and status = 'active';
end;

CREATE TRIGGER briar_dm_memory_member_added after insert on briar_channel_members begin
  update briar_channels set memory_roster_epoch = memory_roster_epoch + 1 where id = new.channel_id;
end;

CREATE TRIGGER briar_dm_memory_member_removed after delete on briar_channel_members begin
  update briar_channels set memory_roster_epoch = memory_roster_epoch + 1 where id = old.channel_id;
end;

CREATE TRIGGER briar_dm_memory_agent_added after insert on briar_channel_agents begin
  update briar_channels set memory_roster_epoch = memory_roster_epoch + 1 where id = new.channel_id;
end;

CREATE TRIGGER briar_dm_memory_agent_removed after delete on briar_channel_agents begin
  update briar_channels set memory_roster_epoch = memory_roster_epoch + 1 where id = old.channel_id;
end;

CREATE TRIGGER briar_dm_memory_member_replaced after update of channel_id, user_id on briar_channel_members
when old.channel_id <> new.channel_id or old.user_id <> new.user_id begin
  update briar_channels set memory_roster_epoch = memory_roster_epoch + 1
  where id in (old.channel_id, new.channel_id);
end;

CREATE TRIGGER briar_dm_memory_agent_replaced after update of channel_id, agent_id on briar_channel_agents
when old.channel_id <> new.channel_id or old.agent_id <> new.agent_id begin
  update briar_channels set memory_roster_epoch = memory_roster_epoch + 1
  where id in (old.channel_id, new.channel_id);
end;

CREATE TRIGGER briar_dm_memory_agent_scope_changed
after update of project_id, organization_id on briar_project_agents
when old.project_id is not new.project_id or old.organization_id <> new.organization_id begin
  update briar_channels set memory_roster_epoch = memory_roster_epoch + 1
  where id in (select channel_id from briar_channel_agents where agent_id = new.id);
end;

CREATE TRIGGER briar_dm_memory_channel_changed after update of kind, archived_at on briar_channels
when old.kind <> new.kind or old.archived_at is not new.archived_at begin
  update briar_channels set memory_roster_epoch = memory_roster_epoch + 1 where id = new.id;
end;

CREATE TRIGGER briar_dm_memory_channel_deleted before delete on briar_channels begin
  update briar_dm_memory_spaces set status = 'closed', use_enabled = 0, auto_enabled = 0,
    memory_revision = memory_revision + 1, revocation_epoch = revocation_epoch + 1
  where channel_id = old.id and status = 'active';
end;

CREATE TRIGGER briar_dm_memory_owner_removed before delete on briar_organization_members begin


  update briar_channels set memory_roster_epoch = memory_roster_epoch + 1
  where organization_id = old.organization_id and id in (
    select channel_id from briar_channel_members where user_id = old.user_id
  );
  update briar_dm_memory_spaces set status = 'closed', use_enabled = 0, auto_enabled = 0,
    memory_revision = memory_revision + 1, revocation_epoch = revocation_epoch + 1
  where organization_id = old.organization_id and owner_user_id = old.user_id and status = 'active';
end;

CREATE TRIGGER briar_dm_memory_role_changed after update of role on briar_organization_members
when old.role <> new.role begin
  update briar_dm_memory_spaces set memory_revision = memory_revision + 1,
    revocation_epoch = revocation_epoch + 1
  where organization_id = new.organization_id and owner_user_id = new.user_id;
end;

CREATE TRIGGER briar_dm_memory_project_access_removed before delete on briar_project_members begin
  update briar_dm_memory_spaces set memory_revision = memory_revision + 1,
    revocation_epoch = revocation_epoch + 1
  where owner_user_id = old.user_id and agent_id in (
    select id from briar_project_agents where project_id = old.project_id
  );
end;

CREATE TRIGGER briar_dm_memory_cancel_revoked after update of revocation_epoch on briar_dm_memory_spaces
when old.revocation_epoch <> new.revocation_epoch begin
  update briar_dm_memory_jobs set status = 'cancelled', input_json = null,
    lease_token_hash = null, lease_expires_at = null, error_code = 'scope_revoked'
  where space_id = new.id and kind in ('extract', 'consolidate', 'explicit_request')
    and status in ('pending', 'running', 'retry_wait');
end;

CREATE TRIGGER briar_dm_memory_message_changed
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

CREATE TRIGGER briar_dm_memory_message_deleted before delete on briar_channel_messages begin
  update briar_dm_memory_spaces set memory_revision = memory_revision + 1,
    revocation_epoch = revocation_epoch + 1
  where id in (select space_id from briar_dm_memory_sources
    where source_type = 'message' and source_id = old.id);
  update briar_dm_memory_documents set status = 'invalidated'
  where status = 'active' and id in (select document_id from briar_dm_memory_sources
    where source_type = 'message' and source_id = old.id);
end;

CREATE TRIGGER briar_dm_memory_chunk_purge after delete on briar_dm_memory_chunks
begin
  update briar_dm_memory_vectors set state = 'purging', delete_mutation_id = null,
    confirmed_at = null, available_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    lease_token = null, lease_expires_at = null, attempt = 0, error_code = null
    where id = old.vector_id;
end;

CREATE TRIGGER briar_dm_memory_document_projection_update
after update of current_version, status, conflicted, expired_version on briar_dm_memory_documents
begin
  delete from briar_dm_memory_chunks where document_id = new.id
    and (document_version <> new.current_version or new.status <> 'active'
      or new.expired_version = new.current_version);
  delete from briar_dm_memory_briefs where space_id = new.space_id;
end;

CREATE TRIGGER briar_dm_memory_space_projection_update
after update of memory_revision, revocation_epoch, status on briar_dm_memory_spaces
begin
  delete from briar_dm_memory_briefs where space_id = new.id;
  delete from briar_dm_memory_chunks where space_id = new.id and new.status <> 'active';
end;

CREATE TRIGGER briar_dm_memory_expiry_epoch
after update of expired_version on briar_dm_memory_documents
when new.expired_version = new.current_version and old.expired_version <> new.expired_version
begin
  update briar_dm_memory_spaces set memory_revision = memory_revision + 1,
    revocation_epoch = revocation_epoch + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where id = new.space_id;
end;

CREATE TRIGGER briar_issue_hierarchy_validate_insert
before insert on briar_issue_parent_links BEGIN
  select case when not exists (
    select 1 from briar_hunt_runs parent
    where parent.id = new.parent_run_id and parent.project_id = new.project_id
  ) or not exists (
    select 1 from briar_hunt_runs child
    where child.id = new.child_run_id and child.project_id = new.project_id
  ) then raise(abort, 'issue hierarchy endpoints must belong to the project') end;
  select case when exists (
    with recursive descendants(run_id) as (
      values (new.child_run_id)
      union
      select hierarchy.child_run_id
      from briar_issue_parent_links hierarchy
      join descendants on descendants.run_id = hierarchy.parent_run_id
      where hierarchy.project_id = new.project_id
    )
    select 1 from descendants where run_id = new.parent_run_id
  ) then raise(abort, 'issue hierarchy would create a cycle') end;
END;

CREATE TRIGGER briar_issue_hierarchy_validate_update
before update of project_id, parent_run_id, child_run_id
on briar_issue_parent_links BEGIN
  select case when not exists (
    select 1 from briar_hunt_runs parent
    where parent.id = new.parent_run_id and parent.project_id = new.project_id
  ) or not exists (
    select 1 from briar_hunt_runs child
    where child.id = new.child_run_id and child.project_id = new.project_id
  ) then raise(abort, 'issue hierarchy endpoints must belong to the project') end;
  select case when exists (
    with recursive descendants(run_id) as (
      values (new.child_run_id)
      union
      select hierarchy.child_run_id
      from briar_issue_parent_links hierarchy
      join descendants on descendants.run_id = hierarchy.parent_run_id
      where hierarchy.project_id = new.project_id
        and hierarchy.child_run_id <> old.child_run_id
    )
    select 1 from descendants where run_id = new.parent_run_id
  ) then raise(abort, 'issue hierarchy would create a cycle') end;
END;

CREATE TRIGGER briar_issue_relations_validate_insert
before insert on briar_issue_relations BEGIN
  select case when not exists (
    select 1 from briar_hunt_runs first_run
    where first_run.id = new.first_run_id
      and first_run.project_id = new.project_id
  ) or not exists (
    select 1 from briar_hunt_runs second_run
    where second_run.id = new.second_run_id
      and second_run.project_id = new.project_id
  ) then raise(abort, 'related issue endpoints must belong to the project') end;
END;

CREATE TRIGGER briar_issue_relations_validate_update
before update of project_id, first_run_id, second_run_id
on briar_issue_relations BEGIN
  select case when not exists (
    select 1 from briar_hunt_runs first_run
    where first_run.id = new.first_run_id
      and first_run.project_id = new.project_id
  ) or not exists (
    select 1 from briar_hunt_runs second_run
    where second_run.id = new.second_run_id
      and second_run.project_id = new.project_id
  ) then raise(abort, 'related issue endpoints must belong to the project') end;
END;

CREATE TRIGGER briar_dashboard_hierarchy_insert_sync
after insert on briar_issue_parent_links BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values
    (new.project_id, 'run', new.parent_run_id, 'upsert', datetime('now')),
    (new.project_id, 'run', new.child_run_id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dashboard_hierarchy_update_sync
after update on briar_issue_parent_links BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values
    (old.project_id, 'run', old.parent_run_id, 'upsert', datetime('now')),
    (old.project_id, 'run', old.child_run_id, 'upsert', datetime('now')),
    (new.project_id, 'run', new.parent_run_id, 'upsert', datetime('now')),
    (new.project_id, 'run', new.child_run_id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dashboard_hierarchy_delete_sync
before delete on briar_issue_parent_links BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values
    (old.project_id, 'run', old.parent_run_id, 'upsert', datetime('now')),
    (old.project_id, 'run', old.child_run_id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (old.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dashboard_relations_insert_sync
after insert on briar_issue_relations BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values
    (new.project_id, 'run', new.first_run_id, 'upsert', datetime('now')),
    (new.project_id, 'run', new.second_run_id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dashboard_relations_update_sync
after update on briar_issue_relations BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values
    (old.project_id, 'run', old.first_run_id, 'upsert', datetime('now')),
    (old.project_id, 'run', old.second_run_id, 'upsert', datetime('now')),
    (new.project_id, 'run', new.first_run_id, 'upsert', datetime('now')),
    (new.project_id, 'run', new.second_run_id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dashboard_relations_delete_sync
before delete on briar_issue_relations BEGIN
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values
    (old.project_id, 'run', old.first_run_id, 'upsert', datetime('now')),
    (old.project_id, 'run', old.second_run_id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (old.project_id, last_insert_rowid())
  on conflict (project_id) do update set current_version = excluded.current_version;
END;

CREATE TRIGGER briar_dm_memory_reply_revoked
after update of revocation_epoch on briar_dm_memory_spaces
when old.revocation_epoch <> new.revocation_epoch begin
  insert or ignore into briar_dm_memory_activity_revocations
    (id, organization_id, channel_id, agent_id, trigger_message_id, parent_message_id, attempts)
    select job.id, job.organization_id, job.channel_id, job.agent_id, job.trigger_message_id, job.parent_message_id, job.attempts
    from briar_channel_agent_reply_jobs job join briar_dm_memory_reply_fences fence on fence.job_id = job.id
    where job.status = 'running' and fence.space_id = new.id;

  update briar_channel_reply_sessions set conversation_id = null,
    memory_revocation_epoch = null
    where memory_space_id = new.id;
  update briar_channel_agent_reply_jobs set status = 'queued',
    claim_token_hash = null, claimed_at = null, lease_expires_at = null,
    planned_update_resume = 0, memory_restart_count = memory_restart_count + 1, error = null
    where status = 'running' and id in (
      select job_id from briar_dm_memory_reply_fences where space_id = new.id
    );
  delete from briar_channel_reply_lookups where job_id in (
    select job_id from briar_dm_memory_reply_fences where space_id = new.id
  );
  delete from briar_dm_memory_discovered_refs where job_id in (
    select job_id from briar_dm_memory_reply_fences where space_id = new.id
  );
end;

CREATE TRIGGER briar_dm_memory_reply_space_deleted before delete on briar_dm_memory_spaces begin
  insert or ignore into briar_dm_memory_activity_revocations
    (id, organization_id, channel_id, agent_id, trigger_message_id, parent_message_id, attempts)
    select job.id, job.organization_id, job.channel_id, job.agent_id, job.trigger_message_id, job.parent_message_id, job.attempts
    from briar_channel_agent_reply_jobs job join briar_dm_memory_reply_fences fence on fence.job_id = job.id
    where job.status = 'running' and fence.space_id = old.id;

  update briar_channel_reply_sessions set conversation_id = null,
    memory_revocation_epoch = null where memory_space_id = old.id;
  update briar_channel_agent_reply_jobs set status = 'queued',
    claim_token_hash = null, claimed_at = null, lease_expires_at = null,
    planned_update_resume = 0, memory_restart_count = memory_restart_count + 1, error = null
    where status = 'running' and id in (
      select job_id from briar_dm_memory_reply_fences where space_id = old.id
    );
  delete from briar_channel_reply_lookups where job_id in (
    select job_id from briar_dm_memory_reply_fences where space_id = old.id
  );
  delete from briar_dm_memory_discovered_refs where job_id in (
    select job_id from briar_dm_memory_reply_fences where space_id = old.id
  );
end;

CREATE TRIGGER briar_dm_memory_lookup_revision_changed after update of memory_revision on briar_dm_memory_spaces
when old.memory_revision <> new.memory_revision begin
  update briar_channel_reply_lookups set response_json = null
    where job_id in (select job_id from briar_dm_memory_reply_fences where space_id = new.id);
end;

CREATE TRIGGER briar_dm_memory_lookup_claim_ended after update of status on briar_channel_agent_reply_jobs
when old.status = 'running' and new.status <> 'running' begin
  delete from briar_channel_reply_lookups where job_id = new.id;
end;

CREATE TRIGGER briar_dm_memory_citations_forgotten after update of status on briar_dm_memory_documents
when new.status = 'deleted' begin
  delete from briar_dm_memory_reply_citations where document_id = new.id;
end;

CREATE TRIGGER briar_dm_memory_invalidate_derived_versions after update of current_version, expired_version on briar_dm_memory_documents
when old.current_version <> new.current_version or
  (old.expired_version <> new.expired_version and new.expired_version = new.current_version) begin
  update briar_dm_memory_documents set status = 'invalidated' where status = 'active' and id in (
    with recursive affected(id) as (
      select link.document_id from briar_dm_memory_document_links link
      join briar_dm_memory_documents current on current.id = link.document_id and current.current_version = link.document_version
      where link.source_document_id = new.id and
        (link.source_document_version <> new.current_version or new.expired_version = new.current_version)
      union select link.document_id from briar_dm_memory_document_links link join affected on link.source_document_id = affected.id
        join briar_dm_memory_documents current on current.id = link.document_id and current.current_version = link.document_version
    ) select id from affected where id <> new.id
  );
end;

CREATE TRIGGER briar_dm_memory_capture_message after insert on briar_channel_messages begin
  insert into briar_dm_memory_source_events(space_id, message_id, created_at)
  select space.id, new.id, new.created_at from briar_dm_memory_spaces space
  join briar_dm_memory_live_rosters live on live.organization_id = space.organization_id
    and live.channel_id = space.channel_id and live.owner_user_id = space.owner_user_id
    and live.agent_id = space.agent_id and live.roster_epoch = space.roster_epoch
  where space.channel_id = new.channel_id and space.status = 'active'
    and space.use_enabled = 1 and space.auto_enabled = 1 and new.deleted_at is null
    and julianday(new.created_at) >= julianday(space.auto_enabled_at)
    and (new.author_user_id = space.owner_user_id or new.author_agent_id = space.agent_id)
  on conflict (space_id, message_id) do nothing;
end;

CREATE TRIGGER briar_dm_memory_capture_observation after insert on briar_dm_memory_revisions begin
  insert into briar_dm_memory_observation_events(space_id, document_id, document_version, created_at)
  select new.space_id, new.document_id, new.version, new.created_at
  from briar_dm_memory_documents doc where doc.id = new.document_id and doc.kind = 'observation' and new.version = 1
  on conflict (document_id, document_version) do nothing;
end;

CREATE TRIGGER briar_dm_memory_begin_opt_in after update of auto_enabled on briar_dm_memory_spaces
when old.auto_enabled = 0 and new.auto_enabled = 1 begin
  insert into briar_dm_memory_learning_state(space_id, updated_at) values (new.id, new.updated_at)
  on conflict (space_id) do nothing;
  update briar_dm_memory_learning_state set
    source_watermark = coalesce((select max(sequence) from briar_dm_memory_source_events where space_id = new.id), 0),
    observation_watermark = coalesce((select max(sequence) from briar_dm_memory_observation_events where space_id = new.id), 0),
    updated_at = new.updated_at where space_id = new.id;
  update briar_dm_memory_learning_outbox set settled = 1 where space_id = new.id and kind = 'extract';
end;

CREATE TRIGGER briar_dm_memory_learning_cancel after update of status on briar_dm_memory_jobs
when new.kind in ('extract', 'explicit_request', 'consolidate') and new.status = 'cancelled' begin
  update briar_dm_memory_jobs set input_json = null, input_hash = null,
    lease_token_hash = null, lease_expires_at = null, result_json = null where id = new.id;
  update briar_dm_memory_proposals set proposal_json = null, normalized_json = null,
    status = 'cancelled', terminal_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where job_id = new.id;
  update briar_dm_memory_verifications set decisions_json = null where job_id = new.id;
  update briar_dm_memory_model_calls set status = 'failed', error_code = 'scope_revoked',
    completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where job_id = new.id and status = 'reserved';
end;

CREATE TRIGGER briar_dm_memory_purge_learning_payload after insert on briar_dm_memory_learning_payload_purges begin
  update briar_dm_memory_jobs set input_json = null, input_hash = null, result_json = null,
    status = case when status in ('pending', 'running', 'retry_wait') then 'cancelled' else status end,
    lease_token_hash = null, lease_expires_at = null
  where id in (select job_id from briar_dm_memory_learning_inputs
    where space_id = new.space_id and source_type = new.source_type and source_id = new.source_id);
  update briar_dm_memory_proposals set input_hash = null, proposal_hash = null,
    proposal_json = null, normalized_json = null where job_id in (
      select job_id from briar_dm_memory_learning_inputs where space_id = new.space_id
        and source_type = new.source_type and source_id = new.source_id);
  update briar_dm_memory_verifications set input_hash = null, proposal_hash = null,
    decisions_json = null where job_id in (
      select job_id from briar_dm_memory_learning_inputs where space_id = new.space_id
        and source_type = new.source_type and source_id = new.source_id);
  update briar_dm_memory_model_calls set input_hash = null, proposal_hash = null where job_id in (
    select job_id from briar_dm_memory_learning_inputs where space_id = new.space_id
      and source_type = new.source_type and source_id = new.source_id);
  update briar_dm_memory_learning_commits set proposal_hash = null where job_id in (
    select job_id from briar_dm_memory_learning_inputs where space_id = new.space_id
      and source_type = new.source_type and source_id = new.source_id);
  update briar_dm_memory_commits set payload_hash = null where id in (
    select commit_id from briar_dm_memory_learning_commits where job_id in (
      select job_id from briar_dm_memory_learning_inputs where space_id = new.space_id
        and source_type = new.source_type and source_id = new.source_id));
  update briar_dm_memory_learning_inputs set source_hash = null where space_id = new.space_id
    and source_type = new.source_type and source_id = new.source_id;
  delete from briar_dm_memory_learning_payload_purges where space_id = new.space_id
    and source_type = new.source_type and source_id = new.source_id;
end;

pragma defer_foreign_keys = off;
