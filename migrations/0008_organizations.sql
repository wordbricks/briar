pragma foreign_keys = on;

create table briar_organizations (
  id text primary key not null,
  name text not null check (length(trim(name)) between 1 and 100),
  created_at text not null,
  updated_at text not null
);

create table briar_organization_members (
  organization_id text not null references briar_organizations (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at text not null,
  updated_at text not null,
  primary key (organization_id, user_id)
);

insert into briar_organizations (id, name, created_at, updated_at)
select min(project.id), coalesce(nullif(trim(owner.name), ''), owner.email) || '의 조직',
       min(project.created_at), max(project.updated_at)
from briar_projects project
join "user" owner on owner.id = project.owner_user_id
group by project.owner_user_id;

insert into briar_organization_members (organization_id, user_id, role, created_at, updated_at)
select min(id), owner_user_id, 'owner', min(created_at), max(updated_at)
from briar_projects
group by owner_user_id;

alter table briar_projects add column organization_id text
  references briar_organizations (id) on delete cascade;

update briar_projects
set organization_id = (
  select min(owner_project.id)
  from briar_projects owner_project
  where owner_project.owner_user_id = briar_projects.owner_user_id
);

create index briar_organization_members_user_idx
  on briar_organization_members (user_id, organization_id);
create index briar_projects_organization_idx
  on briar_projects (organization_id, created_at);
