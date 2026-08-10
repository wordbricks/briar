-- Stable keyset traversal for an Organization Agent's project catalog.
create index briar_projects_organization_context_idx
  on briar_projects (organization_id, created_at, id);

-- Project issue pages are ordered by their immutable, user-visible number.
create index briar_hunt_runs_project_run_number_idx
  on briar_hunt_runs (project_id, run_number);

-- Session timestamps come from syncing clients and may use offsets or arrive
-- late. Record the first server-visible instant separately so a claimed
-- Organization Agent snapshot has stable membership across pagination and
-- hot-to-archive transitions.
create table briar_project_agent_session_context_membership (
  project_id text not null
    references briar_projects (id) on delete cascade,
  session_id text not null,
  visible_at text not null,
  primary key (project_id, session_id)
);

insert or ignore into briar_project_agent_session_context_membership (
  project_id, session_id, visible_at
)
select project_id, id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
from briar_project_agent_sessions;

insert or ignore into briar_project_agent_session_context_membership (
  project_id, session_id, visible_at
)
select project_id, scope_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
from briar_log_archives
where archive_kind = 'project_agent_sessions'
  and status in ('verified', 'complete');

create index briar_project_agent_session_context_visible_idx
  on briar_project_agent_session_context_membership (
    project_id, visible_at, session_id
  );

-- Only verified or complete project-session archives are readable context.
-- Keeping this partial index separate avoids unrelated archive manifests.
create index briar_log_archives_project_sessions_idx
  on briar_log_archives (project_id, scope_id, period_end, id)
  where archive_kind = 'project_agent_sessions'
    and status in ('verified', 'complete');
