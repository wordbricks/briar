-- Agent runs now select a Skill explicitly. Preserve the old implicit choice
-- only for work that can still be claimed, then retire the default marker.
update briar_project_agent_task_jobs
set skill_id = (
  select skill.id
  from briar_agent_skills skill
  where skill.agent_id = briar_project_agent_task_jobs.agent_id
    and skill.is_default = 1
  order by skill.position, skill.created_at, skill.id
  limit 1
)
where skill_id is null
  and status in ('queued', 'running');

update briar_channel_agent_reply_jobs
set skill_id = (
  select skill.id
  from briar_agent_skills skill
  where skill.agent_id = briar_channel_agent_reply_jobs.agent_id
    and skill.is_default = 1
  order by skill.position, skill.created_at, skill.id
  limit 1
)
where skill_id is null
  and status in ('queued', 'running');

drop index if exists briar_agent_skills_default_idx;

-- Keep the column for a safe forward-only SQLite migration. New code does not
-- expose or consult it, and all future writes store zero.
update briar_agent_skills
set is_default = 0
where is_default != 0;
