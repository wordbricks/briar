alter table briar_project_agents
  add column kind text not null default 'custom'
  check (kind in ('auto_hunt', 'custom'));

insert into briar_project_agents (
  id, project_id, name, provider, model, responsibility, created_at, updated_at, kind
)
select
  lower(hex(randomblob(4))) || '-' ||
    lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-8' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6))),
  project.id,
  'Auto Hunt agent',
  'codex',
  null,
  'Perform Auto Hunt for every queued issue.',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  'auto_hunt'
from briar_projects project
where not exists (
  select 1
  from briar_project_agents agent
  where agent.project_id = project.id
    and agent.kind = 'auto_hunt'
);
