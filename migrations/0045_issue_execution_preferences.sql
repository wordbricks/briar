alter table briar_hunt_runs add column preferred_agent_provider text
  check (
    preferred_agent_provider is null
    or preferred_agent_provider in ('codex', 'claude', 'grok')
  );

alter table briar_hunt_runs add column preferred_agent_model text
  check (
    preferred_agent_model is null
    or length(trim(preferred_agent_model)) between 1 and 100
  );

alter table briar_hunt_runs add column preferred_agent_effort text
  check (
    preferred_agent_effort is null
    or preferred_agent_effort in ('low', 'medium', 'high', 'xhigh', 'max', 'ultra')
  );

alter table briar_hunt_runs add column requested_agent_model text
  check (
    requested_agent_model is null
    or length(trim(requested_agent_model)) between 1 and 100
  );

alter table briar_hunt_runs add column requested_agent_effort text
  check (
    requested_agent_effort is null
    or requested_agent_effort in ('low', 'medium', 'high', 'xhigh', 'max', 'ultra')
  );
