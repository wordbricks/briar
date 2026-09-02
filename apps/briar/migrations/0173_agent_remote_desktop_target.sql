alter table briar_managed_computer_remote_sessions
  add column agent_id text check (
    agent_id is null or length(trim(agent_id)) between 1 and 256
  );
