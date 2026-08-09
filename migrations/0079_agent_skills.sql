-- First-class capabilities owned by an Agent. The Agent-level execution
-- settings remain as a compatibility projection; each Agent starts with one
-- concrete default Skill copied from those settings.
create table briar_agent_skills (
  id text primary key not null,
  agent_id text not null
    references briar_project_agents (id) on delete cascade,
  name text not null check (
    name = trim(name) and length(name) between 1 and 100
  ),
  instructions text not null default '' check (length(instructions) <= 10000),
  provider text not null
    check (provider in ('codex', 'claude', 'grok', 'opencode')),
  model text check (
    model is null or (model = trim(model) and length(model) between 1 and 100)
  ),
  effort text check (
    effort is null or effort in ('low', 'medium', 'high', 'xhigh', 'max', 'ultra')
  ),
  kind text not null default 'custom'
    check (kind in ('issue_processing', 'custom')),
  is_default integer not null default 0 check (is_default in (0, 1)),
  position integer not null default 0 check (position >= 0),
  created_at text not null,
  updated_at text not null
);

create unique index briar_agent_skills_name_idx
  on briar_agent_skills (agent_id, name collate nocase);

create unique index briar_agent_skills_default_idx
  on briar_agent_skills (agent_id)
  where is_default = 1;

create index briar_agent_skills_agent_idx
  on briar_agent_skills (agent_id, position, created_at, id);

insert into briar_agent_skills (
  id, agent_id, name, instructions, provider, model, effort, kind,
  is_default, position, created_at, updated_at
)
select
  lower(hex(randomblob(4))) || '-' ||
    lower(hex(randomblob(2))) || '-4' ||
    substr(lower(hex(randomblob(2))), 2) || '-8' ||
    substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6))),
  agent.id,
  case
    when (
      (agent.name = 'Auto Hunt agent'
        and agent.responsibility = 'Perform Auto Hunt for every queued issue.')
      or (agent.name = 'Issue processing agent'
        and agent.responsibility = 'Process every queued issue.')
      or (agent.name = '이슈 처리 에이전트'
        and agent.responsibility = '대기 중인 모든 이슈를 처리합니다.')
      or (agent.name = '자동 사냥 에이전트'
        and agent.responsibility = '모든 대기중인 이슈에 대해서 자동사냥을 수행하는것')
      or (agent.name = '问题处理智能体'
        and agent.responsibility = '处理所有排队中的问题。')
      or (agent.name = '自动狩猎智能体'
        and agent.responsibility = '对所有排队中的问题执行自动狩猎。')
    ) then case
      when agent.name in ('이슈 처리 에이전트', '자동 사냥 에이전트') then '이슈 처리'
      when agent.name in ('问题处理智能体', '自动狩猎智能体') then '问题处理'
      else 'Issue processing'
    end
    else trim(agent.name)
  end,
  agent.responsibility,
  agent.provider,
  agent.model,
  agent.effort,
  case
    when (
      (agent.name = 'Auto Hunt agent'
        and agent.responsibility = 'Perform Auto Hunt for every queued issue.')
      or (agent.name = 'Issue processing agent'
        and agent.responsibility = 'Process every queued issue.')
      or (agent.name = '이슈 처리 에이전트'
        and agent.responsibility = '대기 중인 모든 이슈를 처리합니다.')
      or (agent.name = '자동 사냥 에이전트'
        and agent.responsibility = '모든 대기중인 이슈에 대해서 자동사냥을 수행하는것')
      or (agent.name = '问题处理智能体'
        and agent.responsibility = '处理所有排队中的问题。')
      or (agent.name = '自动狩猎智能体'
        and agent.responsibility = '对所有排队中的问题执行自动狩猎。')
    ) then 'issue_processing'
    else 'custom'
  end,
  1,
  0,
  agent.created_at,
  agent.updated_at
from briar_project_agents agent;

update briar_project_agents
set skill_markdown = replace(
      skill_markdown,
      '# ' || name || char(10),
      '# ' || case
        when name in ('이슈 처리 에이전트', '자동 사냥 에이전트') then '개발자 에이전트'
        when name in ('问题处理智能体', '自动狩猎智能体') then '开发者智能体'
        else 'Developer agent'
      end || char(10)
    ),
    name = case
      when name in ('이슈 처리 에이전트', '자동 사냥 에이전트') then '개발자 에이전트'
      when name in ('问题处理智能体', '自动狩猎智能体') then '开发者智能体'
      else 'Developer agent'
    end,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
where (name = 'Auto Hunt agent'
       and responsibility = 'Perform Auto Hunt for every queued issue.')
   or (name = 'Issue processing agent'
       and responsibility = 'Process every queued issue.')
   or (name = '이슈 처리 에이전트'
       and responsibility = '대기 중인 모든 이슈를 처리합니다.')
   or (name = '자동 사냥 에이전트'
       and responsibility = '모든 대기중인 이슈에 대해서 자동사냥을 수행하는것')
   or (name = '问题处理智能体'
       and responsibility = '处理所有排队中的问题。')
   or (name = '自动狩猎智能体'
       and responsibility = '对所有排队中的问题执行自动狩猎。');
