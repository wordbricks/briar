-- Existing profiles used ci_qa as an implicit readiness boundary. Preserve
-- that behavior for existing lanes while making every future lookup profile
-- driven.
alter table briar_merge_queue_profiles
add column readiness_stage_id text not null default 'ci_qa' check (
  readiness_stage_id = trim(readiness_stage_id)
  and length(readiness_stage_id) between 1 and 64
  and readiness_stage_id glob '[a-z]*'
  and readiness_stage_id not glob '*[^a-z0-9_-]*'
);
