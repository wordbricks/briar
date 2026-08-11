pragma foreign_keys = on;

-- Organization Agents can hand one project-specific channel question to a
-- Project Agent that is already present in the channel. The child remains an
-- ordinary read-only channel reply job, while this link preserves provenance
-- and makes recursion impossible to authorize accidentally.
alter table briar_channel_agent_reply_jobs
  add column delegated_by_reply_job_id text
    references briar_channel_agent_reply_jobs (id) on delete cascade;

alter table briar_channel_agent_reply_jobs
  add column delegation_request text check (
    (delegated_by_reply_job_id is null and delegation_request is null)
    or (
      delegated_by_reply_job_id is not null
      and delegation_request is not null
      and length(delegation_request) between 1 and 10000
    )
  );

-- `skill_id` is an ON DELETE SET NULL reference. Keep the original selection
-- separately so deleting or changing a selected Skill cannot silently fall
-- back to the Agent's base runtime for an already authorized reply.
alter table briar_channel_agent_reply_jobs
  add column selected_skill_id_snapshot text check (
    selected_skill_id_snapshot is null
    or length(selected_skill_id_snapshot) = 36
  );

update briar_channel_agent_reply_jobs
set selected_skill_id_snapshot = skill_id
where skill_id is not null and status in ('queued', 'running');

-- Keep rolling deploys compatible with an older API writer that knows only
-- `skill_id`. Once populated, the snapshot deliberately survives Skill
-- deletion or reassignment.
--> statement-breakpoint
create trigger briar_channel_reply_skill_snapshot_insert
after insert on briar_channel_agent_reply_jobs
when new.skill_id is not null and new.selected_skill_id_snapshot is null
begin
  update briar_channel_agent_reply_jobs
  set selected_skill_id_snapshot = new.skill_id
  where id = new.id;
end;

--> statement-breakpoint
create trigger briar_channel_reply_skill_snapshot_update
after update of skill_id on briar_channel_agent_reply_jobs
when new.skill_id is not null and new.selected_skill_id_snapshot is null
begin
  update briar_channel_agent_reply_jobs
  set selected_skill_id_snapshot = new.skill_id
  where id = new.id;
end;

--> statement-breakpoint
create unique index briar_channel_agent_reply_jobs_delegation_target_idx
  on briar_channel_agent_reply_jobs (delegated_by_reply_job_id, agent_id)
  where delegated_by_reply_job_id is not null;

create index briar_channel_agent_reply_jobs_delegation_parent_idx
  on briar_channel_agent_reply_jobs (
    delegated_by_reply_job_id, status, created_at, id
  );
