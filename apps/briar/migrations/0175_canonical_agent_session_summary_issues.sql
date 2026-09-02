pragma foreign_keys = on;

-- Historical summaries retained full issue text, while the canonical summary
-- contract keeps only issue identity and outcome. Migration 0169 did not strip
-- that legacy field, so one old row could make the whole summary snapshot fail
-- strict decoding. Preserve the full hot/archive payloads and null only the
-- lightweight summary projection.
update briar_project_agent_session_summaries as summary
set summary_json = json_set(
  summary.summary_json,
  '$.issues',
  (
    select json_group_array(json(canonical.issue_json))
    from (
      select json_set(issue.value, '$.summary', null) as issue_json
      from json_each(summary.summary_json, '$.issues') issue
      order by cast(issue.key as integer)
    ) canonical
  )
)
where json_valid(summary.summary_json)
  and json_type(summary.summary_json) = 'object'
  and length(cast(summary.summary_json as blob)) <= 262144
  and json_type(summary.summary_json, '$.issues') = 'array'
  and exists (
    select 1
    from json_each(summary.summary_json, '$.issues') issue
    where json_type(issue.value) = 'object'
      and json_type(issue.value, '$.summary') is not 'null'
  );
