-- Pin every channel reply claim to the exact project binding that took it.
-- A device may have several project bindings, so device_id alone cannot prove
-- which repository the local worker loop opened for a Project Agent.
alter table briar_channel_agent_reply_jobs add column claimed_worker_id text
  references briar_execution_workers (id) on delete set null;

create index briar_channel_agent_reply_jobs_claimed_worker_idx
  on briar_channel_agent_reply_jobs (claimed_worker_id, status, lease_expires_at);
