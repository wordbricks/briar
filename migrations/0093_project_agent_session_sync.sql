pragma foreign_keys = on;

-- Keep the lightweight catalog in D1 after the full session payload moves to
-- R2. The projection deliberately omits follow-ups, events, result text, and
-- other detail-only fields so polling never needs an archive object.
create table briar_project_agent_session_summaries (
  project_id text not null references briar_projects (id) on delete cascade,
  session_id text not null,
  summary_json text not null check (
    json_valid(summary_json) and json_type(summary_json) = 'object'
  ),
  updated_at text not null,
  archived integer not null default 0 check (archived in (0, 1)),
  primary key (project_id, session_id)
);

create index briar_project_agent_session_summaries_recent_idx
  on briar_project_agent_session_summaries (
    project_id, updated_at desc, session_id
  );

-- Existing hot rows can be projected without reading R2. Already-archived
-- rows are backfilled once by the Worker because their payload only exists in
-- R2; all newly archived rows retain this projection before D1 purge.
insert into briar_project_agent_session_summaries (
  project_id, session_id, summary_json, updated_at, archived
)
select
  project_id,
  id,
  json_object(
    'dispatchGroupId', coalesce(json_extract(payload_json, '$.dispatchGroupId'), id),
    'agentId', json_extract(payload_json, '$.agentId'),
    'agentName', json_extract(payload_json, '$.agentName'),
    'skillId', json_extract(payload_json, '$.skillId'),
    'sessionType', session_type,
    'trigger', json_extract(payload_json, '$.trigger'),
    'scheduleId', json_extract(payload_json, '$.scheduleId'),
    'scheduleRunId', json_extract(payload_json, '$.scheduleRunId'),
    'parentSessionId', json_extract(payload_json, '$.parentSessionId'),
    'request', substr(json_extract(payload_json, '$.request'), 1, 500),
    'status', status,
    'issues', json(coalesce(json_extract(payload_json, '$.issues'), '[]')),
    'startedAt', started_at,
    'completedAt', completed_at,
    'requestedWorkerId', json_extract(payload_json, '$.requestedWorkerId'),
    'workerId', json_extract(payload_json, '$.workerId'),
    'updatedAt', updated_at
  ),
  updated_at,
  0
from briar_project_agent_sessions;

create table briar_project_agent_session_sync_state (
  project_id text primary key not null
    references briar_projects (id) on delete cascade,
  current_version integer not null default 0 check (current_version >= 0)
);

create table briar_project_agent_session_changes (
  version integer primary key autoincrement,
  project_id text not null references briar_projects (id) on delete cascade,
  session_id text not null,
  operation text not null check (operation in ('upsert', 'delete')),
  created_at text not null
);

create index briar_project_agent_session_changes_project_version_idx
  on briar_project_agent_session_changes (project_id, version);

create index briar_project_agent_session_changes_created_idx
  on briar_project_agent_session_changes (created_at);

create trigger briar_project_agent_session_summaries_insert_sync
after insert on briar_project_agent_session_summaries BEGIN
  insert into briar_project_agent_session_changes (
    project_id, session_id, operation, created_at
  ) values (new.project_id, new.session_id, 'upsert', datetime('now'));
  insert into briar_project_agent_session_sync_state (
    project_id, current_version
  ) values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set
    current_version = excluded.current_version;
END;

create trigger briar_project_agent_session_summaries_update_sync
after update on briar_project_agent_session_summaries BEGIN
  insert into briar_project_agent_session_changes (
    project_id, session_id, operation, created_at
  ) values (new.project_id, new.session_id, 'upsert', datetime('now'));
  insert into briar_project_agent_session_sync_state (
    project_id, current_version
  ) values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update set
    current_version = excluded.current_version;
END;

create trigger briar_project_agent_session_summaries_delete_sync
before delete on briar_project_agent_session_summaries BEGIN
  insert into briar_project_agent_session_changes (
    project_id, session_id, operation, created_at
  ) values (old.project_id, old.session_id, 'delete', datetime('now'));
  insert into briar_project_agent_session_sync_state (
    project_id, current_version
  ) values (old.project_id, last_insert_rowid())
  on conflict (project_id) do update set
    current_version = excluded.current_version;
END;
