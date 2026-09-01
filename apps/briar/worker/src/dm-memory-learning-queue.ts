import { dmMemoryCanonicalJson } from "../../src/lib/dm-memory-canonical-json";
import type { DmLearningPolicy } from "../../src/lib/dm-memory-learning-contract";
import type { DmMemoryReference } from "../../src/lib/dm-memory-query-contract";
import { sha256 } from "./crypto-digest";
import { dmLearningLiveSpaceSql } from "./dm-memory-learning-input";

/** The caller appends these before clearing the completed reply's claim hash. */
export function dmLearningReplyOutboxStatements(db: D1Database, input: {
  jobId: string; claimTokenHash: string; completedAt: string; explicitRequested: boolean;
  requestTargets?: readonly DmMemoryReference[];
}) {
  const gate = `from briar_channel_agent_reply_jobs reply
    join briar_dm_memory_reply_fences fence on fence.job_id = reply.id and fence.claim_token_hash = reply.claim_token_hash
    join briar_dm_memory_spaces space on space.id = fence.space_id and space.revocation_epoch = fence.revocation_epoch
    where reply.id = ? and reply.claim_token_hash = ? and reply.status = 'completed' and reply.completed_at = ?
      and ${dmLearningLiveSpaceSql} and exists (select 1 from briar_channel_messages message where message.id = reply.reply_message_id)`;
  const bindings = [input.jobId, input.claimTokenHash, input.completedAt];
  const statements = [db.prepare(`insert into briar_dm_memory_learning_outbox
    (reply_job_id, space_id, kind, source_end, revocation_epoch, available_at, created_at)
    select reply.id, space.id, 'extract', coalesce((select max(sequence) from briar_dm_memory_source_events where space_id = space.id), 0),
      space.revocation_epoch, ?, ? ${gate} and space.use_enabled = 1 and space.auto_enabled = 1
    on conflict (reply_job_id, kind) do nothing`)
    .bind(new Date(Date.parse(input.completedAt) + 15_000).toISOString(), input.completedAt, ...bindings)];
  if (input.explicitRequested) statements.push(db.prepare(`insert into briar_dm_memory_learning_outbox
    (reply_job_id, space_id, kind, source_end, request_source_id, request_targets_json, revocation_epoch, available_at, created_at)
    select reply.id, space.id, 'explicit_request', 0, reply.trigger_message_id, ?, space.revocation_epoch, ?, ? ${gate}
      and exists (select 1 from briar_channel_messages source where source.id = reply.trigger_message_id
        and source.channel_id = space.channel_id and source.author_user_id = space.owner_user_id and source.deleted_at is null
        and not exists (select 1 from briar_dm_memory_exclusions excluded where excluded.space_id = space.id
          and excluded.source_type = 'message' and excluded.source_id = source.id))
    on conflict (reply_job_id, kind) do nothing`).bind(JSON.stringify(input.requestTargets ?? []), input.completedAt, input.completedAt, ...bindings));
  return statements;
}

async function enqueueLearningJob(db: D1Database, input: {
  spaceId: string; kind: "extract" | "explicit_request" | "consolidate"; start: number; end: number;
  requestSourceId?: string; requestTargetsJson?: string; dedupeSource: string; policy: DmLearningPolicy; now: string;
}) {
  const dedupe = await sha256(dmMemoryCanonicalJson([input.spaceId, input.kind, input.start, input.end, input.dedupeSource, input.policy]));
  const result = await db.prepare(`insert into briar_dm_memory_jobs
    (id, space_id, kind, dedupe_key, expected_memory_revision, revocation_epoch, source_start, source_end,
      request_source_id, request_targets_json, policy_json, available_at, created_at, updated_at)
    select ?, space.id, ?, ?, space.memory_revision, space.revocation_epoch, ?, ?, ?, ?, ?, ?, ?, ?
    from briar_dm_memory_spaces space where space.id = ? and ${dmLearningLiveSpaceSql}
      and (? = 'explicit_request' or (space.use_enabled = 1 and space.auto_enabled = 1))
      and not exists (select 1 from briar_dm_memory_jobs prior where prior.space_id = space.id
        and prior.kind in ('extract', 'explicit_request', 'consolidate')
        and (prior.status in ('pending', 'running', 'retry_wait')
          or (prior.status = 'failed' and (prior.kind = ? and
            ((? <> 'explicit_request' and prior.source_end > ?) or prior.request_source_id = ?)))))
    on conflict (dedupe_key) do nothing returning id`)
    .bind(crypto.randomUUID(), input.kind, dedupe, input.start, input.end, input.requestSourceId ?? null,
      input.requestTargetsJson ?? '[]', dmMemoryCanonicalJson(input.policy), input.now, input.now, input.now, input.spaceId,
      input.kind, input.kind, input.kind, input.start, input.requestSourceId ?? null).all<{ id: string }>();
  return result.results.length;
}

/** This can be retried after restart; no in-memory queue owns unprocessed input. */
export async function scheduleDmLearningJobs(db: D1Database, organizationId: string, policy: DmLearningPolicy, now: string) {
  const spaces = (await db.prepare(`select space.id, space.revocation_epoch from briar_dm_memory_spaces space
    left join briar_dm_memory_learning_state scheduled on scheduled.space_id = space.id
    where space.organization_id = ? and ${dmLearningLiveSpaceSql}
      and (exists (select 1 from briar_dm_memory_learning_outbox outbox where outbox.space_id = space.id and outbox.settled = 0)
        or (space.auto_enabled = 1 and space.use_enabled = 1 and exists (
          select 1 from briar_dm_memory_observation_events observation where observation.space_id = space.id
            and observation.sequence > coalesce((select observation_watermark from briar_dm_memory_learning_state where space_id = space.id), 0))))
    order by coalesce(scheduled.last_scheduled_at, space.created_at), space.id limit 20`).bind(organizationId).all<{ id: string; revocation_epoch: number }>()).results;
  let created = 0;
  for (const space of spaces) {
    await db.batch([
      db.prepare(`insert into briar_dm_memory_learning_state(space_id, updated_at, last_scheduled_at) values (?, ?, ?)
        on conflict (space_id) do update set last_scheduled_at = excluded.last_scheduled_at`).bind(space.id, now, now),
      db.prepare(`update briar_dm_memory_learning_outbox set settled = 1 where space_id = ?
        and kind = 'explicit_request' and revocation_epoch <> ?`).bind(space.id, space.revocation_epoch),
    ]);
    const state = (await db.prepare(`select source_watermark, observation_watermark from briar_dm_memory_learning_state where space_id = ?`)
      .bind(space.id).first<{ source_watermark: number; observation_watermark: number }>())!;
    const explicit = await db.prepare(`select reply_job_id, request_source_id, request_targets_json from briar_dm_memory_learning_outbox
      where space_id = ? and kind = 'explicit_request' and settled = 0 and available_at <= ?
        and revocation_epoch = ? and not exists (select 1 from briar_dm_memory_jobs prior
          where prior.space_id = briar_dm_memory_learning_outbox.space_id and prior.kind = 'explicit_request'
            and prior.request_source_id = briar_dm_memory_learning_outbox.request_source_id
            and prior.status in ('failed', 'cancelled', 'succeeded', 'no_change'))
      order by created_at, reply_job_id limit 1`)
      .bind(space.id, now, space.revocation_epoch).first<{ reply_job_id: string; request_source_id: string; request_targets_json: string }>();
    if (explicit) {
      created += await enqueueLearningJob(db, { spaceId: space.id, kind: "explicit_request", start: 0, end: 0,
        requestSourceId: explicit.request_source_id, requestTargetsJson: explicit.request_targets_json,
        dedupeSource: `${explicit.reply_job_id}:${space.revocation_epoch}`, policy, now });
    } else {
      // max(end) collects the current burst, but min(available_at) never moves the first event's deadline.
      const extraction = await db.prepare(`select max(source_end) as source_end, min(available_at) as available_at
        from briar_dm_memory_learning_outbox where space_id = ? and kind = 'extract' and settled = 0 and source_end > ?`)
        .bind(space.id, state.source_watermark).first<{ source_end: number | null; available_at: string | null }>();
      if (extraction?.source_end && extraction.available_at! <= now) {
        created += await enqueueLearningJob(db, { spaceId: space.id, kind: "extract", start: state.source_watermark,
          end: extraction.source_end, dedupeSource: String(space.revocation_epoch), policy, now });
      } else {
        const observations = await db.prepare(`select count(*) as count, max(sequence) as sequence, min(created_at) as oldest
          from briar_dm_memory_observation_events where space_id = ? and sequence > ?`)
          .bind(space.id, state.observation_watermark).first<{ count: number; sequence: number | null; oldest: string | null }>();
        if (observations?.sequence && (observations.count >= 10 ||
          Date.parse(now) - Date.parse(observations.oldest!) >= 24 * 60 * 60 * 1000)) {
          created += await enqueueLearningJob(db, { spaceId: space.id, kind: "consolidate", start: state.observation_watermark,
            end: observations.sequence, dedupeSource: String(space.revocation_epoch), policy, now });
        }
      }
    }
    if (created >= 8) break;
  }
  return created;
}
