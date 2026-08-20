-- Route terminal Agent Session Inbox messages only to the member who requested
-- the execution. Unknown legacy ownership remains null and is intentionally
-- excluded from the organization Inbox.

alter table briar_project_agent_sessions
  add column requested_by_user_id text
  references "user" (id) on delete set null;

alter table briar_project_agent_schedules
  add column created_by_user_id text
  references "user" (id) on delete set null;

-- Accepted Agent Skill executions already have an immutable approval audit, so
-- their trusted requester can be recovered without guessing.
update briar_project_agent_sessions as session
set requested_by_user_id = (
      select approval.approved_by_user_id
      from briar_agent_skill_execution_approval_audit approval
      where approval.project_id = session.project_id
        and approval.result_session_id = session.id
    ),
    payload_json = json_set(
      payload_json,
      '$.requestedByUserId',
      (
        select approval.approved_by_user_id
        from briar_agent_skill_execution_approval_audit approval
        where approval.project_id = session.project_id
          and approval.result_session_id = session.id
      )
    )
where json_valid(payload_json)
  and requested_by_user_id is null
  and exists (
    select 1
    from briar_agent_skill_execution_approval_audit approval
    where approval.project_id = session.project_id
      and approval.result_session_id = session.id
      and approval.approved_by_user_id is not null
  );

update briar_project_agent_session_summaries as summary
set summary_json = json_set(
      summary_json,
      '$.requestedByUserId',
      (
        select approval.approved_by_user_id
        from briar_agent_skill_execution_approval_audit approval
        where approval.project_id = summary.project_id
          and approval.result_session_id = summary.session_id
      )
    )
where json_valid(summary_json)
  and exists (
    select 1
    from briar_agent_skill_execution_approval_audit approval
    where approval.project_id = summary.project_id
      and approval.result_session_id = summary.session_id
      and approval.approved_by_user_id is not null
      and json_extract(summary.summary_json, '$.requestedByUserId')
        is not approval.approved_by_user_id
  );

create index briar_project_agent_session_summaries_requester_recent_idx
  on briar_project_agent_session_summaries (
    project_id,
    json_extract(summary_json, '$.requestedByUserId'),
    updated_at desc,
    session_id
  );

-- Recreate the acceptance materializer so new approved executions persist the
-- approver as the trusted requester at the same time as the session is born.
drop trigger briar_agent_skill_execution_materialize;

create trigger briar_agent_skill_execution_materialize
after update of status on briar_agent_skill_execution_proposals
when old.status = 'pending' and new.status = 'accepted'
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
    json_object(
      'dispatchGroupId', new.result_session_id,
      'agentId', new.agent_id,
      'agentName', new.agent_name,
      'skillId', new.skill_id,
      'sessionType', 'task',
      'trigger', 'manual',
      'scheduleId', null,
      'scheduleRunId', null,
      'parentSessionId', null,
      'request', new.request,
      'followUps', json('[]'),
      'status', 'running',
      'issues', json('[]'),
      'startedAt', new.accepted_at,
      'completedAt', null,
      'conversationId', null,
      'requestedWorkerId', new.requested_worker_id,
      'workerId', new.requested_worker_id,
      'requestedByUserId', new.accepted_by_user_id,
      'summary', null,
      'error', null,
      'events', json_array(json_object(
        'id', lower(hex(randomblob(16))),
        'type', 'started',
        'occurredAt', new.accepted_at
      )),
      'updatedAt', new.accepted_at
    ),
    new.accepted_at, null, new.accepted_at, new.accepted_by_user_id
  );

  insert into briar_agent_skill_execution_approval_audit (
    id, proposal_id, organization_id, project_id, source_kind, channel_id,
    conversation_run_id, trigger_message_id, reply_message_id,
    source_reply_job_id, delegated_by_reply_job_id, agent_id, agent_name,
    agent_responsibility,
    skill_id, skill_name, skill_instructions, skill_kind,
    provider, model, effort, request,
    worker_id, worker_label, result_session_id, approved_by_user_id,
    approved_at, delegated_by_agent_id, delegated_by_agent_name, created_at
  ) values (
    new.id || ':approval:' || new.generation, new.id, new.organization_id,
    new.project_id, new.source_kind, new.channel_id, new.conversation_run_id,
    new.trigger_message_id, new.reply_message_id, new.source_reply_job_id,
    new.delegated_by_reply_job_id, new.agent_id, new.agent_name,
    new.agent_responsibility, new.skill_id,
    new.skill_name, new.skill_instructions, new.skill_kind,
    new.provider, new.model, new.effort,
    new.request, new.requested_worker_id, new.requested_worker_label,
    new.result_session_id, new.accepted_by_user_id, new.accepted_at,
    new.delegated_by_agent_id, new.delegated_by_agent_name, new.accepted_at
  );
end;

create trigger briar_project_agent_session_requester_immutable
before update of requested_by_user_id on briar_project_agent_sessions
when new.requested_by_user_id is not old.requested_by_user_id
  and not (
    old.requested_by_user_id is not null
    and new.requested_by_user_id is null
    and not exists (
      select 1 from "user" account
      where account.id = old.requested_by_user_id
    )
  )
begin
  select raise(abort, 'Agent Session requester is immutable');
end;

create trigger briar_project_agent_schedule_creator_immutable
before update of created_by_user_id on briar_project_agent_schedules
when new.created_by_user_id is not old.created_by_user_id
  and not (
    old.created_by_user_id is not null
    and new.created_by_user_id is null
    and not exists (
      select 1 from "user" account
      where account.id = old.created_by_user_id
    )
  )
begin
  select raise(abort, 'Agent schedule creator is immutable');
end;
