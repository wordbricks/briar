pragma foreign_keys = on;

-- Migration 0169 made requestedByUserId mandatory in the strict summary
-- decoder, but legacy summaries created by migration 0093 did not contain the
-- key when their requester was unknown. Add the missing key without inventing
-- ownership. Hot sessions retain their relational requester; archive-only
-- history remains explicitly null.
update briar_project_agent_session_summaries as summary
set summary_json = json_set(
  summary.summary_json,
  '$.requestedByUserId',
  (
    select session.requested_by_user_id
    from briar_project_agent_sessions session
    where session.project_id = summary.project_id
      and session.id = summary.session_id
  )
)
where json_valid(summary.summary_json)
  and json_type(summary.summary_json) = 'object'
  and length(cast(summary.summary_json as blob)) <= 262144
  and json_type(summary.summary_json, '$.requestedByUserId') is null;
