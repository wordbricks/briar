create table briar_run_evidence (
  id text primary key,
  project_id text not null references briar_projects(id) on delete cascade,
  run_id text not null references briar_hunt_runs(id) on delete cascade,
  attempt integer not null,
  evidence_key text not null,
  workflow_stage text not null,
  evidence_type text not null,
  status text not null check (status in ('pending', 'passed', 'failed', 'skipped')),
  detail text,
  command text,
  url text,
  metadata_json text check (
    metadata_json is null or (
      json_valid(metadata_json) and json_type(metadata_json) = 'object'
    )
  ),
  actor text not null,
  observed_at text not null,
  recorded_at text not null,
  unique (run_id, attempt, evidence_key)
);

create index briar_run_evidence_run_attempt
  on briar_run_evidence (run_id, attempt, workflow_stage, evidence_type);
