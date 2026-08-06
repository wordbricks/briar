-- Per-issue checkpoints are additive to the project/user checkpoint policy
-- already frozen into each run's workflow snapshot.
alter table briar_hunt_runs add column issue_checkpoints_json text
  not null default '[]' check (
    json_valid(issue_checkpoints_json)
    and json_type(issue_checkpoints_json) = 'array'
  );
