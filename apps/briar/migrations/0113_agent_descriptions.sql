-- Add short Agent metadata for discovery and routing without changing the
-- execution responsibility prompt.

alter table briar_project_agents
add column description text not null default '' check (
  description = trim(description)
  and length(description) <= 500
);
