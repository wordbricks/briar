-- Cancellation of a running Project Agent task is recorded on the job row.
-- `status` keeps its queued/running/completed/failed check constraint, so a
-- cancelled task is a `failed` job that also carries `cancel_requested_at`.
alter table briar_project_agent_task_jobs
  add column cancel_requested_at text;

alter table briar_project_agent_task_jobs
  add column cancelled_by_user_id text;

-- Planned Worker updates re-claim the same job without spending an attempt, so
-- resumes need their own counter for transcript sequence scoping.
alter table briar_project_agent_task_jobs
  add column resume_count integer not null default 0 check (resume_count >= 0);
