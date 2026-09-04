pragma defer_foreign_keys = on;

CREATE TRIGGER briar_agent_skill_execution_materialize
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

CREATE TRIGGER briar_conversation_issue_creation_project_guard
before insert on briar_hunt_runs
when new.source = 'issue'
  and new.source_key like 'briar-conversation-approved:%'
  and not exists (
    select 1 from briar_hunt_runs existing
    where existing.project_id = new.project_id
      and existing.source = new.source
      and existing.source_key = new.source_key
  )
  and (
    new.status <> 'backlog'
    or new.stage <> 'queued'
    or new.workflow_stage is not null
    or new.worker_id is not null
    or new.agent_id is not null
    or new.requested_worker_id is not null
    or new.claim_token_hash is not null
    or new.claimed_by is not null
    or new.claimed_at is not null
    or new.lease_expires_at is not null
    or new.last_execution_id is not null
    or new.dispatch_mode is not null
    or new.dispatch_request_id is not null
    or new.dispatched_at is not null
    or new.requested_by_user_id is not null
    or new.requested_agent_provider is not null
    or new.requested_agent_model is not null
    or new.requested_agent_effort is not null
    or new.completed_at is not null
    or new.paused_at is not null
    or new.resume_requested_at is not null
    or not exists (
      select 1
      from briar_issue_action_proposals proposal
      join briar_hunt_runs conversation
        on conversation.id = proposal.conversation_run_id
       and conversation.project_id = proposal.project_id
      where proposal.status = 'pending'
        and proposal.action_type = 'request_issue_create'
        and proposal.project_id = new.project_id
        and proposal.approval_reserved_by_user_id is not null
        and proposal.approval_reserved_at is not null
        and proposal.issue_source_key = new.source_key
        and new.title = json_extract(proposal.payload_json, '$.issue.title')
        and new.issue_description is
          json_extract(proposal.payload_json, '$.issue.description')
        and new.priority is
          json_extract(proposal.payload_json, '$.issue.priority')
        and new.issue_checkpoints_json = '[]'
        and new.preferred_agent_provider is null
        and new.preferred_agent_model is null
        and new.preferred_agent_effort is null
        and json_extract(new.context_json, '$.origin') =
          'briar-conversation'
        and json_extract(new.context_json, '$.proposalId') = proposal.id
        and json_extract(new.context_json, '$.conversationRunId') =
          proposal.conversation_run_id
        and new.full_auto = 0
        and new.requires_claim_token = 0
    )
    or exists (
      select 1 from briar_hunt_runs existing
      where existing.source = new.source
        and existing.source_key = new.source_key
        and existing.project_id <> new.project_id
    )
  )
BEGIN
  select raise(abort, 'conversation proposal no longer belongs to project');
END;

CREATE TRIGGER briar_hunt_runs_channel_proposal_reservation_required
before insert on briar_hunt_runs
when new.source = 'issue'
  and new.source_key like 'briar-channel-approved:%'
  and not exists (
    select 1 from briar_hunt_runs existing
    where existing.project_id = new.project_id
      and existing.source = new.source
      and existing.source_key = new.source_key
  )
  and not exists (
    select 1
    from briar_channel_action_proposals proposal
    join briar_channels channel on channel.id = proposal.channel_id
    join briar_projects project
      on project.id = proposal.project_id
     and project.organization_id = channel.organization_id
    where proposal.status = 'pending'
      and proposal.action_type = 'request_issue_create'
      and proposal.project_id = new.project_id
      and proposal.issue_source_key = new.source_key
      and proposal.accepted_by_user_id is not null
      and proposal.accepted_at is not null
      and (
        length(new.source_key) = 87
        and substr(new.source_key, 1, 23) = 'briar-channel-approved:'
        and substr(new.source_key, 24) not glob '*[^0-9a-f]*'
      )
      and (
        json_type(proposal.payload_json) = 'object'
        and (select count(*) from json_each(proposal.payload_json)) = 1
        and json_type(proposal.payload_json, '$.issue') = 'object'
        and (
          select count(*)
          from json_each(proposal.payload_json, '$.issue')
        ) = 3
        and json_type(proposal.payload_json, '$.issue.title') = 'text'
        and json_type(
          proposal.payload_json, '$.issue.description'
        ) in ('text', 'null')
        and json_type(
          proposal.payload_json, '$.issue.priority'
        ) in ('integer', 'null')
      )
      and (
        new.title = json_extract(proposal.payload_json, '$.issue.title')
        and new.issue_description is
          json_extract(proposal.payload_json, '$.issue.description')
        and new.priority is
          json_extract(proposal.payload_json, '$.issue.priority')
        and new.status = 'backlog'
        and new.stage = 'queued'
        and new.workflow_stage is null
        and new.issue_checkpoints_json = '[]'
        and new.detail =
          '채널 대화에서 사용자가 승인한 제안으로 생성된 이슈입니다.'
        and new.repository = coalesce(
          (select settings.github_repository
           from briar_project_settings settings
           where settings.project_id = proposal.project_id),
          project.name
        )
      )
      and (
        new.assignee_user_id is null
        and new.agent_id is null
        and new.worker_id is null
        and new.requested_worker_id is null
        and new.claim_token_hash is null
        and new.claimed_by is null
        and new.claimed_at is null
        and new.lease_expires_at is null
        and new.claim_attempts = 0
        and new.current_attempt = 1
        and new.current_revision = 1
        and new.full_auto = 0
        and new.requires_claim_token = 0
      )
      and (
        new.last_execution_id is null
        and new.dispatch_mode is null
        and new.dispatch_request_id is null
        and new.dispatched_at is null
        and new.requested_by_user_id is null
        and new.requested_agent_provider is null
        and new.requested_agent_model is null
        and new.requested_agent_effort is null
        and new.preferred_agent_provider is null
        and new.preferred_agent_model is null
        and new.preferred_agent_effort is null
      )
      and (
        new.branch is null
        and new.commit_sha is null
        and new.tracker_provider is null
        and new.tracker_issue_id is null
        and new.tracker_issue_identifier is null
        and new.tracker_issue_url is null
        and new.tracker_issue_state is null
        and new.result_summary is null
        and new.structured_result_json is null
        and new.pull_request_urls = '[]'
        and new.target_sha is null
        and new.staging_qa_status is null
        and new.production_qa_status is null
        and new.staging_qa_detail is null
        and new.production_qa_detail is null
        and new.execution_metrics_json is null
      )
      and (
        new.completed_at is null
        and new.paused_at is null
        and new.resume_requested_at is null
        and new.waiting_checkpoint_key is null
        and new.waiting_checkpoint_revision is null
        and new.event_count = 0
        and new.source_created_at = proposal.created_at
        and new.started_at = proposal.created_at
        and new.last_event_at = proposal.created_at
        and new.created_at = new.updated_at
      )
      and (
        json_type(new.context_json) = 'object'
        and (select count(*) from json_each(new.context_json)) = 6
        and json_type(new.context_json, '$.origin') = 'text'
        and json_extract(new.context_json, '$.origin') = 'briar-channel'
        and json_type(new.context_json, '$.proposalId') = 'text'
        and json_extract(new.context_json, '$.proposalId') = proposal.id
        and json_type(new.context_json, '$.channelId') = 'text'
        and json_extract(new.context_json, '$.channelId') = proposal.channel_id
        and json_type(new.context_json, '$.issueId') = 'text'
        and json_extract(new.context_json, '$.issueId') = proposal.id
        and json_type(new.context_json, '$.attachmentCount') = 'integer'
        and json_extract(new.context_json, '$.attachmentCount') = 0
        and json_type(new.context_json, '$.relatedMessage') = 'object'
        and (
          select count(*)
          from json_each(new.context_json, '$.relatedMessage')
        ) = 4
        and json_type(
          new.context_json, '$.relatedMessage.organizationId'
        ) = 'text'
        and json_extract(
          new.context_json, '$.relatedMessage.organizationId'
        ) = channel.organization_id
        and json_type(
          new.context_json, '$.relatedMessage.channelId'
        ) = 'text'
        and json_extract(
          new.context_json, '$.relatedMessage.channelId'
        ) = proposal.channel_id
        and json_type(
          new.context_json, '$.relatedMessage.messageId'
        ) = 'text'
        and json_extract(
          new.context_json, '$.relatedMessage.messageId'
        ) = proposal.reply_message_id
        and json_type(
          new.context_json, '$.relatedMessage.rootMessageId'
        ) = 'text'
      )
  )
BEGIN
  select raise(abort, 'channel proposal approval reservation not found');
END;

CREATE TRIGGER briar_hunt_runs_finalize_channel_proposal_approval
after insert on briar_hunt_runs
when new.source = 'issue'
  and new.source_key like 'briar-channel-approved:%'
  and exists (
    select 1
    from briar_channel_action_proposals proposal
    join briar_channels channel on channel.id = proposal.channel_id
    join briar_projects project
      on project.id = proposal.project_id
     and project.organization_id = channel.organization_id
    where proposal.status = 'pending'
      and proposal.action_type = 'request_issue_create'
      and proposal.project_id = new.project_id
      and proposal.issue_source_key = new.source_key
      and proposal.accepted_by_user_id is not null
      and proposal.accepted_at is not null
      and (
        length(new.source_key) = 87
        and substr(new.source_key, 1, 23) = 'briar-channel-approved:'
        and substr(new.source_key, 24) not glob '*[^0-9a-f]*'
      )
      and (
        json_type(proposal.payload_json) = 'object'
        and (select count(*) from json_each(proposal.payload_json)) = 1
        and json_type(proposal.payload_json, '$.issue') = 'object'
        and (
          select count(*)
          from json_each(proposal.payload_json, '$.issue')
        ) = 3
        and json_type(proposal.payload_json, '$.issue.title') = 'text'
        and json_type(
          proposal.payload_json, '$.issue.description'
        ) in ('text', 'null')
        and json_type(
          proposal.payload_json, '$.issue.priority'
        ) in ('integer', 'null')
      )
      and (
        new.title = json_extract(proposal.payload_json, '$.issue.title')
        and new.issue_description is
          json_extract(proposal.payload_json, '$.issue.description')
        and new.priority is
          json_extract(proposal.payload_json, '$.issue.priority')
        and new.status = 'backlog'
        and new.stage = 'queued'
        and new.workflow_stage is null
        and new.issue_checkpoints_json = '[]'
        and new.detail =
          '채널 대화에서 사용자가 승인한 제안으로 생성된 이슈입니다.'
        and new.repository = coalesce(
          (select settings.github_repository
           from briar_project_settings settings
           where settings.project_id = proposal.project_id),
          project.name
        )
      )
      and (
        new.assignee_user_id is null
        and new.agent_id is null
        and new.worker_id is null
        and new.requested_worker_id is null
        and new.claim_token_hash is null
        and new.claimed_by is null
        and new.claimed_at is null
        and new.lease_expires_at is null
        and new.claim_attempts = 0
        and new.current_attempt = 1
        and new.current_revision = 1
        and new.full_auto = 0
        and new.requires_claim_token = 0
      )
      and (
        new.last_execution_id is null
        and new.dispatch_mode is null
        and new.dispatch_request_id is null
        and new.dispatched_at is null
        and new.requested_by_user_id is null
        and new.requested_agent_provider is null
        and new.requested_agent_model is null
        and new.requested_agent_effort is null
        and new.preferred_agent_provider is null
        and new.preferred_agent_model is null
        and new.preferred_agent_effort is null
      )
      and (
        new.branch is null
        and new.commit_sha is null
        and new.tracker_provider is null
        and new.tracker_issue_id is null
        and new.tracker_issue_identifier is null
        and new.tracker_issue_url is null
        and new.tracker_issue_state is null
        and new.result_summary is null
        and new.structured_result_json is null
        and new.pull_request_urls = '[]'
        and new.target_sha is null
        and new.staging_qa_status is null
        and new.production_qa_status is null
        and new.staging_qa_detail is null
        and new.production_qa_detail is null
        and new.execution_metrics_json is null
      )
      and (
        new.completed_at is null
        and new.paused_at is null
        and new.resume_requested_at is null
        and new.waiting_checkpoint_key is null
        and new.waiting_checkpoint_revision is null
        and new.event_count = 0
        and new.source_created_at = proposal.created_at
        and new.started_at = proposal.created_at
        and new.last_event_at = proposal.created_at
        and new.created_at = new.updated_at
      )
      and (
        json_type(new.context_json) = 'object'
        and (select count(*) from json_each(new.context_json)) = 6
        and json_type(new.context_json, '$.origin') = 'text'
        and json_extract(new.context_json, '$.origin') = 'briar-channel'
        and json_type(new.context_json, '$.proposalId') = 'text'
        and json_extract(new.context_json, '$.proposalId') = proposal.id
        and json_type(new.context_json, '$.channelId') = 'text'
        and json_extract(new.context_json, '$.channelId') = proposal.channel_id
        and json_type(new.context_json, '$.issueId') = 'text'
        and json_extract(new.context_json, '$.issueId') = proposal.id
        and json_type(new.context_json, '$.attachmentCount') = 'integer'
        and json_extract(new.context_json, '$.attachmentCount') = 0
        and json_type(new.context_json, '$.relatedMessage') = 'object'
        and (
          select count(*)
          from json_each(new.context_json, '$.relatedMessage')
        ) = 4
        and json_type(
          new.context_json, '$.relatedMessage.organizationId'
        ) = 'text'
        and json_extract(
          new.context_json, '$.relatedMessage.organizationId'
        ) = channel.organization_id
        and json_type(
          new.context_json, '$.relatedMessage.channelId'
        ) = 'text'
        and json_extract(
          new.context_json, '$.relatedMessage.channelId'
        ) = proposal.channel_id
        and json_type(
          new.context_json, '$.relatedMessage.messageId'
        ) = 'text'
        and json_extract(
          new.context_json, '$.relatedMessage.messageId'
        ) = proposal.reply_message_id
        and json_type(
          new.context_json, '$.relatedMessage.rootMessageId'
        ) = 'text'
      )
  )
BEGIN
  insert into briar_channel_issue_approval_audit (
    id, proposal_id, organization_id, channel_id, project_id, run_id,
    approved_by_user_id, approved_at, issue_source_key, result_verification,
    payload_json, created_at
  )
  select proposal.id || ':approval:' || proposal.issue_source_key,
         proposal.id, channel.organization_id, proposal.channel_id,
         proposal.project_id, new.id, proposal.accepted_by_user_id,
         proposal.accepted_at, proposal.issue_source_key, 'atomic',
         proposal.payload_json, proposal.accepted_at
  from briar_channel_action_proposals proposal
  join briar_channels channel on channel.id = proposal.channel_id
  where proposal.status = 'pending'
    and proposal.action_type = 'request_issue_create'
    and proposal.project_id = new.project_id
    and proposal.issue_source_key = new.source_key
    and proposal.accepted_by_user_id is not null
    and proposal.accepted_at is not null;
  update briar_channel_action_proposals
  set status = 'accepted', result_run_id = new.id, updated_at = accepted_at
  where status = 'pending' and action_type = 'request_issue_create'
    and project_id = new.project_id and issue_source_key = new.source_key
    and accepted_by_user_id is not null and accepted_at is not null;
END;

CREATE TRIGGER briar_channel_issue_approval_audit_atomic_insert_guard
before insert on briar_channel_issue_approval_audit
when new.result_verification <> 'atomic'
begin
  select raise(abort, 'channel issue approval requires atomic verification');
end;

CREATE TRIGGER briar_channel_issue_approval_audit_atomic_update_guard
before update of result_verification on briar_channel_issue_approval_audit
when new.result_verification <> 'atomic'
begin
  select raise(abort, 'channel issue approval requires atomic verification');
end;

CREATE TRIGGER briar_channel_issue_approval_finalize_guard
before update of status on briar_channel_action_proposals
when old.status = 'pending' and new.status = 'accepted'
  and old.action_type = 'request_issue_create'
  and not exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.proposal_id = old.id
      and approval.result_verification = 'atomic'
      and approval.run_id = new.result_run_id
      and approval.project_id = new.project_id
      and approval.issue_source_key = new.issue_source_key
      and approval.approved_by_user_id is new.accepted_by_user_id
      and approval.approved_at = new.accepted_at
  )
begin
  select raise(abort, 'channel proposal acceptance requires atomic approval');
end;

CREATE TRIGGER briar_channel_approved_backlog_event_guard
before insert on briar_hunt_events
when new.status not in ('backlog', 'cancelled')
  and new.actor not like 'briar-app:%'
  and exists (
    select 1
    from briar_hunt_runs run
    join briar_channel_issue_approval_audit approval
      on approval.run_id = run.id
     and approval.issue_source_key = run.source_key
    where run.id = new.run_id
      and run.source = 'issue'
      and run.status in ('backlog', 'cancelled')
      and approval.result_verification = 'atomic'
  )
begin
  select raise(
    abort, 'channel-approved issue execution requires explicit dispatch'
  );
end;

CREATE TRIGGER briar_channel_approved_backlog_context_guard
before update of context_json on briar_hunt_runs
when old.status in ('backlog', 'cancelled')
  and new.context_json is not old.context_json
  and exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.run_id = old.id
      and approval.issue_source_key = old.source_key
      and approval.result_verification = 'atomic'
  )
begin
  select raise(
    abort, 'channel-approved issue context is immutable before dispatch'
  );
end;

CREATE TRIGGER briar_channel_approved_retryable_transfer_guard
before update of project_id, status on briar_hunt_runs
when old.status in ('queued', 'blocked', 'failed')
  and new.project_id <> old.project_id
  and exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.run_id = old.id
      and approval.issue_source_key = old.source_key
      and approval.result_verification = 'atomic'
  )
  and not (
    new.status = 'backlog'
    and new.stage = 'queued'
    and new.workflow_stage is null
    and new.agent_id is null
    and new.worker_id is null
    and new.requested_worker_id is null
    and new.claim_token_hash is null
    and new.claimed_by is null
    and new.claimed_at is null
    and new.lease_expires_at is null
    and new.last_execution_id is null
    and new.dispatch_mode is null
    and new.dispatch_request_id is null
    and new.dispatched_at is null
    and new.requested_by_user_id is null
    and new.requested_agent_provider is null
    and new.requested_agent_model is null
    and new.requested_agent_effort is null
    and new.paused_at is null
    and new.resume_requested_at is null
    and new.completed_at is null
  )
begin
  select raise(
    abort, 'channel-approved retryable transfer requires execution reset'
  );
end;

CREATE TRIGGER briar_channel_approved_terminal_transfer_guard
before update of project_id on briar_hunt_runs
when old.status in ('completed', 'cancelled')
  and new.project_id <> old.project_id
  and exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.run_id = old.id
      and approval.issue_source_key = old.source_key
      and approval.result_verification = 'atomic'
  )
begin
  select raise(
    abort, 'channel-approved terminal issue transfer is not allowed'
  );
end;

CREATE TRIGGER briar_channel_approved_terminal_reactivation_guard
before update of status on briar_hunt_runs
when old.status in ('completed', 'cancelled')
  and new.status not in ('completed', 'cancelled')
  and exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.run_id = old.id
      and approval.issue_source_key = old.source_key
      and approval.result_verification = 'atomic'
  )
begin
  select raise(
    abort, 'approved issue terminal reactivation requires fresh execution approval'
  );
end;

CREATE TRIGGER briar_channel_approved_dispatch_clear_guard
before update of dispatch_request_id, status on briar_hunt_runs
when old.dispatch_request_id is not null
  and new.dispatch_request_id is null
  and new.status not in ('backlog', 'completed', 'cancelled')
  and exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.run_id = old.id
      and approval.issue_source_key = old.source_key
      and approval.result_verification = 'atomic'
  )
begin
  select raise(
    abort, 'channel-approved dispatch cancellation requires backlog reset'
  );
end;

CREATE TRIGGER briar_channel_approved_dispatch_preference_snapshot
after update of dispatch_request_id on briar_hunt_runs
when new.dispatch_request_id is not null
  and new.dispatch_request_id is not old.dispatch_request_id
  and new.requested_agent_provider is not null
  and exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.run_id = new.id
      and approval.issue_source_key = new.source_key
      and approval.result_verification = 'atomic'
  )
begin
  update briar_hunt_runs
  set preferred_agent_provider = new.requested_agent_provider,
      preferred_agent_model = new.requested_agent_model,
      preferred_agent_effort = new.requested_agent_effort
  where id = new.id;
end;

CREATE TRIGGER briar_channel_approved_dispatch_preference_guard
before update of preferred_agent_provider, preferred_agent_model,
  preferred_agent_effort on briar_hunt_runs
when old.dispatch_request_id is not null
  and exists (
    select 1 from briar_channel_issue_approval_audit approval
    where approval.run_id = old.id
      and approval.issue_source_key = old.source_key
      and approval.result_verification = 'atomic'
  )
  and not (
    new.preferred_agent_provider is old.preferred_agent_provider
    and new.preferred_agent_model is old.preferred_agent_model
    and new.preferred_agent_effort is old.preferred_agent_effort
  )
  and not (
    new.dispatch_request_id is old.dispatch_request_id
    and new.requested_agent_provider is old.requested_agent_provider
    and new.requested_agent_model is old.requested_agent_model
    and new.requested_agent_effort is old.requested_agent_effort
    and new.preferred_agent_provider is old.requested_agent_provider
    and new.preferred_agent_model is old.requested_agent_model
    and new.preferred_agent_effort is old.requested_agent_effort
  )
  and not (
    new.project_id is old.project_id
    and new.source is old.source
    and new.source_key is old.source_key
    and new.dispatch_request_id is not null
    and new.dispatch_request_id is not old.dispatch_request_id
    and new.dispatched_at is not null
    and new.requested_by_user_id is not null
    and new.requested_agent_provider is not null
    and new.status = 'queued'
    and new.stage = 'queued'
    and new.workflow_stage is null
    and new.dispatch_mode in ('any', 'specific')
    and (
      (new.dispatch_mode = 'any' and new.requested_worker_id is null)
      or
      (new.dispatch_mode = 'specific' and new.requested_worker_id is not null)
    )
    and new.worker_id is null
    and new.claim_token_hash is null
    and new.claimed_by is null
    and new.claimed_at is null
    and new.lease_expires_at is null
    and new.preferred_agent_provider is new.requested_agent_provider
    and new.preferred_agent_model is new.requested_agent_model
    and new.preferred_agent_effort is new.requested_agent_effort
  )
begin
  select raise(
    abort, 'approved channel issue dispatch preferences are immutable'
  );
end;

CREATE TRIGGER briar_hunt_runs_channel_proposal_project_guard
before insert on briar_hunt_runs
when new.source = 'issue'
  and new.source_key like 'briar-channel-approved:%'
  and not exists (
    select 1 from briar_hunt_runs existing
    where existing.source = new.source
      and existing.source_key = new.source_key
      and existing.project_id = new.project_id
  )
  and exists (
    select 1 from briar_hunt_runs existing
    where existing.source = new.source
      and existing.source_key = new.source_key
      and existing.project_id <> new.project_id
  )
begin
  select raise(abort, 'channel proposal issue project conflict');
end;

CREATE TRIGGER briar_hunt_runs_channel_proposal_reservation_guard
before insert on briar_hunt_runs
when new.source = 'issue'
  and new.source_key like 'briar-channel-approved:%'
  and exists (
    select 1 from briar_channel_action_proposals proposal
    where proposal.issue_source_key = new.source_key
      and proposal.project_id is not null
      and proposal.project_id <> new.project_id
  )
begin
  select raise(abort, 'channel proposal issue project conflict');
end;

CREATE TRIGGER briar_hunt_runs_context_policy_insert_guard
before insert on briar_hunt_runs
when json_type(new.context_json, '$.fullAuto') is not null
begin
  select raise(abort, 'run context cannot contain execution policy');
end;

CREATE TRIGGER briar_hunt_runs_context_policy_update_guard
before update of context_json on briar_hunt_runs
when json_type(new.context_json, '$.fullAuto') is not null
begin
  select raise(abort, 'run context cannot contain execution policy');
end;

CREATE TRIGGER briar_reply_completion_receipt_insert_guard
before insert on briar_reply_completion_receipts
when not (
  (
    new.reply_kind = 'issue'
    and exists (
      select 1
      from briar_issue_agent_reply_jobs job
      join briar_projects project on project.id = job.project_id
      join briar_execution_workers worker
        on worker.id = job.claimed_worker_id
       and worker.project_id = job.project_id
      where job.id = new.work_id and job.project_id = new.project_id
        and job.run_id = new.run_id
        and project.organization_id = new.organization_id
        and worker.id = new.worker_id and worker.device_id = new.device_id
        and job.claim_token_hash = new.claim_token_hash
        and (
          (new.outcome_kind = 'success'
            and new.disposition = 'completed'
            and job.status = 'completed'
            and job.completed_at = new.created_at)
          or
          (new.outcome_kind = 'failure'
            and job.updated_at = new.created_at
            and (
              (job.attempts < 3 and new.disposition = 'requeued'
                and job.status = 'queued')
              or
              (new.disposition = 'failed' and job.status = 'failed')
            ))
        )
    )
  )
  or
  (
    new.reply_kind = 'channel'
    and exists (
      select 1
      from briar_channel_agent_reply_jobs job
      join briar_execution_workers worker
        on worker.id = job.claimed_worker_id
       and worker.device_id = job.claimed_device_id
      join briar_projects project on project.id = worker.project_id
      where job.id = new.work_id and job.channel_id = new.run_id
        and job.organization_id = new.organization_id
        and project.id = new.project_id
        and project.organization_id = new.organization_id
        and worker.id = new.worker_id and worker.device_id = new.device_id
        and job.claim_token_hash = new.claim_token_hash
        and (
          (new.outcome_kind = 'success'
            and new.disposition = 'completed'
            and job.status = 'completed'
            and job.completed_at = new.created_at)
          or
          (new.outcome_kind = 'failure'
            and job.updated_at = new.created_at
            and (
              (new.disposition = 'requeued' and job.status = 'queued')
              or
              (new.disposition = 'failed' and job.status = 'failed')
            ))
        )
    )
  )
)
begin
  select raise(abort, 'invalid reply completion receipt');
end;

CREATE TRIGGER briar_channel_reply_session_events_immutable_update
before update on briar_channel_reply_session_events
when not (
  old.reply_job_id is not null
  and new.reply_job_id is null
  and new.id is old.id
  and new.session_id is old.session_id
  and new.event_type is old.event_type
  and new.reason is old.reason
  and new.from_worker_id is old.from_worker_id
  and new.to_worker_id is old.to_worker_id
  and new.retained_until is old.retained_until
  and new.detail_json is old.detail_json
  and new.occurred_at is old.occurred_at
)
begin
  select raise(abort, 'Channel reply session events are immutable');
end;

pragma defer_foreign_keys = off;
