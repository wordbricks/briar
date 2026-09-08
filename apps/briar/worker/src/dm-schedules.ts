import type { DmScheduleToolOperation } from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { getDmPublicMessageClaim } from "./dm-public-message-repository";
import { dmScheduleReplyFenceCurrent, dmScheduleScopeCurrent } from "./dm-schedule-fence";
import { dmMemoryReplyFenceCurrent } from "./dm-memory-reply-fence";
import { sha256 } from "./crypto-digest";
import { HttpError } from "./http-response";

type ScheduleRow = {
  id: string; organization_id: string; channel_id: string; owner_user_id: string;
  agent_id: string; source_message_id: string; source_version: number; roster_epoch: number;
  request_key: string; payload_hash: string; instruction: string; previous_job_id: string | null;
  next_run_at: string; interval_seconds: number | null; time_zone: string;
  enabled: number; revision: number; current_job_id: string | null;
  cancelled_at: string | null; created_at: string; updated_at: string;
  stop_requested_at?: string | null; stop_confirmed_at?: string | null;
};
const notice = "실행은 분 단위로 확인하며 Worker 연결 상태에 따라 늦어질 수 있습니다. 매일은 고정 24시간 간격입니다. 정상 실행마다 결과를 회신합니다.";
const summarize = (row: ScheduleRow) => ({
  id: row.id, instruction: row.instruction.slice(0, 200), nextRunAt: row.next_run_at,
  intervalSeconds: row.interval_seconds ?? undefined, timeZone: row.time_zone,
  enabled: row.enabled === 1, revision: row.revision, currentJobId: row.current_job_id ?? undefined,
  nextRunDisplay: new Intl.DateTimeFormat("ko-KR", { timeZone: row.time_zone,
    dateStyle: "full", timeStyle: "long" }).format(new Date(row.next_run_at)),
  stopState: row.stop_requested_at ? row.stop_confirmed_at ? "confirmed" : "requested" : undefined,
});

export function dmScheduleTime(input: Pick<DmScheduleToolOperation,
  "delaySeconds" | "runAt" | "intervalSeconds" | "timeZone" | "timeZoneConfirmed">,
  receivedAt: string, observedAt: string) {
  const relative = input.delaySeconds !== undefined;
  if (relative === (input.runAt !== undefined)) throw new HttpError(400, "Specify one relative delay or absolute time");
  const zone = input.timeZone.trim() || "UTC";
  try { new Intl.DateTimeFormat("en", { timeZone: zone }).format(); }
  catch { throw new HttpError(400, "Use a valid IANA time zone"); }
  if (input.intervalSeconds !== undefined && (!Number.isSafeInteger(input.intervalSeconds) ||
    input.intervalSeconds < 300 || input.intervalSeconds > 31_536_000 || input.intervalSeconds % 60 !== 0)) {
    throw new HttpError(400, "Repeat in whole minutes, at least five minutes and at most 365 days");
  }
  let instant: number;
  if (relative) {
    if (!Number.isSafeInteger(input.delaySeconds) || input.delaySeconds! < 1 || input.delaySeconds! > 31_536_000) {
      throw new HttpError(400, "Delay must be 1 second to 365 days");
    }
    // The stored incoming message time is the server receipt, independent of model/tool latency.
    instant = Date.parse(receivedAt) + input.delaySeconds! * 1000;
  } else {
    if (!input.timeZone.trim() || !input.timeZoneConfirmed) throw new HttpError(400, "Confirm the user's time zone before using an absolute time");
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/u.test(input.runAt!)) {
      throw new HttpError(400, "Absolute time must include its UTC offset");
    }
    instant = Date.parse(input.runAt!);
    if (instant <= Date.parse(observedAt)) throw new HttpError(400, "Absolute time must be in the future");
  }
  if (!Number.isFinite(instant)) throw new HttpError(400, "Invalid schedule time");
  return { nextRunAt: new Date(instant).toISOString(), timeZone: zone };
}

export async function executeDmScheduleTool(db: D1Database, input: {
  jobId: string; organizationId: string; channelId: string; workerId: string; deviceId: string;
  claimTokenHash: string; observedAt: string; operation: DmScheduleToolOperation;
}) {
  const scope = await getDmPublicMessageClaim(db, input);
  if (!scope || scope.channel_id !== input.channelId || scope.agent_provider !== "codex") {
    throw new HttpError(409, "The DM schedule claim is unavailable");
  }
  const operation = input.operation;
  if (!["create", "list", "cancel"].includes(operation.action)) throw new HttpError(400, "Invalid schedule operation");
  const claim = `exists (select 1 from briar_channel_agent_reply_jobs job
    join briar_execution_workers binding on binding.id = job.claimed_worker_id
    join briar_execution_worker_devices device on device.id = binding.device_id
    join briar_channels channel on channel.id = job.channel_id
    join briar_project_agents agent on agent.id = job.agent_id and agent.organization_id = job.organization_id
      and agent.project_id is job.project_id and agent.provider = job.agent_provider
    join briar_channel_messages trigger on trigger.id = job.trigger_message_id
    where (job.id = ? and job.organization_id = ? and job.channel_id = ?
      and job.claimed_worker_id = ? and job.claimed_device_id = ? and job.claim_token_hash = ?)
      and (job.status = 'running' and job.lease_expires_at > ? and job.routing_action = 'new'
        and job.skill_id is null and job.selected_skill_id_snapshot is null)
      and (job.agent_message_hop = 0 and job.delegated_by_reply_job_id is null)
      and (job.steer_revision = ? and job.applied_steer_revision = ?
      and trigger.deleted_at is null and trigger.memory_source_version = ?
      and channel.memory_roster_epoch = ? and channel.archived_at is null)
      and exists (select 1 from briar_dm_memory_live_rosters live
        where live.organization_id = job.organization_id and live.channel_id = job.channel_id
          and live.agent_id = job.agent_id and live.owner_user_id = ?)
      and (binding.state <> 'disabled' and device.state <> 'disabled'
      and json_extract(binding.runtime_proto_json, '$.capabilities.dmReplyRouting.protocol') = 1
      and exists (select 1 from json_each(binding.runtime_proto_json, '$.capabilities.dmReplyRouting.providers') where value = 'AGENT_PROVIDER_CODEX'))
      and (${dmScheduleReplyFenceCurrent("job")} and ${dmMemoryReplyFenceCurrent("job")}))`;
  const claimArgs = [input.jobId, input.organizationId, input.channelId, input.workerId, input.deviceId,
    input.claimTokenHash, input.observedAt, scope.input_revision, scope.input_revision,
    scope.trigger_source_version, scope.roster_epoch, scope.owner_user_id];
  const permission = `with permission as materialized (select 1 where ${claim})`;
  const permitted = "exists (select 1 from permission)";
  const owned = "schedule.organization_id = ? and schedule.channel_id = ? and schedule.owner_user_id = ? and schedule.agent_id = ?";
  const ownerArgs = [scope.organization_id, scope.channel_id, scope.owner_user_id, scope.agent_id];
  const read = async (id?: string, before?: ScheduleRow) => (await db.prepare(`${permission} select schedule.*, job.stop_requested_at, job.stop_confirmed_at
    from briar_dm_schedules schedule left join briar_channel_agent_reply_jobs job on job.id = schedule.current_job_id
    where ${owned} and ${permitted} ${id ? "and schedule.id = ?" : ""}
      ${before ? "and (schedule.created_at, schedule.id) < (?, ?)" : ""}
    order by schedule.created_at desc, schedule.id desc limit 51`).bind(...claimArgs, ...ownerArgs, ...(id ? [id] : []), ...(before ? [before.created_at, before.id] : [])).all<ScheduleRow>()).results;
  if (!await db.prepare(`select 1 where ${claim}`).bind(...claimArgs).first()) throw new HttpError(409, "DM schedule tools require an active supported execution");
  let before: ScheduleRow | undefined;
  if (operation.action === "list" && operation.scheduleId) {
    before = (await read(operation.scheduleId))[0];
    if (!before) throw new HttpError(404, "Schedule cursor is outside this DM");
  }
  let replayed = false;
  let selectedId: string | undefined;
  if (operation.action === "create") {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(operation.requestKey) || !operation.instruction.trim() || operation.instruction.trim().length > 8000) {
      throw new HttpError(400, "A stable request key and clear instruction are required");
    }
    const source = await db.prepare(`select message.created_at, job.dm_schedule_id from briar_channel_messages message
      join briar_channel_agent_reply_jobs job on job.trigger_message_id = message.id
      where job.id = ? and message.author_user_id = ? and message.deleted_at is null`)
      .bind(input.jobId, scope.owner_user_id).first<{ created_at: string; dm_schedule_id: string | null }>();
    if (!source || source.dm_schedule_id) throw new HttpError(409, "Create a schedule from a user's direct request");
    const payloadHash = await sha256(JSON.stringify({ instruction: operation.instruction.trim(), delay: operation.delaySeconds,
      runAt: operation.runAt, interval: operation.intervalSeconds, zone: operation.timeZone,
      confirmed: operation.timeZoneConfirmed, previous: operation.previousJobId }));
    const existing = await db.prepare(`select schedule.* from briar_dm_schedules schedule where ${owned}
      and source_message_id = ? and request_key = ?`).bind(...ownerArgs, scope.trigger_message_id, operation.requestKey).first<ScheduleRow>();
    if (existing && existing.payload_hash !== payloadHash) throw new HttpError(409, "Schedule request key was used with different content");
    if (existing) { selectedId = existing.id; replayed = true; }
    else {
      const time = dmScheduleTime(operation, source.created_at, input.observedAt);
      if (operation.previousJobId && !await db.prepare(`select job.id from briar_channel_agent_reply_jobs job
        join briar_channel_messages message on message.id = job.trigger_message_id
        where job.id = ? and job.organization_id = ? and job.channel_id = ? and job.agent_id = ?
          and message.deleted_at is null and (message.author_user_id = ? or job.dm_schedule_id in (
            select id from briar_dm_schedules where owner_user_id = ? and channel_id = ?))`)
        .bind(operation.previousJobId, scope.organization_id, scope.channel_id, scope.agent_id,
          scope.owner_user_id, scope.owner_user_id, scope.channel_id).first()) throw new HttpError(400, "Previous work is outside this DM");
      selectedId = crypto.randomUUID();
      await db.prepare(`${permission} insert into briar_dm_schedules (id, organization_id, channel_id, owner_user_id,
        agent_id, source_message_id, source_version, roster_epoch, request_key, payload_hash,
        instruction, previous_job_id, next_run_at, interval_seconds, time_zone, created_at, updated_at)
        select ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? where ${permitted}
          and exists (select 1 from briar_channel_members member
            join briar_organization_members om on om.user_id = member.user_id and om.organization_id = ?
            where member.channel_id = ? and member.user_id = ?)
        on conflict (channel_id, owner_user_id, agent_id, source_message_id, request_key) do nothing`)
        .bind(...claimArgs, selectedId, ...ownerArgs, scope.trigger_message_id, scope.trigger_source_version, scope.roster_epoch,
          operation.requestKey, payloadHash, operation.instruction.trim(), operation.previousJobId ?? null,
          time.nextRunAt, operation.intervalSeconds ?? null, time.timeZone, input.observedAt, input.observedAt,
          scope.organization_id, scope.channel_id, scope.owner_user_id).run();
      const saved = await db.prepare(`select id, payload_hash from briar_dm_schedules schedule where ${owned}
        and source_message_id = ? and request_key = ?`).bind(...ownerArgs, scope.trigger_message_id, operation.requestKey).first<{id: string; payload_hash: string}>();
      if (!saved || saved.payload_hash !== payloadHash) throw new HttpError(409, "Schedule save conflicted or claim changed");
      replayed = saved.id !== selectedId; selectedId = saved.id;
    }
  } else if (operation.action === "cancel") {
    selectedId = operation.scheduleId;
    if (!selectedId) throw new HttpError(400, "Select a schedule ID from this DM");
    const current = (await read(selectedId))[0];
    if (!current) throw new HttpError(404, "Schedule not found in this DM");
    replayed = current.cancelled_at !== null;
    if (replayed) return { schedules: [summarize(current)], replayed, notice, truncated: false };
    // Both statements execute in the same transaction. A tick committed first is stopped;
    // a cancellation committed first invalidates that tick's revision comparison.
    await db.batch([
      db.prepare(`${permission} update briar_dm_schedules as schedule set enabled = 0, cancelled_at = ?, revision = revision + 1, updated_at = ?
        where ${owned} and schedule.id = ? and cancelled_at is null and ${permitted}`)
        .bind(...claimArgs, input.observedAt, input.observedAt, ...ownerArgs, selectedId),
      db.prepare(`update briar_channel_agent_reply_jobs set stop_requested_at = ?,
        stop_confirmed_at = case when status = 'queued' then ? else null end,
        status = 'completed', completed_at = ?, updated_at = ?, error = ?
        where id in (select schedule.current_job_id from briar_dm_schedules schedule
          where ${owned} and schedule.id = ? and cancelled_at = ?)
          and status in ('queued', 'running') and stop_requested_at is null`)
        .bind(input.observedAt, input.observedAt, input.observedAt, input.observedAt,
          `dm_reply_stopped:schedule:${selectedId}`, ...ownerArgs, selectedId, input.observedAt),
    ]);
  }
  const rows = await read(selectedId, before);
  if (selectedId && !rows.length) throw new HttpError(409, "Schedule operation claim changed");
  return { schedules: rows.slice(0, 50).map(summarize), replayed, notice, truncated: rows.length > 50 };
}

/** One due-index page per minute, never historical backfill or a model call. */
export async function runDueDmSchedules(db: D1Database, observedAt: string) {
  const due = await db.prepare(`select * from briar_dm_schedules where enabled = 1 and next_run_at <= ?
    order by next_run_at limit 20`).bind(observedAt).all<ScheduleRow>();
  let enqueued = 0;
  for (const schedule of due.results) {
    const occurrence = schedule.next_run_at;
    const prefix = `dm-schedule:${schedule.id}:${Date.parse(occurrence)}`;
    const occurrenceId = async (kind: string) => {
      const hex = await sha256(`${prefix}:${kind}`);
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    };
    const [jobId, triggerId, sessionId, replyId] = await Promise.all(
      ["job", "trigger", "session", "reply"].map(occurrenceId));
    const interval = schedule.interval_seconds ? schedule.interval_seconds * 1000 : null;
    const next = interval ? new Date(Date.parse(occurrence) +
      (Math.floor((Date.parse(observedAt) - Date.parse(occurrence)) / interval) + 1) * interval).toISOString() : occurrence;
    const current = `schedule.id = ? and schedule.revision = ? and schedule.next_run_at = ? and schedule.enabled = 1`;
    const args = [schedule.id, schedule.revision, occurrence];
    const available = `${current} and ${dmScheduleScopeCurrent("schedule")} and not exists (
      select 1 from briar_channel_agent_reply_jobs active where active.id = schedule.current_job_id
        and (active.status in ('queued', 'running') or (active.stop_requested_at is not null and active.stop_confirmed_at is null)))`;
    // Reference the last occurrence's immutable result and artifacts, without reviving its process.
    const previousId = schedule.current_job_id ?? schedule.previous_job_id;
    const body = `예약한 작업을 실행합니다: ${schedule.instruction}\n예정: ${new Intl.DateTimeFormat("ko-KR", {
      timeZone: schedule.time_zone, dateStyle: "medium", timeStyle: "short",
    }).format(new Date(occurrence))} (${schedule.time_zone})`;
    const results = await db.batch([
      db.prepare(`insert into briar_channel_messages (id, channel_id, author_agent_name, body, created_at, updated_at)
        select ?, schedule.channel_id, 'Briar', ?, ?, ? from briar_dm_schedules schedule where ${available}
        on conflict (id) do nothing`).bind(triggerId, body, observedAt, observedAt, ...args),
      db.prepare(`insert into briar_channel_reply_sessions (id, organization_id, channel_id, thread_root_message_id,
        project_id, agent_id, provider, model, effort, last_activity_at, retained_until, created_at, updated_at)
        select ?, schedule.organization_id, schedule.channel_id, ?, agent.project_id, agent.id,
          agent.provider, agent.model, agent.effort, ?, ?, ?, ? from briar_dm_schedules schedule
        join briar_project_agents agent on agent.id = schedule.agent_id
        where ${available} and exists (select 1 from briar_channel_messages where id = ?)
        on conflict (id) do nothing`).bind(sessionId, triggerId, observedAt,
          new Date(Date.parse(observedAt) + 30 * 86400_000).toISOString(), observedAt, observedAt, ...args, triggerId),
      db.prepare(`insert into briar_channel_agent_reply_jobs (id, organization_id, channel_id, project_id, agent_id,
        session_id, trigger_message_id, parent_message_id, reply_message_id, agent_provider,
        status, routing_action, dm_schedule_id, created_at, updated_at)
        select ?, schedule.organization_id, schedule.channel_id, agent.project_id, schedule.agent_id,
          ?, ?, ?, ?, agent.provider, 'queued', 'new', schedule.id, ?, ? from briar_dm_schedules schedule
        join briar_project_agents agent on agent.id = schedule.agent_id
        where ${available} and exists (select 1 from briar_channel_reply_sessions where id = ?)
        on conflict (channel_id, trigger_message_id, agent_id) do nothing returning id`)
        .bind(jobId, sessionId, triggerId, triggerId, replyId, observedAt, observedAt, ...args, sessionId),
      db.prepare(`update briar_dm_schedules as schedule set current_job_id = ?, previous_job_id = ?, next_run_at = ?, enabled = ?,
        revision = revision + 1, updated_at = ? where ${current}
        and exists (select 1 from briar_channel_agent_reply_jobs where id = ?)`)
        .bind(jobId, previousId, next, interval ? 1 : 0, observedAt, ...args, jobId),
      // Unavailable authority is terminal; an overlapping/offline occurrence remains the sole job.
      db.prepare(`update briar_dm_schedules as schedule set enabled = 0, revision = revision + 1, updated_at = ?
        where ${current} and not (${dmScheduleScopeCurrent("schedule")})`)
        .bind(observedAt, ...args),
      db.prepare(`update briar_dm_schedules as schedule set next_run_at = ?, revision = revision + 1, updated_at = ?
        where ${current} and interval_seconds is not null and exists (
          select 1 from briar_channel_agent_reply_jobs active where active.id = schedule.current_job_id
            and (active.status in ('queued', 'running') or (active.stop_requested_at is not null and active.stop_confirmed_at is null)))`)
        .bind(next, observedAt, ...args),
    ]);
    enqueued += results[2]?.results.length ?? 0;
  }
  return { scanned: due.results.length, enqueued };
}

/** Saved context is resolved at claim time, never copied into the visible trigger. */
export async function getDmScheduleContext(db: D1Database, jobId: string) {
  const schedule = await db.prepare(`select schedule.* from briar_dm_schedules schedule
    join briar_channel_agent_reply_jobs job on job.dm_schedule_id = schedule.id
      and schedule.current_job_id = job.id and job.channel_id = schedule.channel_id
      and job.organization_id = schedule.organization_id and job.agent_id = schedule.agent_id
    where job.id = ? and ${dmScheduleScopeCurrent("schedule")}`).bind(jobId).first<ScheduleRow>();
  if (!schedule) return null;
  const previous = schedule.previous_job_id ? await db.prepare(`select job.id, message.id as message_id,
    substr(message.body, 1, 8000) as body from briar_channel_agent_reply_jobs job
    join briar_channel_messages message on message.id = job.reply_message_id
      and message.channel_id = job.channel_id and message.deleted_at is null
    where job.id = ? and job.organization_id = ? and job.channel_id = ? and job.agent_id = ?
      and not exists (select 1 from briar_dm_memory_exclusions excluded
        join briar_dm_memory_spaces space on space.id = excluded.space_id
        where space.channel_id = job.channel_id and excluded.source_type = 'message' and excluded.source_id = message.id)`)
    .bind(schedule.previous_job_id, schedule.organization_id, schedule.channel_id, schedule.agent_id)
    .first<{ id: string; message_id: string; body: string }>() : null;
  const artifacts = previous ? (await db.prepare(`select id, filename, content_type as contentType, byte_size as byteSize
    from briar_channel_message_attachments where channel_id = ? and message_id = ? order by created_at, id limit 10`)
    .bind(schedule.channel_id, previous.message_id).all<{ id: string; filename: string; contentType: string; byteSize: number }>()).results : [];
  return { scheduleId: schedule.id, instruction: schedule.instruction, sourceMessageId: schedule.source_message_id,
    previousResult: previous, artifacts,
    executionInstruction: "Start a new execution from the saved instruction and relevant prior result/artifact references. These references are context, not permission to repeat completed external actions. Do not resume a previous process. Report this occurrence's result to the original DM." };
}
