-- A planned Worker update has a distinct drain lifecycle. The update request
-- remains requested until the newer Worker reports its version, while the
-- handoff state prevents another Worker from claiming during the transition.
alter table briar_execution_worker_update_requests
  add column handoff_state text not null default 'idle'
  check (handoff_state in ('idle', 'draining', 'ready', 'failed'));
alter table briar_execution_worker_update_requests
  add column handoff_started_at text;
alter table briar_execution_worker_update_requests
  add column handoff_completed_at text;
alter table briar_execution_worker_update_requests
  add column handoff_error text;

-- Handoff rows are the immutable, separately queryable audit trail. Raw claim
-- tokens never leave the hash column; metadata is only the resumable provider
-- conversation/workspace checkpoint supplied by the old Worker.
create table briar_execution_worker_update_handoffs (
  id text primary key not null,
  update_request_id text not null
    references briar_execution_worker_update_requests (id) on delete cascade,
  organization_id text not null
    references briar_organizations (id) on delete cascade,
  device_id text not null
    references briar_execution_worker_devices (id) on delete cascade,
  project_id text not null
    references briar_projects (id) on delete cascade,
  worker_id text
    references briar_execution_workers (id) on delete set null,
  work_type text not null check (
    work_type in ('issue', 'projectAgentTask', 'issueReply', 'channelReply')
  ),
  work_id text not null,
  run_id text,
  claim_token_hash text not null check (
    length(claim_token_hash) = 64
    and claim_token_hash not glob '*[^0-9a-f]*'
  ),
  metadata_json text not null default '{}'
    check (json_valid(metadata_json) and json_type(metadata_json) = 'object'),
  status text not null default 'handed_off'
    check (status in ('handed_off', 'failed')),
  created_at text not null,
  updated_at text not null,
  unique (update_request_id, work_type, work_id)
);

create index briar_execution_worker_update_handoffs_device_idx
  on briar_execution_worker_update_handoffs (device_id, updated_at desc);
create index briar_execution_worker_update_handoffs_work_idx
  on briar_execution_worker_update_handoffs (work_type, work_id, updated_at desc);

-- A planned handoff is a continuation, not a retry. Claim code clears this
-- marker atomically with the new lease and therefore increments attempts only
-- for ordinary claims or lease-expiry recovery.
alter table briar_hunt_runs add column planned_update_resume integer not null
  default 0 check (planned_update_resume in (0, 1));
alter table briar_project_agent_task_jobs add column planned_update_resume integer not null
  default 0 check (planned_update_resume in (0, 1));
alter table briar_issue_agent_reply_jobs add column planned_update_resume integer not null
  default 0 check (planned_update_resume in (0, 1));
alter table briar_channel_agent_reply_jobs add column planned_update_resume integer not null
  default 0 check (planned_update_resume in (0, 1));
