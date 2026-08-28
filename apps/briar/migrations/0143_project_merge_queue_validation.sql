-- Merge queue integration validation belongs to each repository workflow.
-- Existing profiles were tied to Briar's fixed four-context validator, so
-- disable them fail-closed and require an explicit save with a stage-backed
-- validation plan before they can collect another candidate.
alter table briar_merge_queue_profiles
add column validation_commands_json text not null default '[]' check (
  json_valid(validation_commands_json)
  and json_type(validation_commands_json) = 'array'
);

alter table briar_merge_batches
add column validation_commands_json text not null default '[]' check (
  json_valid(validation_commands_json)
  and json_type(validation_commands_json) = 'array'
);

update briar_merge_queue_profiles
set enabled = 0, updated_at = datetime('now')
where enabled = 1;
