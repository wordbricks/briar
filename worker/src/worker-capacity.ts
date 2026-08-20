/**
 * One SQL expression shared by every slot-consuming claim.
 *
 * Callers must declare `with claim_clock(observed_at) as (values (?))` so the
 * whole update uses one caller-authenticated instant. Keeping the count inside
 * the claiming UPDATE makes SQLite serialize the capacity decision with the
 * lease write; a count-then-claim pair would allow two concurrent claimers to
 * consume the last slot.
 */
export function liveDeviceSessionCountSql(deviceIdSql: string) {
  const liveAt = "(select observed_at from claim_clock)";
  return `(select count(*) from (
    select run.id
    from briar_hunt_runs run
    join briar_execution_workers holder on holder.id = run.worker_id
    where holder.device_id = ${deviceIdSql}
      and run.claim_token_hash is not null
      and run.lease_expires_at is not null
      and run.lease_expires_at > ${liveAt}
      and run.status not in ('backlog', 'completed', 'cancelled', 'blocked', 'failed')
    union all
    select task.id
    from briar_project_agent_task_jobs task
    join briar_execution_workers holder on holder.id = task.claimed_worker_id
    where holder.device_id = ${deviceIdSql}
      and task.status = 'running' and task.lease_expires_at > ${liveAt}
    union all
    select reply.id
    from briar_issue_agent_reply_jobs reply
    join briar_execution_workers holder on holder.id = reply.claimed_worker_id
    where holder.device_id = ${deviceIdSql}
      and reply.status = 'running' and reply.lease_expires_at > ${liveAt}
    union all
    select reply.id
    from briar_channel_agent_reply_jobs reply
    join briar_execution_workers holder on holder.id = reply.claimed_worker_id
    where holder.device_id = ${deviceIdSql}
      and reply.status = 'running' and reply.lease_expires_at > ${liveAt}
    union all
    select validation.id
    from merge_group_validation_jobs validation
    join briar_execution_workers holder on holder.id = validation.claimed_worker_id
    where holder.device_id = ${deviceIdSql}
      and validation.claim_token_hash is not null
      and validation.lease_expires_at > ${liveAt}
      and validation.state in ('running', 'validated', 'failed')
      and validation.published_at is null
  ) live_device_work)`;
}

export function workerDeviceCapacityGuardSql(workerIdSql: string) {
  return `exists (
    select 1
    from briar_execution_workers capacity_worker
    join briar_execution_worker_devices capacity_device
      on capacity_device.id = capacity_worker.device_id
    where capacity_worker.id = ${workerIdSql}
      and ${liveDeviceSessionCountSql("capacity_device.id")}
        < capacity_device.max_concurrent_sessions
  )`;
}
