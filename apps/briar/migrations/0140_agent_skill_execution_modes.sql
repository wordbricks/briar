alter table briar_agent_skills add column execution_mode text not null
  default 'task' check (execution_mode in ('conversation', 'task'));
alter table briar_agent_skills add column approval_policy text not null
  default 'explicit' check (approval_policy in ('invoke_is_consent', 'explicit'));

-- The bundled explainer is the compatibility exception: invoking it is the
-- approval and its output belongs in the current conversation. Every other
-- existing Skill keeps the former detached explicit-approval behavior.
update briar_agent_skills
set execution_mode = 'conversation', approval_policy = 'invoke_is_consent'
where lower(trim(name)) in ('eli5', '/eli5');

alter table briar_agent_skill_execution_proposals
  add column execution_mode text not null default 'task'
  check (execution_mode in ('conversation', 'task'));
alter table briar_agent_skill_execution_proposals
  add column approval_policy text not null default 'explicit'
  check (approval_policy in ('invoke_is_consent', 'explicit'));
alter table briar_agent_skill_execution_proposals
  add column thread_root_message_id text;
alter table briar_agent_skill_execution_proposals
  add column result_reply_job_id text;
alter table briar_agent_skill_execution_proposals
  add column result_message_id text;

update briar_agent_skill_execution_proposals
set thread_root_message_id = case source_kind
  when 'channel' then (
    select parent_message_id from briar_channel_agent_reply_jobs
    where id = briar_agent_skill_execution_proposals.source_reply_job_id
  )
  else (
    select parent_message_id from briar_issue_agent_reply_jobs
    where id = briar_agent_skill_execution_proposals.source_reply_job_id
  )
end;

alter table briar_agent_skill_execution_approval_audit
  add column execution_mode text not null default 'task'
  check (execution_mode in ('conversation', 'task'));
alter table briar_agent_skill_execution_approval_audit
  add column approval_policy text not null default 'explicit'
  check (approval_policy in ('invoke_is_consent', 'explicit'));
alter table briar_agent_skill_execution_approval_audit
  add column thread_root_message_id text;
alter table briar_agent_skill_execution_approval_audit
  add column result_reply_job_id text;
alter table briar_agent_skill_execution_approval_audit
  add column result_message_id text;

alter table briar_channel_agent_reply_jobs
  add column approved_skill_execution_proposal_id text;

create index briar_agent_skill_execution_origin_idx
  on briar_agent_skill_execution_proposals (
    channel_id, thread_root_message_id, trigger_message_id, created_at
  );

-- A proposal is an immutable snapshot of both the Skill policy and the exact
-- conversation location that produced it. Keep this invariant in D1 as well as
-- in the application so a stale or hand-written insert cannot change where an
-- accepted execution runs or posts its result.
create trigger briar_agent_skill_execution_mode_insert_guard
before insert on briar_agent_skill_execution_proposals
when not (
  exists (
    select 1 from briar_agent_skills skill
    where skill.id = new.skill_id and skill.agent_id = new.agent_id
      and skill.execution_mode = new.execution_mode
      and skill.approval_policy = new.approval_policy
  )
  and (
    (new.source_kind = 'channel'
      and new.channel_id is not null
      and new.thread_root_message_id is not null
      and exists (
        select 1 from briar_channel_agent_reply_jobs job
        where job.id = new.source_reply_job_id
          and job.channel_id = new.channel_id
          and job.parent_message_id = new.thread_root_message_id
          and job.trigger_message_id = new.trigger_message_id
      ))
    or
    (new.source_kind = 'issue'
      and new.channel_id is null
      and new.execution_mode = 'task'
      and new.thread_root_message_id is not null
      and exists (
        select 1 from briar_issue_agent_reply_jobs job
        where job.id = new.source_reply_job_id
          and job.run_id = new.conversation_run_id
          and job.parent_message_id = new.thread_root_message_id
          and job.trigger_message_id = new.trigger_message_id
      ))
  )
)
begin
  select raise(abort, 'invalid Agent Skill execution mode or origin');
end;

-- An approved conversation execution is another turn of the existing channel
-- session. The result job must remain bound to that proposal, session, thread,
-- request, Agent, and Skill snapshot.
create trigger briar_agent_skill_execution_result_job_insert_guard
before insert on briar_channel_agent_reply_jobs
when new.approved_skill_execution_proposal_id is not null
  and not exists (
    select 1
    from briar_agent_skill_execution_proposals proposal
    join briar_channel_agent_reply_jobs source
      on source.id = proposal.source_reply_job_id
     and source.session_id = proposal.result_session_id
    where proposal.id = new.approved_skill_execution_proposal_id
      and proposal.status = 'accepted'
      and proposal.source_kind = 'channel'
      and proposal.execution_mode = 'conversation'
      and proposal.channel_id = new.channel_id
      and proposal.project_id = new.project_id
      and proposal.agent_id = new.agent_id
      and proposal.skill_id = new.skill_id
      and proposal.result_session_id = new.session_id
      and proposal.result_reply_job_id = new.id
      and proposal.result_message_id = new.reply_message_id
      and proposal.reply_message_id = new.trigger_message_id
      and proposal.thread_root_message_id = new.parent_message_id
      and proposal.request = new.skill_execution_request_snapshot
      and proposal.skill_id = new.selected_skill_id_snapshot
      and proposal.agent_name = new.selected_agent_name_snapshot
      and proposal.agent_responsibility =
        new.selected_agent_responsibility_snapshot
      and proposal.skill_name = new.selected_skill_name_snapshot
      and proposal.skill_instructions =
        new.selected_skill_instructions_snapshot
      and proposal.skill_kind = new.selected_skill_kind_snapshot
      and proposal.provider = new.selected_skill_provider_snapshot
      and proposal.model is new.selected_skill_model_snapshot
      and proposal.effort is new.selected_skill_effort_snapshot
  )
begin
  select raise(abort, 'invalid approved Agent Skill conversation job');
end;

create trigger briar_agent_skill_execution_result_job_origin_immutable
before update of approved_skill_execution_proposal_id
on briar_channel_agent_reply_jobs
when new.approved_skill_execution_proposal_id is not
  old.approved_skill_execution_proposal_id
begin
  select raise(abort, 'approved Agent Skill conversation origin is immutable');
end;

-- Successful replies are inserted by the normal channel completion path. A
-- terminal provider/lease failure has no reply payload, so publish a bounded
-- failure result from D1 and keep the approval card's result target valid.
create trigger briar_agent_skill_execution_result_job_failure_publish
after update of status on briar_channel_agent_reply_jobs
when old.status in ('queued', 'running') and new.status = 'failed'
  and new.approved_skill_execution_proposal_id is not null
begin
  insert or ignore into briar_channel_messages (
    id, channel_id, parent_message_id, author_user_id, author_agent_id,
    author_agent_name, author_agent_provider, body, created_at, updated_at
  )
  select proposal.result_message_id, proposal.channel_id,
         proposal.thread_root_message_id, null, proposal.agent_id,
         proposal.agent_name, proposal.provider,
         '**Skill execution failed**' || char(10) || char(10) ||
           substr(coalesce(new.error, 'The Skill failed without an error summary.'),
                  1, 9000),
         new.updated_at, new.updated_at
  from briar_agent_skill_execution_proposals proposal
  where proposal.id = new.approved_skill_execution_proposal_id
    and proposal.status = 'accepted'
    and proposal.execution_mode = 'conversation'
    and proposal.result_reply_job_id = new.id
    and proposal.result_message_id = new.reply_message_id
    and exists (
      select 1 from briar_channel_messages root
      where root.id = proposal.thread_root_message_id
        and root.channel_id = proposal.channel_id
        and root.parent_message_id is null
    );
end;

-- Task failures can become terminal outside the completion HTTP route (for
-- example lease reaping or a policy revocation). Publish those failures in D1
-- so every terminal approval card still has a durable result location. The
-- normal route observes the stored result and only needs to fan out realtime.
create trigger briar_agent_skill_execution_task_failure_publish
after update of status on briar_project_agent_task_jobs
when old.status in ('queued', 'running') and new.status = 'failed'
  and new.skill_execution_proposal_id is not null
begin
  update briar_agent_skill_execution_proposals
  set result_message_id =
        lower(hex(randomblob(4))) || '-' ||
        lower(hex(randomblob(2))) || '-' ||
        lower(hex(randomblob(2))) || '-' ||
        lower(hex(randomblob(2))) || '-' ||
        lower(hex(randomblob(6))),
      updated_at = new.updated_at
  where id = new.skill_execution_proposal_id
    and status = 'accepted' and execution_mode = 'task'
    and result_session_id = new.id and result_message_id is null;

  insert or ignore into briar_channel_messages (
    id, channel_id, parent_message_id, author_user_id, author_agent_id,
    author_agent_name, author_agent_provider, body, created_at, updated_at
  )
  select proposal.result_message_id, proposal.channel_id,
         proposal.thread_root_message_id, null, proposal.agent_id,
         proposal.agent_name, proposal.provider,
         '**Skill execution failed**' || char(10) || char(10) ||
           substr(coalesce(new.error, 'The Skill failed without an error summary.'),
                  1, 9000) || char(10) || char(10) ||
           '[View Agent Session](briar-companion://sessions/' ||
           new.project_id || '/' || new.id || ')',
         new.updated_at, new.updated_at
  from briar_agent_skill_execution_proposals proposal
  where proposal.id = new.skill_execution_proposal_id
    and proposal.source_kind = 'channel'
    and proposal.result_message_id is not null
    and exists (
      select 1 from briar_channel_messages root
      where root.id = proposal.thread_root_message_id
        and root.channel_id = proposal.channel_id
        and root.parent_message_id is null
    );

  insert or ignore into briar_issue_messages (
    id, project_id, run_id, parent_message_id, author_user_id,
    author_agent_id, author_agent_name, author_agent_provider,
    body, created_at, updated_at
  )
  select proposal.result_message_id, proposal.project_id,
         proposal.conversation_run_id, proposal.thread_root_message_id,
         null, proposal.agent_id, proposal.agent_name, proposal.provider,
         '**Skill execution failed**' || char(10) || char(10) ||
           substr(coalesce(new.error, 'The Skill failed without an error summary.'),
                  1, 9000) || char(10) || char(10) ||
           '[View Agent Session](briar-companion://sessions/' ||
           new.project_id || '/' || new.id || ')',
         new.updated_at, new.updated_at
  from briar_agent_skill_execution_proposals proposal
  where proposal.id = new.skill_execution_proposal_id
    and proposal.source_kind = 'issue'
    and proposal.result_message_id is not null
    and exists (
      select 1 from briar_issue_messages root
      where root.id = proposal.thread_root_message_id
        and root.project_id = proposal.project_id
        and root.run_id = proposal.conversation_run_id
    );
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
end;

create trigger briar_agent_skill_execution_mode_immutable
before update of execution_mode, approval_policy, thread_root_message_id
on briar_agent_skill_execution_proposals
when new.execution_mode is not old.execution_mode
  or new.approval_policy is not old.approval_policy
  or new.thread_root_message_id is not old.thread_root_message_id
begin
  select raise(abort, 'Agent Skill execution mode and origin are immutable');
end;

create trigger briar_agent_skill_execution_result_origin_immutable
before update of result_reply_job_id, result_message_id
on briar_agent_skill_execution_proposals
when not (
  (old.status = 'pending' and new.status = 'accepted'
    and old.result_reply_job_id is null and old.result_message_id is null
    and (
      (new.execution_mode = 'task'
        and new.result_reply_job_id is null and new.result_message_id is null)
      or
      (new.execution_mode = 'conversation'
        and new.result_reply_job_id is not null
        and new.result_message_id is not null)
    ))
  or
  (old.status = 'accepted' and new.status = 'accepted'
    and new.execution_mode = 'task'
    and old.result_reply_job_id is null and new.result_reply_job_id is null
    and old.result_message_id is null and new.result_message_id is not null
    and exists (
      select 1 from briar_project_agent_task_jobs task
      where task.id = new.result_session_id
        and task.skill_execution_proposal_id = new.id
        and task.status in ('completed', 'failed')
    ))
  or
  (new.result_reply_job_id is old.result_reply_job_id
    and new.result_message_id is old.result_message_id)
)
begin
  select raise(abort, 'Agent Skill execution result origin is immutable');
end;

-- Normal Skill editing is rejected by the application while work is active.
-- These reconciliation triggers are the database backstop for direct writes:
-- pending cards are invalidated and already-approved executions fail visibly
-- rather than running under a policy different from the recorded snapshot.
create trigger briar_agent_skill_execution_policy_update_reconcile
after update of execution_mode, approval_policy on briar_agent_skills
when new.execution_mode is not old.execution_mode
  or new.approval_policy is not old.approval_policy
begin
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = new.updated_at
  where skill_id = old.id and status = 'pending';

  update briar_project_agent_task_jobs
  set status = 'failed',
      error = 'Approved Skill execution policy changed before execution.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_at = null, lease_expires_at = null,
      completed_at = new.updated_at, updated_at = new.updated_at
  where status in ('queued', 'running')
    and skill_execution_proposal_id in (
      select id from briar_agent_skill_execution_proposals
      where skill_id = old.id and status = 'accepted'
    );

  update briar_channel_agent_reply_jobs
  set status = 'failed',
      error = 'Approved Skill execution policy changed before execution.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_device_id = null, claimed_at = null, lease_expires_at = null,
      completed_at = new.updated_at, updated_at = new.updated_at
  where status in ('queued', 'running')
    and approved_skill_execution_proposal_id in (
      select id from briar_agent_skill_execution_proposals
      where skill_id = old.id and status = 'accepted'
    );
end;
