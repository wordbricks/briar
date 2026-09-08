/** The existing live-roster view includes organization and Project Agent access. */
export const dmScheduleScopeCurrent = (schedule: string) => `exists (
  select 1 from briar_dm_memory_live_rosters live
  join briar_project_agents agent on agent.id = live.agent_id and agent.provider = 'codex'
  join briar_channel_messages source on source.id = ${schedule}.source_message_id
    and source.channel_id = live.channel_id and source.deleted_at is null
    and source.memory_source_version = ${schedule}.source_version
    and source.author_user_id = live.owner_user_id
  where live.channel_id = ${schedule}.channel_id and live.organization_id = ${schedule}.organization_id
    and live.owner_user_id = ${schedule}.owner_user_id and live.agent_id = ${schedule}.agent_id
    and live.roster_epoch = ${schedule}.roster_epoch
)`;

export const dmScheduleReplyFenceCurrent = (job: string) => `(${job}.dm_schedule_id is null or exists (
  select 1 from briar_dm_schedules schedule where schedule.id = ${job}.dm_schedule_id
    and schedule.organization_id = ${job}.organization_id and schedule.channel_id = ${job}.channel_id
    and schedule.agent_id = ${job}.agent_id and schedule.current_job_id = ${job}.id
    and ${dmScheduleScopeCurrent("schedule")}
))`;
