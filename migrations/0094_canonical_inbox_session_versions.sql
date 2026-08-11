-- Session summaries historically used either a terminal-event UUID or a
-- status/timestamp fallback as their Inbox version. Normalize both the
-- summaries and account read state so polling cannot alternate between two
-- versions for the same terminal session.
update briar_project_agent_session_summaries
set summary_json = json_set(
  summary_json,
  '$.inboxVersion',
  'session:v1:' || json_extract(summary_json, '$.status') || ':' ||
    coalesce(
      json_extract(summary_json, '$.completedAt'),
      json_extract(summary_json, '$.startedAt'),
      updated_at
    )
)
where json_extract(summary_json, '$.status') in ('completed', 'failed');

update briar_inbox_read_states
set version = (
  select json_extract(summary.summary_json, '$.inboxVersion')
  from briar_project_agent_session_summaries as summary
  where briar_inbox_read_states.message_id = 'session:' || summary.session_id
  limit 1
)
where message_id like 'session:%'
  and exists (
    select 1
    from briar_project_agent_session_summaries as summary
    where briar_inbox_read_states.message_id = 'session:' || summary.session_id
      and json_extract(summary.summary_json, '$.status') in ('completed', 'failed')
  );
