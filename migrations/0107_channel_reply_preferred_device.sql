-- Prefer the Worker device that originated a desktop channel mention while
-- preserving nullable compatibility for Web, mobile, webhooks, and old jobs.
alter table briar_channel_agent_reply_jobs add column preferred_device_id text
  references briar_execution_worker_devices (id) on delete set null;

create index briar_channel_agent_reply_jobs_preferred_device_idx
  on briar_channel_agent_reply_jobs (
    preferred_device_id, status, created_at, id
  );
