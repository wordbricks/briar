alter table briar_hunt_runs add column claim_token_hash text
  check (claim_token_hash is null or (
    length(claim_token_hash) = 64
    and claim_token_hash not glob '*[^0-9a-f]*'
  ));
alter table briar_hunt_runs add column claimed_by text
  check (claimed_by is null or length(trim(claimed_by)) between 1 and 128);
alter table briar_hunt_runs add column claimed_at text;
alter table briar_hunt_runs add column lease_expires_at text;
alter table briar_hunt_runs add column claim_attempts integer not null default 0
  check (claim_attempts >= 0);

create index briar_hunt_runs_queue_claim_idx
  on briar_hunt_runs (
    project_id,
    priority,
    source_created_at,
    lease_expires_at
  )
  where stage = 'queued';
