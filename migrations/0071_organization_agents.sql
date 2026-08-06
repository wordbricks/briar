-- Promote saved Agents from project-scoped to organization-scoped identities.
-- An Agent with a null project_id belongs to the organization and has no
-- repository: it handles conversation, planning, and routing work. Agents that
-- keep a project_id behave exactly as before.
--
-- SQLite cannot drop a NOT NULL constraint in place, so the table is rebuilt.
-- D1 runs migrations inside an implicit transaction, so foreign_keys cannot be
-- toggled here; defer validation while the table is swapped.
pragma defer_foreign_keys = on;

create table briar_project_agents_new (
  id text primary key not null,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  -- Null means an organization Agent with no repository context.
  project_id text references briar_projects (id) on delete cascade,
  -- Mention handle, unique per organization. Assigned by the API on write.
  handle text check (
    handle is null
    or (
      length(handle) between 1 and 63
      and handle not glob '*[^a-z0-9-]*'
    )
  ),
  name text not null check (length(trim(name)) between 1 and 100),
  provider text not null
    check (provider in ('codex', 'claude', 'grok', 'opencode')),
  model text check (
    model is null or (model = trim(model) and length(model) between 1 and 100)
  ),
  responsibility text not null check (
    responsibility = trim(responsibility)
    and length(responsibility) between 1 and 2000
  ),
  created_at text not null,
  updated_at text not null,
  calendar_color text not null default '#3275d5'
    check (length(calendar_color) = 7 and substr(calendar_color, 1, 1) = '#'),
  skill_markdown text not null default '' check (length(skill_markdown) <= 10000),
  avatar text check (
    avatar is null or (
      length(avatar) <= 400000 and (
        substr(avatar, 1, 22) = 'data:image/png;base64,'
        or substr(avatar, 1, 23) = 'data:image/jpeg;base64,'
        or substr(avatar, 1, 23) = 'data:image/webp;base64,'
      )
    )
  ),
  avatar_pet_json text check (
    avatar_pet_json is null or (
      length(avatar_pet_json) <= 4000 and json_valid(avatar_pet_json)
    )
  ),
  avatar_spritesheet_object_key text check (
    avatar_spritesheet_object_key is null or (
      length(avatar_spritesheet_object_key) <= 1000
      and avatar_spritesheet_object_key like 'project-agent-spritesheets/%'
    )
  ),
  effort text check (
    effort is null or effort in ('low', 'medium', 'high', 'xhigh', 'max', 'ultra')
  )
);

-- Existing Agents keep their project and inherit that project's organization.
-- Handles use the same id-derived default as organization handles in 0012:
-- deterministic, always valid, and renamed from the UI afterwards.
insert into briar_project_agents_new (
  id, organization_id, project_id, handle, name, provider, model,
  responsibility, created_at, updated_at, calendar_color, skill_markdown,
  avatar, avatar_pet_json, avatar_spritesheet_object_key, effort
)
select agent.id, project.organization_id, agent.project_id,
       'agent-' || lower(replace(agent.id, '-', '')),
       agent.name, agent.provider, agent.model, agent.responsibility,
       agent.created_at, agent.updated_at, agent.calendar_color,
       agent.skill_markdown, agent.avatar, agent.avatar_pet_json,
       agent.avatar_spritesheet_object_key, agent.effort
from briar_project_agents agent
join briar_projects project on project.id = agent.project_id;

drop table briar_project_agents;
alter table briar_project_agents_new rename to briar_project_agents;

create index briar_project_agents_project_idx
  on briar_project_agents (project_id, created_at, id);

create index briar_project_agents_organization_idx
  on briar_project_agents (organization_id, created_at, id);

create unique index briar_project_agents_handle_idx
  on briar_project_agents (organization_id, handle)
  where handle is not null;

pragma defer_foreign_keys = off;
