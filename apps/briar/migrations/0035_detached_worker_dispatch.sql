pragma foreign_keys = on;

-- An Agent is the durable logical actor. A Worker is selected independently
-- for each execution and never belongs to an Agent.
alter table briar_hunt_runs add column agent_id text
  references briar_project_agents (id) on delete set null;
alter table briar_hunt_runs add column requested_worker_id text
  references briar_execution_workers (id) on delete set null;
alter table briar_hunt_runs add column requested_by_user_id text
  references "user" (id) on delete set null;
alter table briar_hunt_runs add column dispatch_mode text
  check (dispatch_mode in ('any', 'specific'));
alter table briar_hunt_runs add column dispatch_request_id text;
alter table briar_hunt_runs add column dispatched_at text;

create unique index briar_hunt_runs_dispatch_request_idx
  on briar_hunt_runs (project_id, dispatch_request_id)
  where dispatch_request_id is not null;

create index briar_hunt_runs_dispatch_queue_idx
  on briar_hunt_runs (
    project_id, status, requested_worker_id, agent_id, dispatched_at
  );

-- Readiness is project-binding state because a machine can have a healthy
-- agent installation for one project and a broken repository for another.
alter table briar_execution_workers add column accepting_work integer
  not null default 1 check (accepting_work in (0, 1));
alter table briar_execution_workers add column readiness_state text
  not null default 'ready'
  check (readiness_state in ('ready', 'busy', 'needs_attention'));
alter table briar_execution_workers add column readiness_detail text;
alter table briar_execution_workers add column capabilities_json text
  not null default '{}' check (
    json_valid(capabilities_json)
    and json_type(capabilities_json) = 'object'
  );

-- Security-sensitive execution changes are retained separately from the
-- user-facing run timeline.
create table briar_execution_audit_events (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  project_id text not null references briar_projects (id) on delete cascade,
  run_id text references briar_hunt_runs (id) on delete cascade,
  worker_id text references briar_execution_workers (id) on delete set null,
  agent_id text references briar_project_agents (id) on delete set null,
  actor_user_id text references "user" (id) on delete set null,
  actor_device_id text
    references briar_execution_worker_devices (id) on delete set null,
  action text not null check (
    action in (
      'dispatched', 'reassigned', 'claimed', 'lease_lost', 'cancelled',
      'requeued', 'blocked', 'completed', 'worker_readiness_changed'
    )
  ),
  request_id text,
  detail_json text not null default '{}' check (
    json_valid(detail_json) and json_type(detail_json) = 'object'
  ),
  occurred_at text not null
);

create unique index briar_execution_audit_request_idx
  on briar_execution_audit_events (project_id, action, request_id)
  where request_id is not null;

create index briar_execution_audit_project_idx
  on briar_execution_audit_events (project_id, occurred_at desc, id);
