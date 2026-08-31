import * as Schema from "effect/Schema";
import { channelMemoryCitationSchema } from "../../src/lib/channels-contract";
import {
  DmLearningSnapshot, type DmLearningDocument, type DmLearningPolicy,
  type DmLearningRoot, type DmLearningSourceRef,
} from "../../src/lib/dm-memory-learning-contract";
import { sha256 } from "./crypto-digest";
import { dmMemoryReadableDocument } from "./dm-memory-access";
import { DmLearningError } from "./dm-memory-learning-validation";

export type DmLearningJobRow = {
  id: string; space_id: string; kind: "extract" | "consolidate" | "explicit_request";
  status: string; stage: string | null; attempt: number; lease_token_hash: string | null;
  lease_expires_at: string | null; expected_memory_revision: number; revocation_epoch: number;
  input_json: string | null; input_hash: string | null; policy_json: string | null;
  calls_used: number; source_start: number; source_end: number; request_source_id: string | null;
  request_targets_json: string;
  claimed_worker_id: string | null; claimed_device_id: string | null;
  result_json: string | null; error_code: string | null;
};
export type DmLearningSpaceRow = {
  id: string; organization_id: string; channel_id: string; owner_user_id: string; agent_id: string;
  memory_revision: number; revocation_epoch: number; use_enabled: number; auto_enabled: number;
};
const refKey = (ref: DmLearningSourceRef) => `${ref.type}:${ref.id}:${ref.version}`;
const sourceKey = (ref: DmLearningSourceRef) => `${ref.type}:${ref.id}`;
const iso = (value: string) => new Date(value).toISOString();

/** Both source bodies and their hashes are derived from authoritative rows, never model output. */
export async function readDmLearningRoot(
  db: D1Database, space: DmLearningSpaceRow, ref: DmLearningSourceRef,
): Promise<DmLearningRoot> {
  if (ref.type === "message") {
    const row = await db.prepare(`select body, memory_source_version, author_user_id, author_agent_id, created_at
      from briar_channel_messages where id = ? and channel_id = ? and deleted_at is null`)
      .bind(ref.id, space.channel_id).first<{ body: string; memory_source_version: number;
        author_user_id: string | null; author_agent_id: string | null; created_at: string }>();
    if (!row || row.memory_source_version !== ref.version ||
      (row.author_user_id !== space.owner_user_id && row.author_agent_id !== space.agent_id)) {
      throw new DmLearningError("stale");
    }
    return { type: "message", id: ref.id, version: ref.version, hash: await sha256(row.body), body: row.body,
      speaker: row.author_user_id === space.owner_user_id ? "user" : "agent", observedAt: iso(row.created_at) };
  }
  if (ref.type !== "user_edit_event" || ref.version !== 1) throw new DmLearningError("stale");
  const row = await db.prepare(`select rev.body, rev.body_hash, rev.created_at
    from briar_dm_memory_sources source join briar_dm_memory_revisions rev
      on rev.document_id = source.document_id and rev.version = source.document_version
    where source.space_id = ? and source.source_type = 'user_edit_event' and source.source_id = ?
      and source.source_version = 1 and rev.origin = 'user_edit' and rev.body_hash = source.source_hash limit 1`)
    .bind(space.id, ref.id).first<{ body: string; body_hash: string; created_at: string }>();
  if (!row || await sha256(row.body) !== row.body_hash) throw new DmLearningError("stale");
  return { type: "user_edit_event", id: ref.id, version: 1, hash: row.body_hash, body: row.body,
    speaker: "user", observedAt: iso(row.created_at) };
}

export async function captureDmLearningInput(
  db: D1Database, job: DmLearningJobRow, space: DmLearningSpaceRow, policy: DmLearningPolicy, now: string,
): Promise<DmLearningSnapshot> {
  const exclusions = (await db.prepare(`select distinct source_type, source_id from briar_dm_memory_exclusions
    where space_id = ? order by source_type, source_id limit 1025`).bind(space.id)
    .all<{ source_type: "message" | "user_edit_event"; source_id: string }>()).results;
  if (exclusions.length > 1024) throw new DmLearningError("input_capacity");
  const excludedSources = exclusions.map((row) => ({ type: row.source_type, id: row.source_id, version: 1 }));
  const excludedKeys = new Set(excludedSources.map(sourceKey));
  const roots = new Map<string, DmLearningRoot>();
  const addRoot = async (ref: DmLearningSourceRef, expectedHash?: string) => {
    if (excludedKeys.has(sourceKey(ref))) throw new DmLearningError("stale");
    const root = roots.get(refKey(ref)) ?? await readDmLearningRoot(db, space, ref);
    if (expectedHash && root.hash !== expectedHash) throw new DmLearningError("stale");
    roots.set(refKey(ref), root);
    return root;
  };
  const rows = (await db.prepare(`select doc.id, doc.current_version, doc.kind, doc.title, doc.conflicted,
      rev.body, rev.body_hash, rev.memory_class, rev.evidence_type, rev.protected_by_user,
      rev.source_language, rev.observed_at, rev.valid_until
    from briar_dm_memory_documents doc join briar_dm_memory_revisions rev
      on rev.document_id = doc.id and rev.version = doc.current_version
    where doc.space_id = ? and ${dmMemoryReadableDocument}
      and (? <> 'explicit_request' or exists (select 1 from json_each(?) target
        where json_extract(target.value, '$.documentId') = doc.id
          and json_extract(target.value, '$.version') = doc.current_version))
    order by doc.id limit 129`)
    .bind(space.id, now, job.kind, job.request_targets_json).all<{ id: string; current_version: number; kind: "observation" | "topic";
      title: string; conflicted: number; body: string; body_hash: string;
      memory_class: "profile" | "log" | "note"; evidence_type: "explicit_user" | "observed";
      protected_by_user: number; source_language: string; observed_at: string | null; valid_until: string | null }>()).results;
  if (rows.length > 128) throw new DmLearningError("input_capacity");
  if (job.kind === "explicit_request") {
    const targets = Schema.decodeUnknownSync(Schema.Array(channelMemoryCitationSchema).check(Schema.isMaxLength(10)))(
      JSON.parse(job.request_targets_json));
    if (targets.some((target) => !rows.some((row) => row.id === target.documentId && row.current_version === target.version))) {
      throw new DmLearningError("stale");
    }
  }
  const documents: DmLearningDocument[] = [];
  const observationWindow = job.kind === "consolidate" ? (await db.prepare(`select sequence, document_id, document_version
    from briar_dm_memory_observation_events where space_id = ? and sequence > ? and sequence <= ?
    order by sequence limit 32`).bind(space.id, job.source_start, job.source_end)
    .all<{ sequence: number; document_id: string; document_version: number }>()).results : [];
  const observationEnd = observationWindow.at(-1)?.sequence ?? job.source_end;
  const laterObservations = job.kind === "consolidate" ? new Set((await db.prepare(`select document_id
    from briar_dm_memory_observation_events where space_id = ? and sequence > ?`)
    .bind(space.id, observationEnd).all<{ document_id: string }>()).results.map((row) => row.document_id)) : new Set<string>();
  for (const row of rows) {
    if (laterObservations.has(row.id)) continue;
    const sources = (await db.prepare(`select distinct source_type, source_id, source_version, source_hash
      from briar_dm_memory_sources where document_id = ? and document_version = ?
      order by source_type, source_id`).bind(row.id, row.current_version)
      .all<{ source_type: "message" | "user_edit_event"; source_id: string; source_version: number; source_hash: string }>()).results;
    const refs: DmLearningSourceRef[] = [];
    for (const source of sources) {
      const ref = { type: source.source_type, id: source.source_id, version: source.source_version };
      await addRoot(ref, source.source_hash); refs.push(ref);
    }
    documents.push({ id: row.id, version: row.current_version, kind: row.kind, title: row.title,
      body: row.body, hash: row.body_hash, conflicted: Boolean(row.conflicted), memoryClass: row.memory_class,
      evidenceType: row.evidence_type, protectedByUser: Boolean(row.protected_by_user), sourceLanguage: row.source_language,
      observedAt: row.observed_at ? iso(row.observed_at) : null, validUntil: row.valid_until ? iso(row.valid_until) : null,
      sources: refs });
  }
  const snapshot = { memorySpaceId: space.id, memoryRevision: space.memory_revision,
    revocationEpoch: space.revocation_epoch, kind: job.kind, policy,
    clock: { id: crypto.randomUUID(), version: 1 as const, at: now, timeZone: "UTC" as const },
    sourceStart: job.source_start, sourceEnd: job.source_start, requestSource: null as DmLearningSourceRef | null,
    inputSources: [] as DmLearningSourceRef[], roots: [] as DmLearningRoot[], documents, excludedSources };
  const fits = () => {
    snapshot.roots = [...roots.values()].sort((a, b) => refKey(a).localeCompare(refKey(b)));
    return snapshot.roots.length <= 128 && new TextEncoder().encode(JSON.stringify(snapshot)).length <= policy.maxInputBytes;
  };
  if (!fits()) throw new DmLearningError("input_capacity");
  if (job.kind === "explicit_request") {
    const source = await db.prepare(`select memory_source_version from briar_channel_messages
      where id = ? and channel_id = ? and author_user_id = ? and deleted_at is null`)
      .bind(job.request_source_id, space.channel_id, space.owner_user_id).first<{ memory_source_version: number }>();
    if (!source || !job.request_source_id) throw new DmLearningError("stale");
    snapshot.requestSource = { type: "message", id: job.request_source_id, version: source.memory_source_version };
    snapshot.inputSources = [snapshot.requestSource];
    await addRoot(snapshot.requestSource);
    if (!fits()) throw new DmLearningError("input_capacity");
  } else if (job.kind === "extract") {
    const messages = (await db.prepare(`select event.sequence, message.id, message.memory_source_version
      from briar_dm_memory_source_events event left join briar_channel_messages message on message.id = event.message_id
        and message.deleted_at is null
      where event.space_id = ? and event.sequence > ? and event.sequence <= ?
      order by event.sequence limit 32`).bind(space.id, job.source_start, job.source_end)
      .all<{ sequence: number; id: string | null; memory_source_version: number | null }>()).results;
    for (const message of messages) {
      const previous = new Map(roots);
      const previousSources = snapshot.inputSources;
      if (message.id && message.memory_source_version && !excludedKeys.has(`message:${message.id}`)) {
        await addRoot({ type: "message", id: message.id, version: message.memory_source_version });
        snapshot.inputSources = [...snapshot.inputSources, { type: "message", id: message.id, version: message.memory_source_version }];
      }
      if (!fits()) {
        roots.clear(); for (const [id, root] of previous) roots.set(id, root);
        snapshot.inputSources = previousSources;
        fits();
        if (snapshot.sourceEnd === snapshot.sourceStart) throw new DmLearningError("input_capacity");
        break;
      }
      snapshot.sourceEnd = message.sequence;
    }
    if (messages.length === 0) snapshot.sourceEnd = job.source_end;
  } else {
    snapshot.sourceEnd = observationEnd;
    snapshot.inputSources = observationWindow.flatMap((item) => {
      const doc = documents.find((document) => document.id === item.document_id && document.version === item.document_version);
      return doc ? [{ type: "memory" as const, id: doc.id, version: doc.version }] : [];
    });
  }
  if (!fits()) throw new DmLearningError("input_capacity");
  return Schema.decodeSync(DmLearningSnapshot)(snapshot);
}

export const dmLearningLiveSpaceSql = `space.status = 'active' and exists (
  select 1 from briar_dm_memory_live_rosters live where live.organization_id = space.organization_id
    and live.channel_id = space.channel_id and live.owner_user_id = space.owner_user_id
    and live.agent_id = space.agent_id and live.roster_epoch = space.roster_epoch)`;

/** Included in every lease/phase/write guard, not just the initial snapshot read. */
export const dmLearningInputsCurrentSql = `not exists (
  select 1 from briar_dm_memory_learning_inputs source where source.job_id = job.id and (
    source.source_hash is null or exists (select 1 from briar_dm_memory_exclusions excluded
      where excluded.space_id = job.space_id and excluded.source_type = source.source_type and excluded.source_id = source.source_id)
    or (source.source_type = 'message' and not exists (select 1 from briar_channel_messages message
      where message.id = source.source_id and message.channel_id = space.channel_id
        and message.memory_source_version = source.source_version and message.deleted_at is null
        and (message.author_user_id = space.owner_user_id or message.author_agent_id = space.agent_id)))
    or (source.source_type = 'user_edit_event' and not exists (
      select 1 from briar_dm_memory_sources original join briar_dm_memory_revisions revision
        on revision.document_id = original.document_id and revision.version = original.document_version
      where original.space_id = space.id and original.source_type = 'user_edit_event'
        and original.source_id = source.source_id and original.source_version = source.source_version
        and revision.origin = 'user_edit' and revision.body_hash = source.source_hash))))`;
