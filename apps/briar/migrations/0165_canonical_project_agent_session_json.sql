pragma foreign_keys = on;

-- Project Agent sessions are operational state, not durable user data. Drop
-- every legacy document rather than teaching SQL a second copy of the Effect
-- schema or guessing defaults for historic payloads.
delete from briar_project_agent_session_summaries;
-- Summary deletion deliberately advances the organization Inbox revision so
-- connected clients refetch the now-empty session feed. Its per-project
-- tombstones and cursor are obsolete after this no-compatibility cutover.
delete from briar_project_agent_session_changes;
delete from briar_project_agent_session_sync_state;
delete from briar_inbox_read_states where message_id like 'session:%';
delete from briar_project_agent_session_context_membership;
delete from briar_project_agent_sessions;

-- The application supplies one Effect-encoded payload while accepting a task
-- proposal. The materializer consumes it in the same statement and clears the
-- transient value; D1 never maintains a second session document.
alter table briar_agent_skill_execution_proposals
  add column materialized_session_payload_json text;

-- SQL validates only its relational projection and storage envelope. The
-- Effect JsonString decoder remains the sole field-level contract.
create view briar_invalid_project_agent_session_payload as
select session.project_id, session.id
from briar_project_agent_sessions session
where case
  when length(cast(session.payload_json as blob)) > 1048576 then 1
  when not json_valid(session.payload_json) then 1
  when json_type(session.payload_json) <> 'object' then 1
  else
    coalesce(
      json_extract(session.payload_json, '$.agentId') is not session.agent_id,
      1
    )
    or coalesce(
      json_extract(session.payload_json, '$.status') is not session.status,
      1
    )
    or coalesce(
      json_extract(session.payload_json, '$.sessionType')
        is not session.session_type,
      1
    )
    or coalesce(
      json_extract(session.payload_json, '$.startedAt')
        is not session.started_at,
      1
    )
    or json_extract(session.payload_json, '$.completedAt')
      is not session.completed_at
    or coalesce(
      json_extract(session.payload_json, '$.updatedAt')
        is not session.updated_at,
      1
    )
    or json_extract(session.payload_json, '$.requestedByUserId')
      is not session.requested_by_user_id
end;

create view briar_invalid_project_agent_session_summary as
select summary.project_id, summary.session_id
from briar_project_agent_session_summaries summary
where case
  when length(cast(summary.summary_json as blob)) > 262144 then 1
  when not json_valid(summary.summary_json) then 1
  when json_type(summary.summary_json) <> 'object' then 1
  else
    coalesce(
      json_extract(summary.summary_json, '$.updatedAt')
        is not summary.updated_at,
      1
    )
    or coalesce(
      json_type(summary.summary_json, '$.requestedByUserId')
        not in ('null', 'text'),
      1
    )
end;

create trigger briar_project_agent_session_payload_insert_guard
after insert on briar_project_agent_sessions
when exists (
  select 1 from briar_invalid_project_agent_session_payload invalid
  where invalid.project_id = new.project_id and invalid.id = new.id
)
begin
  select raise(abort, 'invalid stored project Agent session payload');
end;

create trigger briar_project_agent_session_payload_update_guard
after update of payload_json, agent_id, status, session_type,
  started_at, completed_at, updated_at, requested_by_user_id
on briar_project_agent_sessions
when exists (
  select 1 from briar_invalid_project_agent_session_payload invalid
  where invalid.project_id = new.project_id and invalid.id = new.id
)
begin
  select raise(abort, 'invalid stored project Agent session payload');
end;

create trigger briar_project_agent_session_summary_insert_guard
after insert on briar_project_agent_session_summaries
when exists (
  select 1 from briar_invalid_project_agent_session_summary invalid
  where invalid.project_id = new.project_id
    and invalid.session_id = new.session_id
)
begin
  select raise(abort, 'invalid stored project Agent session summary');
end;

create trigger briar_project_agent_session_summary_update_guard
after update of summary_json, updated_at
on briar_project_agent_session_summaries
when exists (
  select 1 from briar_invalid_project_agent_session_summary invalid
  where invalid.project_id = new.project_id
    and invalid.session_id = new.session_id
)
begin
  select raise(abort, 'invalid stored project Agent session summary');
end;

create trigger briar_agent_skill_execution_payload_insert_guard
before insert on briar_agent_skill_execution_proposals
when new.materialized_session_payload_json is not null
begin
  select raise(abort, 'Agent Skill session payload is transient');
end;

create trigger briar_agent_skill_execution_payload_update_guard
before update of status, materialized_session_payload_json
on briar_agent_skill_execution_proposals
when not (
  new.materialized_session_payload_json is old.materialized_session_payload_json
  or (
    old.status = 'pending' and new.status = 'accepted'
    and new.execution_mode = 'task'
    and old.materialized_session_payload_json is null
    and new.materialized_session_payload_json is not null
  )
  or (
    old.status = 'accepted' and new.status = 'accepted'
    and new.execution_mode = 'task'
    and old.materialized_session_payload_json is not null
    and new.materialized_session_payload_json is null
    and exists (
      select 1 from briar_project_agent_sessions session
      where session.project_id = new.project_id
        and session.id = new.result_session_id
    )
  )
)
begin
  select raise(abort, 'invalid Agent Skill session payload transition');
end;

-- Cross-row bindings used by task claims stay protected in D1. Field-level
-- structure belongs only to the Effect encoder and strict readers; the D1
-- guards below enforce the storage envelope and relational projection.
create trigger briar_agent_skill_execution_payload_accept_guard
before update of status on briar_agent_skill_execution_proposals
when old.status = 'pending' and new.status = 'accepted' and (
  (new.execution_mode = 'conversation'
    and new.materialized_session_payload_json is not null)
  or
  (new.execution_mode = 'task' and case
    when new.materialized_session_payload_json is null then 1
    when length(cast(new.materialized_session_payload_json as blob)) > 1048576
      then 1
    when not json_valid(new.materialized_session_payload_json) then 1
    when json_type(new.materialized_session_payload_json) <> 'object' then 1
    else not (
      json_extract(new.materialized_session_payload_json, '$.dispatchGroupId')
        is new.result_session_id
      and json_extract(new.materialized_session_payload_json, '$.agentName')
        is new.agent_name
      and json_extract(new.materialized_session_payload_json, '$.skillId')
        is new.skill_id
      and json_extract(new.materialized_session_payload_json, '$.trigger')
        = 'manual'
      and json_extract(new.materialized_session_payload_json, '$.request')
        is new.request
      and json_extract(
        new.materialized_session_payload_json, '$.requestedWorkerId'
      ) is new.requested_worker_id
      and json_extract(new.materialized_session_payload_json, '$.workerId')
        is new.requested_worker_id
    )
  end)
)
begin
  select raise(abort, 'invalid materialized Agent Skill session payload');
end;

drop trigger briar_agent_skill_execution_materialize;

create trigger briar_agent_skill_execution_materialize
after update of status on briar_agent_skill_execution_proposals
when old.status = 'pending' and new.status = 'accepted'
  and new.execution_mode = 'task'
begin
  insert into briar_project_agent_task_jobs (
    id, project_id, agent_id, skill_id, request, request_id, status,
    preferred_worker_id, skill_execution_proposal_id, created_at, updated_at
  ) values (
    new.result_session_id, new.project_id, new.agent_id, new.skill_id,
    new.request, new.id, 'queued', new.requested_worker_id, new.id,
    new.accepted_at, new.accepted_at
  );

  insert into briar_project_agent_session_context_membership (
    project_id, session_id, visible_at
  ) values (new.project_id, new.result_session_id, new.accepted_at);

  insert into briar_project_agent_sessions (
    project_id, id, agent_id, status, session_type, payload_json,
    started_at, completed_at, updated_at, requested_by_user_id
  ) values (
    new.project_id, new.result_session_id, new.agent_id, 'running', 'task',
    new.materialized_session_payload_json,
    new.accepted_at, null, new.accepted_at, new.accepted_by_user_id
  );

  insert into briar_agent_skill_execution_approval_audit (
    id, proposal_id, organization_id, project_id, source_kind, channel_id,
    conversation_run_id, trigger_message_id, reply_message_id,
    source_reply_job_id, delegated_by_reply_job_id, agent_id, agent_name,
    agent_responsibility, skill_id, skill_name, skill_instructions, skill_kind,
    provider, model, effort, request, worker_id, worker_label,
    result_session_id, approved_by_user_id, approved_at,
    delegated_by_agent_id, delegated_by_agent_name, created_at,
    execution_mode, approval_policy, thread_root_message_id,
    result_reply_job_id, result_message_id
  ) values (
    new.id || ':approval:' || new.generation, new.id, new.organization_id,
    new.project_id, new.source_kind, new.channel_id, new.conversation_run_id,
    new.trigger_message_id, new.reply_message_id, new.source_reply_job_id,
    new.delegated_by_reply_job_id, new.agent_id, new.agent_name,
    new.agent_responsibility, new.skill_id, new.skill_name,
    new.skill_instructions, new.skill_kind, new.provider, new.model,
    new.effort, new.request, new.requested_worker_id,
    new.requested_worker_label, new.result_session_id,
    new.accepted_by_user_id, new.accepted_at, new.delegated_by_agent_id,
    new.delegated_by_agent_name, new.accepted_at, new.execution_mode,
    new.approval_policy, new.thread_root_message_id, new.result_reply_job_id,
    new.result_message_id
  );

  update briar_agent_skill_execution_proposals
  set materialized_session_payload_json = null
  where id = new.id and materialized_session_payload_json is not null;
end;
