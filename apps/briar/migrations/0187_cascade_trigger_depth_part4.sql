pragma defer_foreign_keys = on;

CREATE TRIGGER briar_project_mandatory_checkpoints_shape_insert
before insert on briar_project_settings
begin
  insert into briar_workflow_checkpoint_storage_validation (
    owner, checkpoints_json
  ) values ('project', new.mandatory_checkpoints_json);
end;

CREATE TRIGGER briar_project_mandatory_checkpoints_shape_update
before update of mandatory_checkpoints_json on briar_project_settings
begin
  insert into briar_workflow_checkpoint_storage_validation (
    owner, checkpoints_json
  ) values ('project', new.mandatory_checkpoints_json);
end;

CREATE TRIGGER briar_user_default_checkpoints_shape_insert
before insert on briar_user_workflow_checkpoint_defaults
begin
  insert into briar_workflow_checkpoint_storage_validation (
    owner, checkpoints_json
  ) values ('user', new.checkpoints_json);
end;

CREATE TRIGGER briar_user_default_checkpoints_shape_update
before update of checkpoints_json on briar_user_workflow_checkpoint_defaults
begin
  insert into briar_workflow_checkpoint_storage_validation (
    owner, checkpoints_json
  ) values ('user', new.checkpoints_json);
end;

CREATE TRIGGER briar_issue_checkpoints_shape_insert
before insert on briar_hunt_runs
begin
  insert into briar_workflow_checkpoint_storage_validation (
    owner, checkpoints_json
  ) values ('issue', new.issue_checkpoints_json);
end;

CREATE TRIGGER briar_issue_checkpoints_shape_update
before update of issue_checkpoints_json on briar_hunt_runs
begin
  insert into briar_workflow_checkpoint_storage_validation (
    owner, checkpoints_json
  ) values ('issue', new.issue_checkpoints_json);
end;

CREATE TRIGGER briar_execution_worker_runtime_insert_guard
after insert on briar_execution_workers
when exists (
  select 1 from briar_invalid_execution_worker_runtime invalid
  where invalid.id = new.id
)
begin
  select raise(abort, 'Worker runtime ProtoJSON is invalid');
end;

CREATE TRIGGER briar_agent_skill_execution_task_claim_guard
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
      and skill.name = approval.skill_name
      and skill.body = approval.skill_instructions
      and skill.kind = approval.skill_kind
      and skill.provider = approval.provider
      and skill.model is approval.model and skill.effort is approval.effort
      and worker.state <> 'disabled' and device.state <> 'disabled'
      and worker.accepting_work = 1
      and worker.readiness_state <> 'needs_attention'
      and julianday(worker.last_heartbeat_at) >=
        julianday(new.claimed_at, '-3 minutes')
      and julianday(device.last_heartbeat_at) >=
        julianday(new.claimed_at, '-3 minutes')
      and exists (
        select 1
        from briar_execution_worker_healthy_providers healthy
        where healthy.worker_id = worker.id
          and healthy.provider = approval.provider
      )
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
BEGIN
  select raise(abort, 'Agent Skill execution approval audit is missing or stale');
END;

CREATE TRIGGER briar_agent_skill_execution_accept_guard
before update of status on briar_agent_skill_execution_proposals
when old.status = 'pending' and new.status = 'accepted' and not (
  old.requested_worker_id is null and old.requested_worker_label is null
  and old.result_session_id is null
  and old.accepted_by_user_id is null and old.accepted_at is null
  and new.requested_worker_id is not null
  and new.requested_worker_label is not null
  and new.result_session_id is not null
  and new.accepted_by_user_id is not null and new.accepted_at is not null
  and new.updated_at = new.accepted_at
  and exists (
    select 1
    from briar_organization_members membership
    join briar_projects project
      on project.id = new.project_id
     and project.organization_id = membership.organization_id
    join briar_project_agents agent
      on agent.id = new.agent_id and agent.project_id = project.id
     and agent.organization_id = project.organization_id
    join briar_agent_skills skill
      on skill.id = new.skill_id and skill.agent_id = agent.id
    left join briar_channel_agent_reply_jobs conversation_source
      on new.execution_mode = 'conversation'
     and new.source_kind = 'channel'
     and conversation_source.id = new.source_reply_job_id
    left join briar_channel_reply_sessions conversation_session
      on conversation_session.id = conversation_source.session_id
     and conversation_session.organization_id = new.organization_id
     and conversation_session.channel_id = new.channel_id
     and conversation_session.thread_root_message_id =
       new.thread_root_message_id
     and conversation_session.agent_id = new.agent_id
    join briar_execution_workers worker
      on worker.id = new.requested_worker_id
     and worker.project_id = new.project_id
    join briar_execution_worker_devices device
      on device.id = worker.device_id
     and device.organization_id = new.organization_id
    join briar_organization_members worker_owner
      on worker_owner.organization_id = device.organization_id
     and worker_owner.user_id = device.owner_user_id
    where membership.organization_id = new.organization_id
      and membership.user_id = new.accepted_by_user_id
      and agent.name = new.agent_name
      and agent.responsibility = new.agent_responsibility
      and skill.name = new.skill_name
      and skill.body = new.skill_instructions
      and skill.kind = new.skill_kind
      and skill.provider = new.provider
      and skill.model is new.model and skill.effort is new.effort
      and (
        new.execution_mode = 'task'
        or conversation_session.id is not null
      )
      and worker.label = new.requested_worker_label
      and worker.state <> 'disabled' and device.state <> 'disabled'
      and worker.accepting_work = 1
      and worker.readiness_state <> 'needs_attention'
      and julianday(worker.last_heartbeat_at) >=
        julianday(new.accepted_at, '-3 minutes')
      and julianday(device.last_heartbeat_at) >=
        julianday(new.accepted_at, '-3 minutes')
      and exists (
        select 1
        from briar_execution_worker_healthy_providers healthy
        where healthy.worker_id = worker.id
          and healthy.provider = case
            when new.execution_mode = 'conversation'
              then conversation_session.provider
            else new.provider
          end
      )
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
           and run.lease_expires_at > new.accepted_at
           and run.status not in (
             'backlog', 'completed', 'cancelled', 'blocked', 'failed'
           ))
        +
        (select count(*)
         from briar_project_agent_task_jobs task
         join briar_execution_workers holder
           on holder.id = task.claimed_worker_id
         where holder.device_id = device.id and task.status = 'running'
           and task.lease_expires_at > new.accepted_at)
        < device.max_concurrent_sessions
      )
  )
  and (
    (
      new.source_kind = 'channel'
      and exists (
        select 1
        from briar_channels channel
        join briar_channel_messages trigger_message
          on trigger_message.id = new.trigger_message_id
         and trigger_message.channel_id = channel.id
        join briar_channel_messages reply
          on reply.id = new.reply_message_id
         and reply.channel_id = channel.id
         and reply.author_agent_id = new.agent_id
        join briar_channel_agent_reply_jobs job
          on job.id = new.source_reply_job_id
         and job.channel_id = channel.id
         and job.trigger_message_id = trigger_message.id
         and job.reply_message_id = reply.id
        join briar_channel_agents roster
          on roster.channel_id = channel.id and roster.agent_id = new.agent_id
        where channel.id = new.channel_id
          and channel.organization_id = new.organization_id
          and channel.archived_at is null
          and job.organization_id = new.organization_id
          and job.project_id = new.project_id
          and job.agent_id = new.agent_id
          and job.skill_id = new.skill_id
          and job.selected_skill_id_snapshot = new.skill_id
          and job.selected_agent_name_snapshot = new.agent_name
          and job.selected_agent_responsibility_snapshot =
            new.agent_responsibility
          and job.selected_skill_name_snapshot = new.skill_name
          and job.selected_skill_instructions_snapshot = new.skill_instructions
          and job.selected_skill_kind_snapshot = new.skill_kind
          and job.selected_skill_provider_snapshot = new.provider
          and job.selected_skill_model_snapshot is new.model
          and job.selected_skill_effort_snapshot is new.effort
          and job.skill_execution_request_snapshot = new.request
          and job.status = 'completed'
          and (
            (job.delegated_by_reply_job_id is null
              and new.request = trigger_message.body)
            or
            (job.delegated_by_reply_job_id is not null
              and new.request = job.delegation_request)
          )
          and new.delegated_by_reply_job_id is job.delegated_by_reply_job_id
          and (
            (job.delegated_by_reply_job_id is null
              and new.delegated_by_agent_id is null
              and new.delegated_by_agent_name is null)
            or exists (
              select 1
              from briar_channel_agent_reply_jobs parent
              join briar_project_agents parent_agent
                on parent_agent.id = parent.agent_id
               and parent_agent.organization_id = job.organization_id
               and parent_agent.project_id is null
              join briar_channel_agents parent_roster
                on parent_roster.channel_id = job.channel_id
               and parent_roster.agent_id = parent_agent.id
              where parent.id = job.delegated_by_reply_job_id
                and parent.organization_id = job.organization_id
                and parent.channel_id = job.channel_id
                and parent.trigger_message_id = job.trigger_message_id
                and parent.project_id is null
                and parent.delegated_by_reply_job_id is null
                and parent.status = 'completed'
                and new.delegated_by_agent_id = parent_agent.id
                and new.delegated_by_agent_name = parent_agent.name
            )
          )
          and (
            channel.visibility = 'public'
            or exists (
              select 1 from briar_channel_members member
              where member.channel_id = channel.id
                and member.user_id = new.accepted_by_user_id
            )
          )
          and (
            job.delegated_by_reply_job_id is null
            or exists (
              select 1
              from briar_channel_agent_reply_jobs parent
              join briar_project_agents parent_agent
                on parent_agent.id = parent.agent_id
               and parent_agent.project_id is null
               and parent_agent.organization_id = new.organization_id
              join briar_channel_agents parent_roster
                on parent_roster.channel_id = channel.id
               and parent_roster.agent_id = parent_agent.id
              where parent.id = job.delegated_by_reply_job_id
                and parent.organization_id = new.organization_id
                and parent.channel_id = channel.id
                and parent.trigger_message_id = job.trigger_message_id
                and parent.project_id is null
                and parent.delegated_by_reply_job_id is null
                and parent.status = 'completed'
                and new.delegated_by_agent_id = parent_agent.id
                and new.delegated_by_agent_name = parent_agent.name
            )
          )
      )
    )
    or
    (
      new.source_kind = 'issue'
      and exists (
        select 1
        from briar_hunt_runs run
        join briar_issue_messages trigger_message
          on trigger_message.id = new.trigger_message_id
         and trigger_message.project_id = run.project_id
         and trigger_message.run_id = run.id
        join briar_issue_messages reply
          on reply.id = new.reply_message_id
         and reply.project_id = run.project_id and reply.run_id = run.id
        join briar_issue_agent_reply_jobs job
          on job.id = new.source_reply_job_id
         and job.project_id = run.project_id and job.run_id = run.id
         and job.trigger_message_id = trigger_message.id
         and job.reply_message_id = reply.id
        where run.id = new.conversation_run_id
          and run.project_id = new.project_id
          and run.agent_id = new.agent_id
          and job.status = 'completed'
          and job.skill_id = new.skill_id
          and job.selected_skill_id_snapshot = new.skill_id
          and job.selected_agent_name_snapshot = new.agent_name
          and job.selected_agent_responsibility_snapshot =
            new.agent_responsibility
          and job.selected_skill_name_snapshot = new.skill_name
          and job.selected_skill_instructions_snapshot = new.skill_instructions
          and job.selected_skill_kind_snapshot = new.skill_kind
          and job.selected_skill_provider_snapshot = new.provider
          and job.selected_skill_model_snapshot is new.model
          and job.selected_skill_effort_snapshot is new.effort
          and job.skill_execution_request_snapshot = new.request
          and trigger_message.body = new.request
      )
    )
  )
)
begin
  select raise(abort, 'Agent Skill execution proposal is stale');
end;

CREATE TRIGGER briar_execution_worker_runtime_update_guard
after update of runtime_proto_json on briar_execution_workers
when exists (
  select 1 from briar_invalid_execution_worker_runtime invalid
  where invalid.id = new.id
)
begin
  select raise(abort, 'Worker runtime ProtoJSON is invalid');
end;

CREATE TRIGGER briar_dashboard_workers_update_sync
after update on briar_execution_workers
when old.project_id is not new.project_id
  or old.device_id is not new.device_id
  or old.label is not new.label
  or old.host_fingerprint is not new.host_fingerprint
  or old.runtime_proto_json is not new.runtime_proto_json
  or old.state is not new.state
  or old.accepting_work is not new.accepting_work
  or old.readiness_state is not new.readiness_state
  or old.readiness_detail is not new.readiness_detail
begin
  insert into briar_dashboard_changes (
    project_id, entity_type, entity_id, operation, created_at
  ) values (new.project_id, 'worker', new.id, 'upsert', datetime('now'));
  insert into briar_dashboard_sync_state (project_id, current_version)
  values (new.project_id, last_insert_rowid())
  on conflict (project_id) do update
    set current_version = excluded.current_version;
end;

CREATE TRIGGER briar_hunt_run_structured_result_insert_guard
before insert on briar_hunt_runs
when new.structured_result_json is not null
  and case
    when not json_valid(new.structured_result_json) then 1
    when json_type(new.structured_result_json) <> 'object' then 1
    when length(cast(new.structured_result_json as blob)) > 131072 then 1
    else 0
  end
begin
  select raise(
    abort,
    'structured agent result must be a bounded JSON object'
  );
end;

CREATE TRIGGER briar_hunt_run_structured_result_update_guard
before update of structured_result_json on briar_hunt_runs
when new.structured_result_json is not null
  and case
    when not json_valid(new.structured_result_json) then 1
    when json_type(new.structured_result_json) <> 'object' then 1
    when length(cast(new.structured_result_json as blob)) > 131072 then 1
    else 0
  end
begin
  select raise(
    abort,
    'structured agent result must be a bounded JSON object'
  );
end;

CREATE TRIGGER briar_schedule_run_structured_result_insert_guard
before insert on briar_project_agent_schedule_runs
when new.structured_result_json is not null
  and case
    when not json_valid(new.structured_result_json) then 1
    when json_type(new.structured_result_json) <> 'object' then 1
    when length(cast(new.structured_result_json as blob)) > 131072 then 1
    else 0
  end
begin
  select raise(
    abort,
    'structured agent result must be a bounded JSON object'
  );
end;

CREATE TRIGGER briar_schedule_run_structured_result_update_guard
before update of structured_result_json
on briar_project_agent_schedule_runs
when new.structured_result_json is not null
  and case
    when not json_valid(new.structured_result_json) then 1
    when json_type(new.structured_result_json) <> 'object' then 1
    when length(cast(new.structured_result_json as blob)) > 131072 then 1
    else 0
  end
begin
  select raise(
    abort,
    'structured agent result must be a bounded JSON object'
  );
end;

CREATE TRIGGER briar_hunt_run_execution_metrics_insert_guard
before insert on briar_hunt_runs
when new.execution_metrics_json is not null
  and case
    when not json_valid(new.execution_metrics_json) then 1
    when json_type(new.execution_metrics_json) <> 'object' then 1
    when length(cast(new.execution_metrics_json as blob)) > 4096 then 1
    else 0
  end
begin
  select raise(
    abort,
    'agent execution metrics must be a bounded JSON object'
  );
end;

CREATE TRIGGER briar_hunt_run_execution_metrics_update_guard
before update of execution_metrics_json on briar_hunt_runs
when new.execution_metrics_json is not null
  and case
    when not json_valid(new.execution_metrics_json) then 1
    when json_type(new.execution_metrics_json) <> 'object' then 1
    when length(cast(new.execution_metrics_json as blob)) > 4096 then 1
    else 0
  end
begin
  select raise(
    abort,
    'agent execution metrics must be a bounded JSON object'
  );
end;

CREATE TRIGGER briar_project_agent_session_payload_insert_guard
after insert on briar_project_agent_sessions
when exists (
  select 1 from briar_invalid_project_agent_session_payload invalid
  where invalid.project_id = new.project_id and invalid.id = new.id
)
begin
  select raise(abort, 'invalid stored project Agent session payload');
end;

CREATE TRIGGER briar_project_agent_session_payload_update_guard
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

CREATE TRIGGER briar_project_agent_session_summary_insert_guard
after insert on briar_project_agent_session_summaries
when exists (
  select 1 from briar_invalid_project_agent_session_summary invalid
  where invalid.project_id = new.project_id
    and invalid.session_id = new.session_id
)
begin
  select raise(abort, 'invalid stored project Agent session summary');
end;

CREATE TRIGGER briar_project_agent_session_summary_update_guard
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

CREATE TRIGGER briar_agent_skill_execution_payload_insert_guard
before insert on briar_agent_skill_execution_proposals
when new.materialized_session_payload_json is not null
begin
  select raise(abort, 'Agent Skill session payload is transient');
end;

CREATE TRIGGER briar_agent_skill_execution_payload_update_guard
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

CREATE TRIGGER briar_agent_skill_execution_payload_accept_guard
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

pragma defer_foreign_keys = off;
