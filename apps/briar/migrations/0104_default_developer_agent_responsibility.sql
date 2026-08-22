-- Update the default Developer Agent's responsibility so it states that the
-- Agent owns the project's development and code-related work instead of the
-- older issue-processing wording. Only Agents that still carry the exact
-- default copy are touched, so customized responsibilities are preserved.
-- The embedded skill markdown and the issue-processing Skill instructions are
-- updated to match the new responsibility.

update briar_project_agents
set responsibility = 'Owns the project''s development and code-related work.',
    skill_markdown = replace(
      skill_markdown,
      'Process every queued issue.',
      'Owns the project''s development and code-related work.'
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
where name = 'Developer agent'
  and responsibility = 'Process every queued issue.';

update briar_project_agents
set responsibility = '프로젝트의 개발과 코드 관련 작업을 책임집니다.',
    skill_markdown = replace(
      skill_markdown,
      '대기 중인 모든 이슈를 처리합니다.',
      '프로젝트의 개발과 코드 관련 작업을 책임집니다.'
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
where name = '개발자 에이전트'
  and responsibility = '대기 중인 모든 이슈를 처리합니다.';

update briar_project_agents
set responsibility = '负责项目的开发和代码相关工作。',
    skill_markdown = replace(
      skill_markdown,
      '处理所有排队中的问题。',
      '负责项目的开发和代码相关工作。'
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
where name = '开发者智能体'
  and responsibility = '处理所有排队中的问题。';

update briar_agent_skills
set instructions = 'Owns the project''s development and code-related work.',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
where kind = 'issue_processing'
  and instructions = 'Process every queued issue.';

update briar_agent_skills
set instructions = '프로젝트의 개발과 코드 관련 작업을 책임집니다.',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
where kind = 'issue_processing'
  and instructions = '대기 중인 모든 이슈를 처리합니다.';

update briar_agent_skills
set instructions = '负责项目的开发和代码相关工作。',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
where kind = 'issue_processing'
  and instructions = '处理所有排队中的问题。';
