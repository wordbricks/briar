pragma foreign_keys = on;

create table briar_run_evidence_images (
  id text primary key not null,
  project_id text not null references briar_projects (id) on delete cascade,
  run_id text not null references briar_hunt_runs (id) on delete cascade,
  evidence_id text not null references briar_run_evidence (id) on delete cascade,
  object_key text not null unique check (
    object_key = trim(object_key)
    and length(object_key) between 1 and 500
  ),
  filename text not null check (length(trim(filename)) between 1 and 255),
  content_type text not null check (content_type in (
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'
  )),
  byte_size integer not null check (byte_size between 1 and 20971520),
  sha256 text not null check (
    length(sha256) = 64 and sha256 not glob '*[^0-9a-f]*'
  ),
  position integer not null check (position between 0 and 4),
  created_at text not null,
  unique (evidence_id, position),
  unique (evidence_id, sha256)
);

create index briar_run_evidence_images_evidence_idx
  on briar_run_evidence_images (evidence_id, position, id);

create index briar_run_evidence_images_project_run_idx
  on briar_run_evidence_images (project_id, run_id);
