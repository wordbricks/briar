-- Preserve the selected Skill on direct Agent tasks and channel replies. These
-- job tables were introduced independently, so their references follow the
-- Agent Skill schema migration.
alter table briar_project_agent_task_jobs
  add column skill_id text
    references briar_agent_skills (id) on delete set null;

create index briar_project_agent_task_jobs_skill_idx
  on briar_project_agent_task_jobs (skill_id, status, created_at);

alter table briar_channel_agent_reply_jobs
  add column skill_id text
    references briar_agent_skills (id) on delete set null;

create index briar_channel_agent_reply_jobs_skill_idx
  on briar_channel_agent_reply_jobs (skill_id, status, created_at);
