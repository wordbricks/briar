-- Worker runtime metadata crosses the Connect boundary as one generated
-- WorkerRuntimeAdvertisement. Store that same ProtoJSON document instead of
-- maintaining three parallel SQL columns and hand-written JSON projections.

drop trigger if exists briar_dashboard_workers_update_sync;
drop trigger if exists briar_agent_skill_execution_task_claim_guard;
drop trigger if exists briar_agent_skill_execution_accept_guard;

-- Early development data may contain the old `{}` placeholder or a partial
-- provider catalog. It cannot be converted without inventing runtime facts.
-- Preserve the Agent's display label, clear the restrictive reference, and
-- delete those unusable project bindings before tightening the contract.
create table briar_invalid_execution_worker_runtime_ids (
  id text primary key not null
);

insert into briar_invalid_execution_worker_runtime_ids (id)
select worker.id
from briar_execution_workers worker
where case
  when not json_valid(worker.capabilities_json)
    or not json_valid(worker.versions_json)
    then 1
  else (
  worker.agent_provider not in (
    'codex', 'claude', 'cursor', 'grok', 'agy', 'opencode', 'openrouter'
  )
  or json_type(worker.capabilities_json, '$.providers') is not 'array'
  or exists (
    select 1
    from json_each(worker.capabilities_json, '$.providers') provider
    where provider.type is not 'text'
      or provider.value not in (
        'codex', 'claude', 'cursor', 'grok', 'agy', 'opencode', 'openrouter'
      )
  )
  or (
    select count(*)
    from json_each(worker.capabilities_json, '$.providers')
  ) <> (
    select count(distinct provider.value)
    from json_each(worker.capabilities_json, '$.providers') provider
  )
  or json_type(worker.capabilities_json, '$.providerHealth') is not 'object'
  or (
    select count(*) from json_each(
      worker.capabilities_json, '$.providerHealth'
    )
  ) <> 7
  or (
    select count(*)
    from json_each(worker.capabilities_json, '$.providerHealth') health
    where health.key in (
      'codex', 'claude', 'cursor', 'grok', 'agy', 'opencode', 'openrouter'
    ) and health.type = 'object'
  ) <> 7
  or exists (
    select 1
    from json_each(worker.capabilities_json, '$.providerHealth') health
    where (json_type(health.value, '$.installed') is not 'true'
        and json_type(health.value, '$.installed') is not 'false')
      or (json_type(health.value, '$.authenticated') is not 'true'
        and json_type(health.value, '$.authenticated') is not 'false')
      or (json_type(health.value, '$.healthy') is not 'true'
        and json_type(health.value, '$.healthy') is not 'false')
      or (json_type(health.value, '$.usageExhausted') is not 'true'
        and json_type(health.value, '$.usageExhausted') is not 'false')
      or (json_type(health.value, '$.reason') is not 'null'
        and json_type(health.value, '$.reason') is not 'text')
      or (json_type(health.value, '$.maxUsedPercent') is not 'null'
        and json_type(health.value, '$.maxUsedPercent') is not 'integer'
        and json_type(health.value, '$.maxUsedPercent') is not 'real')
      or length(coalesce(json_extract(health.value, '$.reason'), '')) > 64
      or coalesce(json_extract(health.value, '$.maxUsedPercent'), 0) < 0
      or coalesce(json_extract(health.value, '$.maxUsedPercent'), 0) > 100
  )
  or exists (
    select 1
    from json_each(worker.capabilities_json, '$.providerHealth') health
    where json_extract(health.value, '$.healthy') = 1
      and not exists (
        select 1
        from json_each(worker.capabilities_json, '$.providers') provider
        where provider.value = health.key
      )
  )
  or exists (
    select 1
    from json_each(worker.capabilities_json, '$.providers') provider
    where not exists (
      select 1
      from json_each(worker.capabilities_json, '$.providerHealth') health
      where health.key = provider.value
        and json_extract(health.value, '$.healthy') = 1
    )
  )
  or json_type(
    worker.capabilities_json, '$.providerCapabilities'
  ) is not 'object'
  or (
    select count(*) from json_each(
      worker.capabilities_json, '$.providerCapabilities'
    )
  ) <> 7
  or (
    select count(*)
    from json_each(
      worker.capabilities_json, '$.providerCapabilities'
    ) capability
    where capability.key in (
      'codex', 'claude', 'cursor', 'grok', 'agy', 'opencode', 'openrouter'
    ) and capability.type = 'object'
  ) <> 7
  or exists (
    select 1
    from json_each(
      worker.capabilities_json, '$.providerCapabilities'
    ) capability
    where json_type(capability.value, '$.provider') is not null
      or json_type(capability.value, '$.models') is not 'array'
      or json_type(capability.value, '$.defaultEfforts') is not 'array'
      or (json_type(capability.value, '$.allowCustomModels') is not 'true'
        and json_type(capability.value, '$.allowCustomModels') is not 'false')
      or (json_type(capability.value, '$.error') is not 'null'
        and json_type(capability.value, '$.error') is not 'text')
  )
  or (json_type(worker.capabilities_json, '$.worktrees') is not 'true'
    and json_type(worker.capabilities_json, '$.worktrees') is not 'false')
  or json_type(
    worker.capabilities_json, '$.workflowRequirements'
  ) is not 'array'
  or (json_type(worker.capabilities_json, '$.remoteUpdates') is not null
    and json_type(worker.capabilities_json, '$.remoteUpdates') is not 'object')
  or json_type(worker.versions_json) is not 'object'
  or exists (
    select 1
    from json_each(worker.versions_json) version
    where version.type is not 'text'
      or length(version.key) > 64
      or length(version.value) > 64
  )
  )
end;

update briar_project_agents
set designated_worker_id = null
where designated_worker_id in (
  select id from briar_invalid_execution_worker_runtime_ids
);

delete from briar_execution_workers
where id in (select id from briar_invalid_execution_worker_runtime_ids);

-- Convert the complete legacy catalogs losslessly to protobuf JSON field and
-- enum names. JSON null is the ProtoJSON representation of an unset optional
-- field, while explicit scalar defaults remain legal ProtoJSON.
update briar_execution_workers as worker
set capabilities_json = json_object(
  'agentProvider', case worker.agent_provider
    when 'codex' then 'AGENT_PROVIDER_CODEX'
    when 'claude' then 'AGENT_PROVIDER_CLAUDE'
    when 'cursor' then 'AGENT_PROVIDER_CURSOR'
    when 'grok' then 'AGENT_PROVIDER_GROK'
    when 'agy' then 'AGENT_PROVIDER_AGY'
    when 'opencode' then 'AGENT_PROVIDER_OPENCODE'
    when 'openrouter' then 'AGENT_PROVIDER_OPENROUTER'
  end,
  'providerHealth', json((
    select json_group_array(json(health_json))
    from (
      select json_object(
        'provider', case health.key
          when 'codex' then 'AGENT_PROVIDER_CODEX'
          when 'claude' then 'AGENT_PROVIDER_CLAUDE'
          when 'cursor' then 'AGENT_PROVIDER_CURSOR'
          when 'grok' then 'AGENT_PROVIDER_GROK'
          when 'agy' then 'AGENT_PROVIDER_AGY'
          when 'opencode' then 'AGENT_PROVIDER_OPENCODE'
          when 'openrouter' then 'AGENT_PROVIDER_OPENROUTER'
        end,
        'installed', json(case
          when json_extract(health.value, '$.installed') = 1
            then 'true' else 'false' end),
        'authenticated', json(case
          when json_extract(health.value, '$.authenticated') = 1
            then 'true' else 'false' end),
        'healthy', json(case
          when json_extract(health.value, '$.healthy') = 1
            then 'true' else 'false' end),
        'reason', json_extract(health.value, '$.reason'),
        'usageExhausted', json(case
          when json_extract(health.value, '$.usageExhausted') = 1
            then 'true' else 'false' end),
        'maxUsedPercent', json_extract(health.value, '$.maxUsedPercent')
      ) as health_json
      from json_each(
        worker.capabilities_json, '$.providerHealth'
      ) health
      order by case health.key
        when 'codex' then 1 when 'claude' then 2 when 'cursor' then 3
        when 'grok' then 4 when 'agy' then 5 when 'opencode' then 6
        when 'openrouter' then 7
      end
    ) ordered_health
  )),
  'capabilities', json_object(
    'providerCapabilities', json((
      select json_group_array(json(capability_json))
      from (
        select json_patch(
          json(capability.value),
          json_object(
            'provider', case capability.key
              when 'codex' then 'AGENT_PROVIDER_CODEX'
              when 'claude' then 'AGENT_PROVIDER_CLAUDE'
              when 'cursor' then 'AGENT_PROVIDER_CURSOR'
              when 'grok' then 'AGENT_PROVIDER_GROK'
              when 'agy' then 'AGENT_PROVIDER_AGY'
              when 'opencode' then 'AGENT_PROVIDER_OPENCODE'
              when 'openrouter' then 'AGENT_PROVIDER_OPENROUTER'
            end
          )
        ) as capability_json
        from json_each(
          worker.capabilities_json, '$.providerCapabilities'
        ) capability
        order by case capability.key
          when 'codex' then 1 when 'claude' then 2 when 'cursor' then 3
          when 'grok' then 4 when 'agy' then 5 when 'opencode' then 6
          when 'openrouter' then 7
        end
      ) ordered_capabilities
    )),
    'remoteUpdates', json_extract(
      worker.capabilities_json, '$.remoteUpdates'
    ),
    'worktrees', json(case
      when json_extract(worker.capabilities_json, '$.worktrees') = 1
        then 'true' else 'false' end),
    'workflowRequirements', json_extract(
      worker.capabilities_json, '$.workflowRequirements'
    ),
    'dmMemoryProtocol', json_extract(
      worker.capabilities_json, '$.dmMemory.protocol'
    )
  ),
  'versions', json(worker.versions_json)
);

alter table briar_execution_workers
  rename column capabilities_json to runtime_proto_json;
alter table briar_execution_workers drop column versions_json;
alter table briar_execution_workers drop column agent_provider;

insert or ignore into briar_invalid_execution_worker_runtime_ids (id)
select id
from briar_execution_workers
where length(cast(runtime_proto_json as blob)) > 1048576;

update briar_project_agents
set designated_worker_id = null
where designated_worker_id in (
  select id from briar_invalid_execution_worker_runtime_ids
);

delete from briar_execution_workers
where id in (select id from briar_invalid_execution_worker_runtime_ids);

drop table briar_invalid_execution_worker_runtime_ids;

-- SQL safety guards need a queryable relational projection. It is derived
-- exclusively from the stored generated message and carries no mutable state.
create view briar_execution_worker_healthy_providers as
select worker.id as worker_id,
       case json_extract(health.value, '$.provider')
         when 'AGENT_PROVIDER_CODEX' then 'codex'
         when 'AGENT_PROVIDER_CLAUDE' then 'claude'
         when 'AGENT_PROVIDER_CURSOR' then 'cursor'
         when 'AGENT_PROVIDER_GROK' then 'grok'
         when 'AGENT_PROVIDER_AGY' then 'agy'
         when 'AGENT_PROVIDER_OPENCODE' then 'opencode'
         when 'AGENT_PROVIDER_OPENROUTER' then 'openrouter'
       end as provider,
       case json_extract(worker.runtime_proto_json, '$.agentProvider')
         when 'AGENT_PROVIDER_CODEX' then 'codex'
         when 'AGENT_PROVIDER_CLAUDE' then 'claude'
         when 'AGENT_PROVIDER_CURSOR' then 'cursor'
         when 'AGENT_PROVIDER_GROK' then 'grok'
         when 'AGENT_PROVIDER_AGY' then 'agy'
         when 'AGENT_PROVIDER_OPENCODE' then 'opencode'
         when 'AGENT_PROVIDER_OPENROUTER' then 'openrouter'
       end as agent_provider
from briar_execution_workers worker,
     json_each(worker.runtime_proto_json, '$.providerHealth') health
where json_extract(health.value, '$.healthy') = 1
  and json_extract(health.value, '$.provider') in (
    'AGENT_PROVIDER_CODEX', 'AGENT_PROVIDER_CLAUDE',
    'AGENT_PROVIDER_CURSOR', 'AGENT_PROVIDER_GROK', 'AGENT_PROVIDER_AGY',
    'AGENT_PROVIDER_OPENCODE', 'AGENT_PROVIDER_OPENROUTER'
  );

-- This view centralizes the subset of the generated contract on which SQL
-- scheduling depends. Full message validation remains at the Connect ingress.
create view briar_invalid_execution_worker_runtime as
select worker.id
from briar_execution_workers worker
where not (
  json_valid(worker.runtime_proto_json)
  and json_type(worker.runtime_proto_json) = 'object'
  and length(cast(worker.runtime_proto_json as blob)) <= 1048576
  and json_extract(worker.runtime_proto_json, '$.agentProvider') in (
    'AGENT_PROVIDER_CODEX', 'AGENT_PROVIDER_CLAUDE',
    'AGENT_PROVIDER_CURSOR', 'AGENT_PROVIDER_GROK', 'AGENT_PROVIDER_AGY',
    'AGENT_PROVIDER_OPENCODE', 'AGENT_PROVIDER_OPENROUTER'
  )
  and json_type(worker.runtime_proto_json, '$.providerHealth') = 'array'
  and json_array_length(worker.runtime_proto_json, '$.providerHealth') = 7
  and (
    select count(distinct json_extract(health.value, '$.provider'))
    from json_each(worker.runtime_proto_json, '$.providerHealth') health
    where health.type = 'object'
      and json_extract(health.value, '$.provider') in (
        'AGENT_PROVIDER_CODEX', 'AGENT_PROVIDER_CLAUDE',
        'AGENT_PROVIDER_CURSOR', 'AGENT_PROVIDER_GROK', 'AGENT_PROVIDER_AGY',
        'AGENT_PROVIDER_OPENCODE', 'AGENT_PROVIDER_OPENROUTER'
      )
  ) = 7
  and json_type(worker.runtime_proto_json, '$.capabilities') = 'object'
  and json_type(
    worker.runtime_proto_json, '$.capabilities.providerCapabilities'
  ) = 'array'
  and json_array_length(
    worker.runtime_proto_json, '$.capabilities.providerCapabilities'
  ) = 7
  and (
    select count(distinct json_extract(capability.value, '$.provider'))
    from json_each(
      worker.runtime_proto_json, '$.capabilities.providerCapabilities'
    ) capability
    where capability.type = 'object'
      and json_extract(capability.value, '$.provider') in (
        'AGENT_PROVIDER_CODEX', 'AGENT_PROVIDER_CLAUDE',
        'AGENT_PROVIDER_CURSOR', 'AGENT_PROVIDER_GROK', 'AGENT_PROVIDER_AGY',
        'AGENT_PROVIDER_OPENCODE', 'AGENT_PROVIDER_OPENROUTER'
      )
  ) = 7
  and (
    json_type(worker.runtime_proto_json, '$.versions') is null
    or json_type(worker.runtime_proto_json, '$.versions') = 'object'
  )
);

create trigger briar_execution_worker_runtime_insert_guard
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

create trigger briar_agent_skill_execution_accept_guard
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


create trigger briar_execution_worker_runtime_update_guard
after update of runtime_proto_json on briar_execution_workers
when exists (
  select 1 from briar_invalid_execution_worker_runtime invalid
  where invalid.id = new.id
)
begin
  select raise(abort, 'Worker runtime ProtoJSON is invalid');
end;

-- Exercise the permanent write guard against every converted row before the
-- migration can commit.
update briar_execution_workers
set runtime_proto_json = runtime_proto_json;

create trigger briar_dashboard_workers_update_sync
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
