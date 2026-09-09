/** Older installations retain their existing reply path until a Worker advertises routing. */
export async function dmReplyRoutingAvailable(db: D1Database, input: {
  organizationId: string; channelId: string; provider: string; preferredDeviceId?: string | null;
}) {
  return Boolean(await db.prepare(`select channel.id from briar_channels channel
    join briar_channel_agents roster on roster.channel_id = channel.id
    join briar_project_agents agent on agent.id = roster.agent_id
    where channel.id = ? and channel.organization_id = ? and channel.kind = 'dm'
      and (select count(*) from briar_channel_members where channel_id = channel.id) = 1
      and (select count(*) from briar_channel_agents where channel_id = channel.id) = 1
      and exists (select 1 from briar_execution_workers binding
        join briar_execution_worker_devices device on device.id = binding.device_id
        where device.organization_id = channel.organization_id
          and binding.state <> 'disabled' and device.state <> 'disabled'
          and (agent.designated_worker_id is null or binding.id = agent.designated_worker_id)
          and (agent.project_id is null or binding.project_id = agent.project_id)
          and (agent.designated_worker_id is not null or ? is null or device.id = ?)
          and json_valid(binding.runtime_proto_json)
          and not exists (select 1 from briar_project_execution_worker_policies policy
            where policy.project_id = agent.project_id and policy.selection_mode = 'allowlist'
              and not exists (select 1 from briar_project_execution_worker_allowlist allowed
                where allowed.project_id = agent.project_id and allowed.worker_id = binding.id))
          and json_extract(binding.runtime_proto_json, '$.capabilities.dmReplyRouting.protocol') = 1
          and json_extract(binding.runtime_proto_json, '$.capabilities.dmPublicMessages.protocol') = 1
          and exists (select 1 from json_each(binding.runtime_proto_json,
            '$.capabilities.dmReplyRouting.providers') provider where provider.value = ?)
          and exists (select 1 from json_each(binding.runtime_proto_json,
            '$.capabilities.dmPublicMessages.providers') provider where provider.value = ?))`)
    .bind(input.channelId, input.organizationId, input.preferredDeviceId ?? null, input.preferredDeviceId ?? null,
      `AGENT_PROVIDER_${input.provider.toUpperCase()}`, `AGENT_PROVIDER_${input.provider.toUpperCase()}`).first());
}
