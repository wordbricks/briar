create unique index briar_projects_id_organization_unique
  on briar_projects (id, organization_id);

create table briar_project_members (
  project_id text not null,
  organization_id text not null,
  user_id text not null,
  created_at text not null,
  updated_at text not null,
  primary key (project_id, user_id),
  foreign key (project_id, organization_id)
    references briar_projects (id, organization_id) on delete cascade,
  foreign key (organization_id, user_id)
    references briar_organization_members (organization_id, user_id)
    on delete cascade
);

create index briar_project_members_user_idx
  on briar_project_members (user_id, project_id);

insert into briar_project_members (
  project_id, organization_id, user_id, created_at, updated_at
)
select project.id, project.organization_id, member.user_id,
       case
         when project.created_at > member.created_at then project.created_at
         else member.created_at
       end,
       case
         when project.updated_at > member.updated_at then project.updated_at
         else member.updated_at
       end
from briar_projects project
join briar_organization_members member
  on member.organization_id = project.organization_id;

create trigger briar_project_members_insert_sync
after insert on briar_project_members BEGIN
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, 1)
  on conflict (project_id) do update set
    current_version = briar_dashboard_sync_state.current_version + 1;
END;

create trigger briar_project_members_delete_sync
before delete on briar_project_members BEGIN
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (old.project_id, 1)
  on conflict (project_id) do update set
    current_version = briar_dashboard_sync_state.current_version + 1;
END;
