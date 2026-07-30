alter table briar_hunt_runs add column requested_agent_provider text
  check (
    requested_agent_provider is null
    or requested_agent_provider in ('codex', 'claude', 'grok')
  );
