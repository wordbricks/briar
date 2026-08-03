-- Project mandatory checkpoints are separated from per-user defaults. A null
-- project value intentionally preserves the workflow's existing checkpoints
-- for lazy v1/v2 upgrade; an explicit [] means fully automatic execution.
alter table briar_project_settings add column mandatory_checkpoints_json text;
alter table briar_project_settings add column checkpoint_policy_revision integer
  not null default 1 check (checkpoint_policy_revision >= 1);

create table briar_user_workflow_checkpoint_defaults (
  project_id text not null references briar_projects(id) on delete cascade,
  user_id text not null references user(id) on delete cascade,
  checkpoints_json text not null default '[]',
  revision integer not null default 1 check (revision >= 1),
  created_at text not null,
  updated_at text not null,
  primary key (project_id, user_id)
);

create index briar_user_workflow_checkpoint_defaults_user_idx
  on briar_user_workflow_checkpoint_defaults (user_id, project_id);
