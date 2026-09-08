alter table briar_execution_worker_update_requests
  add column requires_runtime_ack integer not null default 0
  check (requires_runtime_ack in (0, 1));

create index if not exists idx_worker_handoff_resume
  on briar_execution_worker_update_handoffs(work_type, work_id, updated_at desc, id desc)
  where status = 'handed_off';

create table briar_worker_update_reservations (
  work_type text not null check (work_type in ('issue', 'projectAgentTask', 'issueReply', 'channelReply', 'mergeBatch', 'dmMemory')),
  work_id text not null,
  device_id text not null references briar_execution_worker_devices(id) on delete cascade,
  request_id text not null references briar_execution_worker_update_requests(id) on delete cascade,
  primary key (work_type, work_id)
);
create index idx_worker_update_reservations_device
  on briar_worker_update_reservations(device_id);

create trigger briar_merge_batches_update_claim_fence
before update of claim_token_hash on briar_merge_batches
when new.claim_token_hash is not null and new.claim_token_hash is not old.claim_token_hash
begin
  select raise(ignore) where exists (
    select 1 from briar_execution_worker_update_requests request
    join briar_execution_workers worker on worker.device_id = request.device_id
    where worker.id = new.claimed_worker_id and request.status = 'requested'
      and request.handoff_state <> 'idle'
  );
  select raise(ignore) where exists (
    select 1 from briar_worker_update_reservations reservation
    where reservation.work_type = 'mergeBatch' and reservation.work_id = new.id
      and reservation.device_id is not (
        select device_id from briar_execution_workers where id = new.claimed_worker_id
      )
  );
  select raise(ignore) where not exists (
    select 1 from briar_worker_update_reservations where work_type = 'mergeBatch' and work_id = new.id
  ) and exists (
    select 1 from briar_worker_update_reservations reservation
    join briar_execution_workers worker on worker.device_id = reservation.device_id
    where worker.id = new.claimed_worker_id
  );
end;

create trigger briar_merge_batches_update_reservation_release
after update of state, claim_token_hash on briar_merge_batches
when (new.claim_token_hash is not null and new.claim_token_hash is not old.claim_token_hash)
  or new.state in ('completed', 'failed', 'blocked')
begin
  delete from briar_worker_update_reservations where work_type = 'mergeBatch' and work_id = new.id;
end;

create trigger briar_dm_memory_jobs_update_claim_fence
before update of lease_token_hash on briar_dm_memory_jobs
when new.lease_token_hash is not null and new.lease_token_hash is not old.lease_token_hash
begin
  select raise(ignore) where exists (
    select 1 from briar_execution_worker_update_requests request
    join briar_execution_workers worker on worker.device_id = request.device_id
    where worker.id = new.claimed_worker_id and request.status = 'requested'
      and request.handoff_state <> 'idle'
  );
  select raise(ignore) where exists (
    select 1 from briar_worker_update_reservations reservation
    where reservation.work_type = 'dmMemory' and reservation.work_id = new.id
      and reservation.device_id is not (
        select device_id from briar_execution_workers where id = new.claimed_worker_id
      )
  );
  select raise(ignore) where not exists (
    select 1 from briar_worker_update_reservations where work_type = 'dmMemory' and work_id = new.id
  ) and exists (
    select 1 from briar_worker_update_reservations reservation
    join briar_execution_workers worker on worker.device_id = reservation.device_id
    where worker.id = new.claimed_worker_id
  );
end;

create trigger briar_dm_memory_jobs_update_reservation_release
after update of status, lease_token_hash on briar_dm_memory_jobs
when (new.lease_token_hash is not null and new.lease_token_hash is not old.lease_token_hash)
  or new.status in ('succeeded', 'no_change', 'failed', 'cancelled')
begin
  delete from briar_worker_update_reservations where work_type = 'dmMemory' and work_id = new.id;
end;


-- Fence the atomic claim too: a claimant may have read readiness before draining began.
create trigger briar_hunt_runs_update_claim_fence
before update of claim_token_hash on briar_hunt_runs
when new.claim_token_hash is not null and new.claim_token_hash is not old.claim_token_hash
begin
  select raise(ignore) where exists (
    select 1 from briar_execution_worker_update_requests request
    join briar_execution_workers worker on worker.device_id = request.device_id
    where worker.id = new.worker_id and request.status = 'requested'
      and request.handoff_state <> 'idle'
  );
  select raise(ignore) where exists (
    select 1 from briar_worker_update_reservations reservation
    where reservation.work_type = 'issue' and reservation.work_id = new.id
      and reservation.device_id is not (
        select device_id from briar_execution_workers where id = new.worker_id
      )
  );
  select raise(ignore) where old.planned_update_resume = 0 and exists (
    select 1 from briar_worker_update_reservations reservation
    join briar_execution_workers worker on worker.device_id = reservation.device_id
    where worker.id = new.worker_id
  );
end;

create trigger briar_hunt_runs_update_reservation_release
after update of status, planned_update_resume on briar_hunt_runs
when new.planned_update_resume = 0 or new.status not in ('queued', 'running')
begin
  delete from briar_worker_update_reservations
    where work_type = 'issue' and work_id = new.id;
end;

-- Fence the atomic claim too: a claimant may have read readiness before draining began.
create trigger briar_project_agent_task_jobs_update_claim_fence
before update of claim_token_hash on briar_project_agent_task_jobs
when new.claim_token_hash is not null and new.claim_token_hash is not old.claim_token_hash
begin
  select raise(ignore) where exists (
    select 1 from briar_execution_worker_update_requests request
    join briar_execution_workers worker on worker.device_id = request.device_id
    where worker.id = new.claimed_worker_id and request.status = 'requested'
      and request.handoff_state <> 'idle'
  );
  select raise(ignore) where exists (
    select 1 from briar_worker_update_reservations reservation
    where reservation.work_type = 'projectAgentTask' and reservation.work_id = new.id
      and reservation.device_id is not (
        select device_id from briar_execution_workers where id = new.claimed_worker_id
      )
  );
  select raise(ignore) where old.planned_update_resume = 0 and exists (
    select 1 from briar_worker_update_reservations reservation
    join briar_execution_workers worker on worker.device_id = reservation.device_id
    where worker.id = new.claimed_worker_id
  );
end;

create trigger briar_project_agent_task_jobs_update_reservation_release
after update of status, planned_update_resume on briar_project_agent_task_jobs
when new.planned_update_resume = 0 or new.status not in ('queued', 'running')
begin
  delete from briar_worker_update_reservations
    where work_type = 'projectAgentTask' and work_id = new.id;
end;

-- Fence the atomic claim too: a claimant may have read readiness before draining began.
create trigger briar_issue_agent_reply_jobs_update_claim_fence
before update of claim_token_hash on briar_issue_agent_reply_jobs
when new.claim_token_hash is not null and new.claim_token_hash is not old.claim_token_hash
begin
  select raise(ignore) where exists (
    select 1 from briar_execution_worker_update_requests request
    join briar_execution_workers worker on worker.device_id = request.device_id
    where worker.id = new.claimed_worker_id and request.status = 'requested'
      and request.handoff_state <> 'idle'
  );
  select raise(ignore) where exists (
    select 1 from briar_worker_update_reservations reservation
    where reservation.work_type = 'issueReply' and reservation.work_id = new.id
      and reservation.device_id is not (
        select device_id from briar_execution_workers where id = new.claimed_worker_id
      )
  );
  select raise(ignore) where old.planned_update_resume = 0 and exists (
    select 1 from briar_worker_update_reservations reservation
    join briar_execution_workers worker on worker.device_id = reservation.device_id
    where worker.id = new.claimed_worker_id
  );
end;

create trigger briar_issue_agent_reply_jobs_update_reservation_release
after update of status, planned_update_resume on briar_issue_agent_reply_jobs
when new.planned_update_resume = 0 or new.status not in ('queued', 'running')
begin
  delete from briar_worker_update_reservations
    where work_type = 'issueReply' and work_id = new.id;
end;

-- Fence the atomic claim too: a claimant may have read readiness before draining began.
create trigger briar_channel_agent_reply_jobs_update_claim_fence
before update of claim_token_hash on briar_channel_agent_reply_jobs
when new.claim_token_hash is not null and new.claim_token_hash is not old.claim_token_hash
begin
  select raise(ignore) where exists (
    select 1 from briar_execution_worker_update_requests request
    join briar_execution_workers worker on worker.device_id = request.device_id
    where worker.id = new.claimed_worker_id and request.status = 'requested'
      and request.handoff_state <> 'idle'
  );
  select raise(ignore) where exists (
    select 1 from briar_worker_update_reservations reservation
    where reservation.work_type = 'channelReply' and reservation.work_id = new.id
      and reservation.device_id is not (
        select device_id from briar_execution_workers where id = new.claimed_worker_id
      )
  );
  select raise(ignore) where old.planned_update_resume = 0 and exists (
    select 1 from briar_worker_update_reservations reservation
    join briar_execution_workers worker on worker.device_id = reservation.device_id
    where worker.id = new.claimed_worker_id
  );
end;

create trigger briar_channel_agent_reply_jobs_update_reservation_release
after update of status, planned_update_resume on briar_channel_agent_reply_jobs
when new.planned_update_resume = 0 or new.status not in ('queued', 'running')
begin
  delete from briar_worker_update_reservations
    where work_type = 'channelReply' and work_id = new.id;
end;
