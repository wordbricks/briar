alter table briar_issue_messages add column author_agent_provider text
  check (
    author_agent_provider is null
    or author_agent_provider in ('codex', 'claude')
  );
