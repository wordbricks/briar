pragma foreign_keys = on;

create table briar_issue_attachments (
  id text primary key not null,
  run_id text not null references briar_hunt_runs (id) on delete cascade,
  project_id text not null references briar_projects (id) on delete cascade,
  object_key text not null unique check (
    object_key = trim(object_key)
    and length(object_key) between 1 and 500
  ),
  filename text not null check (length(trim(filename)) between 1 and 255),
  content_type text not null check (content_type in (
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
    'video/mp4', 'video/webm', 'video/quicktime'
  )),
  byte_size integer not null check (byte_size between 1 and 20971520),
  created_at text not null
);

create index briar_issue_attachments_run_idx
  on briar_issue_attachments (run_id, created_at, id);

create index briar_issue_attachments_project_idx
  on briar_issue_attachments (project_id, run_id);
