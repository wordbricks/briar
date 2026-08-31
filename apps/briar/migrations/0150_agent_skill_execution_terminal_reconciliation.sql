pragma foreign_keys = on;

-- Terminal Agent Skill executions may be caused by a database reconciliation
-- trigger instead of the Worker completion route. Persist both realtime topics
-- in the same transaction so any API mutation or scheduled sweep can publish
-- them after commit.
create table briar_agent_skill_execution_realtime_outbox (
  task_id text primary key not null,
  organization_id text not null,
  project_id text not null,
  source_kind text not null check (source_kind in ('channel', 'issue')),
  channel_cursor integer,
  project_cursor integer,
  session_version integer not null check (session_version >= 0),
  updated_at text not null
);

create index briar_agent_skill_execution_realtime_outbox_updated_idx
  on briar_agent_skill_execution_realtime_outbox (updated_at, task_id);

-- A Skill's runtime is the body plus the provider and execution settings. Its
-- name, description, kind, position, and temporary collision-avoidance name
-- are metadata and must not invalidate or terminate accepted work.
drop trigger briar_agent_skill_execution_skill_update_invalidate;
drop trigger briar_agent_skill_execution_policy_update_reconcile;

create trigger briar_agent_skill_execution_skill_update_invalidate
after update of body, provider, model, effort, execution_mode, approval_policy
on briar_agent_skills
when new.body is not old.body
  or new.provider is not old.provider
  or new.model is not old.model
  or new.effort is not old.effort
  or new.execution_mode is not old.execution_mode
  or new.approval_policy is not old.approval_policy
begin
  update briar_agent_skill_execution_proposals
  set status = 'invalidated', generation = generation + 1,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  where skill_id = old.id and status = 'pending'
    and (
      new.body is not skill_instructions
      or new.provider is not provider
      or new.model is not model
      or new.effort is not effort
      or new.execution_mode is not execution_mode
      or new.approval_policy is not approval_policy
    );

  update briar_project_agent_task_jobs
  set status = 'failed',
      error = 'Approved Skill runtime changed before execution.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_at = null, lease_expires_at = null,
      completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  where status in ('queued', 'running')
    and skill_execution_proposal_id in (
      select approval.proposal_id
      from briar_agent_skill_execution_approval_audit approval
      where approval.skill_id = old.id
        and (
          new.body is not approval.skill_instructions
          or new.provider is not approval.provider
          or new.model is not approval.model
          or new.effort is not approval.effort
          or new.execution_mode is not approval.execution_mode
          or new.approval_policy is not approval.approval_policy
        )
    );

  update briar_channel_agent_reply_jobs
  set status = 'failed',
      error = 'Approved Skill runtime changed before execution.',
      claim_token_hash = null, claimed_worker_id = null,
      claimed_device_id = null, claimed_at = null, lease_expires_at = null,
      completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  where status in ('queued', 'running')
    and approved_skill_execution_proposal_id in (
      select proposal.id
      from briar_agent_skill_execution_proposals proposal
      where proposal.skill_id = old.id and proposal.status = 'accepted'
        and (
          new.body is not proposal.skill_instructions
          or new.provider is not proposal.provider
          or new.model is not proposal.model
          or new.effort is not proposal.effort
          or new.execution_mode is not proposal.execution_mode
          or new.approval_policy is not proposal.approval_policy
        )
    );
end;

-- A harmless metadata save must remain claimable. Validate the current Skill
-- against the approval audit using the same runtime-only predicate as the save
-- guard and reconciliation trigger.
drop trigger briar_agent_skill_execution_task_claim_guard;

create trigger briar_agent_skill_execution_task_claim_guard
before update of claim_token_hash on briar_project_agent_task_jobs
when new.claim_token_hash is not null
  and new.claim_token_hash is not old.claim_token_hash
  and new.skill_execution_proposal_id is not null
  and not exists (
    select 1
    from briar_agent_skill_execution_approval_audit approval
    join briar_project_agents agent
      on agent.id = approval.agent_id and agent.project_id = approval.project_id
     and agent.organization_id = approval.organization_id
    join briar_agent_skills skill
      on skill.id = approval.skill_id and skill.agent_id = approval.agent_id
    join briar_execution_workers worker
      on worker.id = new.claimed_worker_id
     and worker.project_id = approval.project_id
    join briar_execution_worker_devices device
      on device.id = worker.device_id
     and device.organization_id = approval.organization_id
    join briar_organization_members worker_owner
      on worker_owner.organization_id = device.organization_id
     and worker_owner.user_id = device.owner_user_id
    where approval.proposal_id = new.skill_execution_proposal_id
      and approval.project_id = new.project_id
      and approval.result_session_id = new.id
      and approval.agent_id = new.agent_id
      and approval.skill_id = new.skill_id
      and approval.request = new.request
      and approval.proposal_id = new.request_id
      and approval.worker_id = new.preferred_worker_id
      and approval.worker_id = new.claimed_worker_id
      and agent.name = approval.agent_name
      and agent.responsibility = approval.agent_responsibility
      and skill.body = approval.skill_instructions
      and skill.provider = approval.provider
      and skill.model is approval.model
      and skill.effort is approval.effort
      and skill.execution_mode = approval.execution_mode
      and skill.approval_policy = approval.approval_policy
      and worker.state <> 'disabled' and device.state <> 'disabled'
      and worker.accepting_work = 1
      and worker.readiness_state <> 'needs_attention'
      and julianday(worker.last_heartbeat_at) >=
        julianday(new.claimed_at, '-3 minutes')
      and julianday(device.last_heartbeat_at) >=
        julianday(new.claimed_at, '-3 minutes')
      and coalesce(json_extract(
        worker.capabilities_json,
        '$.providerHealth.' || approval.provider || '.healthy'
      ), 0) = 1
      and (
        not exists (
          select 1 from briar_project_execution_worker_policies policy
          where policy.project_id = new.project_id
            and policy.selection_mode = 'allowlist'
        )
        or exists (
          select 1 from briar_project_execution_worker_allowlist allowed
          where allowed.project_id = new.project_id
            and allowed.worker_id = worker.id
        )
      )
      and (
        (select count(*)
         from briar_hunt_runs run
         join briar_execution_workers holder on holder.id = run.worker_id
         where holder.device_id = device.id
           and run.claim_token_hash is not null
           and run.lease_expires_at > new.claimed_at
           and run.status not in (
             'backlog', 'completed', 'cancelled', 'blocked', 'failed'
           ))
        +
        (select count(*)
         from briar_project_agent_task_jobs task
         join briar_execution_workers holder
           on holder.id = task.claimed_worker_id
         where holder.device_id = device.id and task.status = 'running'
           and task.lease_expires_at > new.claimed_at)
        < device.max_concurrent_sessions
      )
  )
begin
  select raise(abort, 'Agent Skill execution approval audit is missing or stale');
end;

-- One trigger owns the terminal projection. It first replaces any caller or
-- metadata timestamp with database time (clamped to the session start), then
-- updates every durable representation before writing the realtime intent.
drop trigger briar_agent_skill_execution_task_failure_publish;
drop trigger briar_agent_skill_execution_task_terminal_project;

create trigger briar_agent_skill_execution_task_terminal_project
after update of status on briar_project_agent_task_jobs
when new.skill_execution_proposal_id is not null
  and new.status in ('completed', 'failed')
  and (
    old.status in ('queued', 'running')
    or (
      old.status = new.status
      and (
        new.completed_at is null
        or exists (
          select 1 from briar_project_agent_sessions session
          where session.project_id = new.project_id and session.id = new.id
            and (
              session.status is not new.status
              or julianday(new.completed_at) < julianday(session.started_at)
            )
        )
        or not exists (
          select 1 from briar_project_agent_session_summaries summary
          where summary.project_id = new.project_id
            and summary.session_id = new.id
            and json_extract(summary.summary_json, '$.status') = new.status
        )
        or not exists (
          select 1
          from briar_agent_skill_execution_proposals proposal
          left join briar_channel_messages channel_message
            on proposal.source_kind = 'channel'
           and channel_message.id = proposal.result_message_id
          left join briar_issue_messages issue_message
            on proposal.source_kind = 'issue'
           and issue_message.id = proposal.result_message_id
          where proposal.id = new.skill_execution_proposal_id
            and proposal.result_message_id is not null
            and (
              channel_message.id is not null or issue_message.id is not null
            )
        )
      )
    )
  )
begin
  update briar_project_agent_task_jobs
  set completed_at = case
        when julianday(strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) <
             julianday((
               select session.started_at
               from briar_project_agent_sessions session
               where session.project_id = new.project_id
                 and session.id = new.id
             ))
          then (
            select session.started_at
            from briar_project_agent_sessions session
            where session.project_id = new.project_id and session.id = new.id
          )
        else strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      end,
      updated_at = case
        when julianday(strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) <
             julianday((
               select session.started_at
               from briar_project_agent_sessions session
               where session.project_id = new.project_id
                 and session.id = new.id
             ))
          then (
            select session.started_at
            from briar_project_agent_sessions session
            where session.project_id = new.project_id and session.id = new.id
          )
        else strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      end
  where project_id = new.project_id and id = new.id;

  update briar_project_agent_sessions
  set status = new.status,
      payload_json = json_insert(
        json_set(
          payload_json,
          '$.status', new.status,
          '$.summary', new.result_summary,
          '$.conversationId', new.result_conversation_id,
          '$.error', new.error,
          '$.completedAt', (
            select task.completed_at
            from briar_project_agent_task_jobs task
            where task.project_id = new.project_id and task.id = new.id
          ),
          '$.updatedAt', (
            select task.updated_at
            from briar_project_agent_task_jobs task
            where task.project_id = new.project_id and task.id = new.id
          )
        ),
        '$.events[#]', json_object(
          'id', lower(hex(randomblob(16))),
          'type', new.status,
          'occurredAt', (
            select task.completed_at
            from briar_project_agent_task_jobs task
            where task.project_id = new.project_id and task.id = new.id
          )
        )
      ),
      completed_at = (
        select task.completed_at
        from briar_project_agent_task_jobs task
        where task.project_id = new.project_id and task.id = new.id
      ),
      updated_at = (
        select task.updated_at
        from briar_project_agent_task_jobs task
        where task.project_id = new.project_id and task.id = new.id
      )
  where project_id = new.project_id and id = new.id;

  insert into briar_project_agent_session_summaries (
    project_id, session_id, summary_json, updated_at, archived
  )
  select session.project_id, session.id,
         json_object(
           'dispatchGroupId', coalesce(
             json_extract(session.payload_json, '$.dispatchGroupId'),
             session.id
           ),
           'agentId', coalesce(
             json_extract(session.payload_json, '$.agentId'),
             session.agent_id
           ),
           'agentName', json_extract(session.payload_json, '$.agentName'),
           'skillId', json_extract(session.payload_json, '$.skillId'),
           'sessionType', coalesce(
             json_extract(session.payload_json, '$.sessionType'),
             session.session_type
           ),
           'trigger', json_extract(session.payload_json, '$.trigger'),
           'scheduleId', json_extract(session.payload_json, '$.scheduleId'),
           'scheduleRunId',
             json_extract(session.payload_json, '$.scheduleRunId'),
           'parentSessionId',
             json_extract(session.payload_json, '$.parentSessionId'),
           'requestedByUserId', session.requested_by_user_id,
           'request', substr(
             json_extract(session.payload_json, '$.request'), 1, 500
           ),
           'status', session.status,
           'issues', json(coalesce(
             json_extract(session.payload_json, '$.issues'), '[]'
           )),
           'startedAt', session.started_at,
           'completedAt', session.completed_at,
           'inboxVersion', 'session:v1:' || session.status || ':' ||
             coalesce(session.completed_at, session.started_at),
           'requestedWorkerId',
             json_extract(session.payload_json, '$.requestedWorkerId'),
           'workerId', json_extract(session.payload_json, '$.workerId'),
           'updatedAt', session.updated_at
         ),
         session.updated_at, 0
  from briar_project_agent_sessions session
  where session.project_id = new.project_id and session.id = new.id
  on conflict (project_id, session_id) do update set
    summary_json = excluded.summary_json,
    updated_at = excluded.updated_at,
    archived = 0;

  update briar_agent_skill_execution_proposals
  set result_message_id = coalesce(
        result_message_id,
        lower(hex(randomblob(4))) || '-' ||
        lower(hex(randomblob(2))) || '-' ||
        lower(hex(randomblob(2))) || '-' ||
        lower(hex(randomblob(2))) || '-' ||
        lower(hex(randomblob(6)))
      ),
      updated_at = (
        select task.updated_at
        from briar_project_agent_task_jobs task
        where task.project_id = new.project_id and task.id = new.id
      )
  where id = new.skill_execution_proposal_id
    and status = 'accepted' and execution_mode = 'task'
    and result_session_id = new.id;

  insert into briar_channel_messages (
    id, channel_id, parent_message_id, author_user_id, author_agent_id,
    author_agent_name, author_agent_provider, body, created_at, updated_at
  )
  select proposal.result_message_id, proposal.channel_id,
         proposal.thread_root_message_id, null, proposal.agent_id,
         proposal.agent_name, proposal.provider,
         case when new.status = 'completed'
           then '**Skill execution completed**'
           else '**Skill execution failed**' end || char(10) || char(10) ||
           substr(case when new.status = 'completed'
             then coalesce(
               new.result_summary, 'The Skill completed without a summary.'
             )
             else coalesce(
               new.error, 'The Skill failed without an error summary.'
             ) end, 1, 9000) || char(10) || char(10) ||
           '[View Agent Session](briar-companion://sessions/' ||
           new.project_id || '/' || new.id || ')',
         task.completed_at, task.completed_at
  from briar_agent_skill_execution_proposals proposal
  join briar_project_agent_task_jobs task
    on task.project_id = proposal.project_id
   and task.id = proposal.result_session_id
  where proposal.id = new.skill_execution_proposal_id
    and proposal.source_kind = 'channel'
    and proposal.result_message_id is not null
    and exists (
      select 1 from briar_channel_messages root
      where root.id = proposal.thread_root_message_id
        and root.channel_id = proposal.channel_id
        and root.parent_message_id is null
    )
  on conflict (id) do update set
    body = excluded.body,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at;

  insert into briar_issue_messages (
    id, project_id, run_id, parent_message_id, author_user_id,
    author_agent_id, author_agent_name, author_agent_provider,
    body, created_at, updated_at
  )
  select proposal.result_message_id, proposal.project_id,
         proposal.conversation_run_id, proposal.thread_root_message_id,
         null, proposal.agent_id, proposal.agent_name, proposal.provider,
         case when new.status = 'completed'
           then '**Skill execution completed**'
           else '**Skill execution failed**' end || char(10) || char(10) ||
           substr(case when new.status = 'completed'
             then coalesce(
               new.result_summary, 'The Skill completed without a summary.'
             )
             else coalesce(
               new.error, 'The Skill failed without an error summary.'
             ) end, 1, 9000) || char(10) || char(10) ||
           '[View Agent Session](briar-companion://sessions/' ||
           new.project_id || '/' || new.id || ')',
         task.completed_at, task.completed_at
  from briar_agent_skill_execution_proposals proposal
  join briar_project_agent_task_jobs task
    on task.project_id = proposal.project_id
   and task.id = proposal.result_session_id
  where proposal.id = new.skill_execution_proposal_id
    and proposal.source_kind = 'issue'
    and proposal.result_message_id is not null
    and exists (
      select 1 from briar_issue_messages root
      where root.id = proposal.thread_root_message_id
        and root.project_id = proposal.project_id
        and root.run_id = proposal.conversation_run_id
    )
  on conflict (id) do update set
    body = excluded.body,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at;

  -- Upserting an existing backdated reply runs message UPDATE triggers, not
  -- the notification INSERT trigger. Materialize its subscriber rows here so
  -- the repaired reply is visible in the organization Inbox as well.
  insert into briar_channel_notification_inbox (
    user_id, organization_id, message_id, notification_reason, created_at
  )
  select subscription.user_id, subscription.organization_id, message.id,
         iif(root.author_user_id = subscription.user_id,
             'thread_reply', 'subscription'),
         message.created_at
  from briar_agent_skill_execution_proposals proposal
  join briar_channel_messages message
    on message.id = proposal.result_message_id
   and message.channel_id = proposal.channel_id
  join briar_channel_thread_subscriptions subscription
    on subscription.root_message_id = proposal.thread_root_message_id
  join briar_channel_messages root
    on root.id = subscription.root_message_id
   and root.channel_id = proposal.channel_id
  where proposal.id = new.skill_execution_proposal_id
    and proposal.source_kind = 'channel'
    and (message.author_user_id is null
         or message.author_user_id <> subscription.user_id)
    and julianday(message.created_at) >= julianday(subscription.created_at)
  on conflict (user_id, message_id) do update set
    organization_id = excluded.organization_id,
    notification_reason = excluded.notification_reason,
    created_at = excluded.created_at;

  insert into briar_agent_skill_execution_realtime_outbox (
    task_id, organization_id, project_id, source_kind,
    channel_cursor, project_cursor, session_version, updated_at
  )
  select new.id, proposal.organization_id, proposal.project_id,
         proposal.source_kind,
         case when proposal.source_kind = 'channel'
           then coalesce(channel_state.current_version, 0) else null end,
         case when proposal.source_kind = 'issue'
           then coalesce(project_state.current_version, 0) else null end,
         coalesce(session_state.current_version, 0),
         task.updated_at
  from briar_agent_skill_execution_proposals proposal
  join briar_project_agent_task_jobs task
    on task.project_id = proposal.project_id
   and task.id = proposal.result_session_id
  left join briar_channel_sync_state channel_state
    on channel_state.organization_id = proposal.organization_id
  left join briar_dashboard_sync_state project_state
    on project_state.project_id = proposal.project_id
  left join briar_project_agent_session_sync_state session_state
    on session_state.project_id = proposal.project_id
  where proposal.id = new.skill_execution_proposal_id
  on conflict (task_id) do update set
    channel_cursor = case when excluded.source_kind = 'channel' then max(
        coalesce(briar_agent_skill_execution_realtime_outbox.channel_cursor, 0),
        excluded.channel_cursor
      ) else null end,
    project_cursor = case when excluded.source_kind = 'issue' then max(
        coalesce(briar_agent_skill_execution_realtime_outbox.project_cursor, 0),
        excluded.project_cursor
      ) else null end,
    session_version = max(
      briar_agent_skill_execution_realtime_outbox.session_version,
      excluded.session_version
    ),
    updated_at = excluded.updated_at;
end;

-- Idempotently replay the terminal projection for the production session that
-- exposed this bug. The trigger preserves its failure while replacing the
-- stale timestamp, summary, result-message ordering, Inbox row, and realtime
-- publication intent.
update briar_project_agent_task_jobs
set status = status
where id = 'dff0395b-2762-4d18-8677-66435991cccb'
  and status = 'failed' and skill_execution_proposal_id is not null;
