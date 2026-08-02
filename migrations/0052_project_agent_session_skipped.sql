-- A scheduled Auto Hunt with no queued issues is a successful no-op rather
-- than a failure. Persist that distinction in synchronized Agent sessions.

drop index briar_project_agent_sessions_recent_idx;

alter table briar_project_agent_sessions add column status_with_skipped text
  not null default 'running'
  check (status_with_skipped in (
    'running', 'completed', 'failed', 'skipped', 'interrupted'
  ));
update briar_project_agent_sessions set status_with_skipped = status;
alter table briar_project_agent_sessions drop column status;
alter table briar_project_agent_sessions rename column status_with_skipped to status;

create index briar_project_agent_sessions_recent_idx
  on briar_project_agent_sessions (project_id, updated_at desc, id);
