import type { AgentProvider } from "../../src/lib/agent-provider";
import {
  MAX_TRANSCRIPT_EVENTS_PER_REQUEST,
  MAX_TRANSCRIPT_PAYLOAD_BYTES,
  MAX_TRANSCRIPT_REQUEST_BYTES,
} from "./transcript-limits";
import {
  TranscriptLimitError,
  WorkerConflictError,
  type TranscriptDirection,
  type TranscriptEventInput,
  type TranscriptSessionRow,
} from "./workers";

export type AgentWorkLogEntryStatus =
  | "writing"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export type AgentWorkLogEntryRow = {
  session_id: string;
  entry_id: string;
  sequence: number;
  updated_sequence: number;
  entry_type: "message" | "activity";
  activity_kind: "command" | "fileChange" | "webSearch" | "tool" | null;
  phase: string | null;
  title: string | null;
  body: string;
  status: AgentWorkLogEntryStatus;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type AgentTranscriptSegmentRow = {
  session_id: string;
  first_sequence: number;
  last_sequence: number;
  object_key: string;
  event_count: number;
  uncompressed_bytes: number;
  compressed_bytes: number;
  sha256: string;
  recorded_at: string;
};

type NormalizedEvent = Record<string, unknown> & { type: string };

const encoder = new TextEncoder();

const utf8Bytes = (value: string) => encoder.encode(value);
const arrayBuffer = (value: Uint8Array) => value.slice().buffer as ArrayBuffer;
const bytesToHex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((value) =>
    value.toString(16).padStart(2, "0")
  ).join("");

const sha256 = async (value: Uint8Array) =>
  bytesToHex(await crypto.subtle.digest("SHA-256", arrayBuffer(value)));

const gzip = async (value: Uint8Array) => {
  const stream = new Blob([arrayBuffer(value)]).stream().pipeThrough(
    new CompressionStream("gzip"),
  );
  return new Response(stream).arrayBuffer();
};

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const normalizedEvent = (payload: unknown): NormalizedEvent | null => {
  const envelope = record(payload);
  if (!envelope) return null;
  const candidate = envelope.type === "event"
    ? record(envelope.event)
    : envelope;
  return candidate && typeof candidate.type === "string"
    ? (candidate as NormalizedEvent)
    : null;
};

const string = (value: unknown) => typeof value === "string" ? value : null;

/**
 * Older Workers may still send one provider envelope per streaming delta.
 * Project those into the recoverable D1 work log without creating R2 objects.
 * New Workers annotate coalesced deltas, which remain useful for replaying an
 * interrupted turn and are retained with every meaningful boundary/snapshot.
 */
export const retainedRawTranscriptEvents = (events: TranscriptEventInput[]) =>
  events.filter((item) => {
    const envelope = record(item.payload);
    const event = normalizedEvent(item.payload);
    if (event?.type === "messageDelta" || event?.type === "activityDelta") {
      return record(envelope?.archiveCompaction)?.kind === "delta";
    }
    const raw = record(envelope?.raw);
    const update = record(raw?.update);
    const sessionUpdate = string(update?.sessionUpdate);
    if (sessionUpdate?.endsWith("_chunk")) return false;
    const streamEvent = record(raw?.event);
    if (
      raw?.type === "stream_event" &&
      streamEvent?.type === "content_block_delta"
    ) {
      return false;
    }
    if (raw?.type === "message.part.delta") return false;
    const method = string(raw?.method) ?? "";
    return !/(?:delta|progress)$/iu.test(method);
  });

const boundedWorkLogText = (value: string) => {
  const bytes = utf8Bytes(value);
  return bytes.byteLength <= MAX_TRANSCRIPT_PAYLOAD_BYTES
    ? value
    : new TextDecoder().decode(
        bytes.slice(0, MAX_TRANSCRIPT_PAYLOAD_BYTES),
        { stream: true },
      );
};

const activityKind = (
  value: unknown,
): AgentWorkLogEntryRow["activity_kind"] =>
  value === "command" || value === "fileChange" || value === "webSearch" ||
    value === "tool"
    ? value
    : "tool";

const completedActivityStatus = (value: unknown): AgentWorkLogEntryStatus =>
  value === "failed"
    ? "failed"
    : value === "cancelled"
      ? "cancelled"
      : "completed";

const validateEvents = (events: TranscriptEventInput[]) => {
  if (events.length < 1) {
    throw new TranscriptLimitError("Transcript request carried no events");
  }
  if (events.length > MAX_TRANSCRIPT_EVENTS_PER_REQUEST) {
    throw new TranscriptLimitError(
      `Transcript request may carry at most ${MAX_TRANSCRIPT_EVENTS_PER_REQUEST} events`,
    );
  }
  let requestBytes = 0;
  let previousSequence = 0;
  for (const event of events) {
    if (!Number.isInteger(event.sequence) || event.sequence < 1) {
      throw new TranscriptLimitError("Transcript sequence numbers start at 1");
    }
    if (event.sequence <= previousSequence) {
      throw new TranscriptLimitError(
        "Transcript events must have strictly increasing sequence numbers",
      );
    }
    previousSequence = event.sequence;
    const bytes = utf8Bytes(JSON.stringify(event.payload ?? null)).byteLength;
    if (bytes > MAX_TRANSCRIPT_PAYLOAD_BYTES) {
      throw new TranscriptLimitError(
        `Transcript event ${event.sequence} exceeds ${MAX_TRANSCRIPT_PAYLOAD_BYTES} bytes`,
      );
    }
    requestBytes += bytes;
  }
  if (requestBytes > MAX_TRANSCRIPT_REQUEST_BYTES) {
    throw new TranscriptLimitError(
      `Transcript request may carry at most ${MAX_TRANSCRIPT_REQUEST_BYTES} bytes`,
    );
  }
};

async function ensureTranscriptSession(
  db: D1Database,
  projectId: string,
  input: {
    sessionId: string;
    runId: string | null;
    workerId: string | null;
    agentProvider: AgentProvider;
    observedAt: string;
  },
) {
  if (input.sessionId !== input.sessionId.trim() ||
    input.sessionId.length < 1 || input.sessionId.length > 128) {
    throw new TranscriptLimitError(
      "Transcript session id must be 1-128 characters",
    );
  }
  const existing = await db
    .prepare(
      `select * from briar_agent_transcript_sessions where session_id = ?`,
    )
    .bind(input.sessionId)
    .first<TranscriptSessionRow>();
  if (existing && existing.project_id !== projectId) {
    throw new WorkerConflictError(
      "Transcript session belongs to another project",
    );
  }
  if (existing?.run_id && input.runId && existing.run_id !== input.runId) {
    throw new WorkerConflictError("Transcript session belongs to another run");
  }
  const effectiveRunId = existing?.run_id ?? input.runId;
  if (effectiveRunId) {
    const run = await db
      .prepare(
        `select 1 as current from briar_hunt_runs
         where id = ? and project_id = ?`,
      )
      .bind(effectiveRunId, projectId)
      .first<{ current: number }>();
    if (!run) {
      throw new WorkerConflictError(
        "Transcript run belongs to another project",
      );
    }
  }
  if (!existing) {
    await db
      .prepare(
        `insert into briar_agent_transcript_sessions (
           session_id, project_id, run_id, worker_id, agent_provider,
           started_at, last_event_at, event_count, byte_count
         ) values (?, ?, ?, ?, ?, ?, ?, 0, 0)
         on conflict (session_id) do nothing`,
      )
      .bind(
        input.sessionId,
        projectId,
        input.runId,
        input.workerId,
        input.agentProvider,
        input.observedAt,
        input.observedAt,
      )
      .run();
  }
  const bound = await db
    .prepare(
      `update briar_agent_transcript_sessions
       set run_id = coalesce(run_id, ?),
           worker_id = coalesce(worker_id, ?),
           last_event_at = max(last_event_at, ?)
       where session_id = ? and project_id = ?
         and (? is null or run_id is null or run_id = ?)`,
    )
    .bind(
      input.runId,
      input.workerId,
      input.observedAt,
      input.sessionId,
      projectId,
      input.runId,
      input.runId,
    )
    .run();
  if ((bound.meta.changes ?? 0) < 1) {
    throw new WorkerConflictError(
      "Transcript session belongs to another project or run",
    );
  }
}

const rawSegmentText = (events: TranscriptEventInput[]) =>
  `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;

const rawSegmentObjectKey = (
  projectId: string,
  sessionId: string,
  firstSequence: number,
  lastSequence: number,
  digest: string,
) =>
  `raw-transcripts/${projectId}/${sessionId}/` +
  `${String(firstSequence).padStart(12, "0")}-` +
  `${String(lastSequence).padStart(12, "0")}-${digest}.jsonl.gz`;

/**
 * Low-frequency recovery path for repairing session totals after manual data
 * maintenance. Normal transcript ingest relies on the segment delta triggers
 * installed by migration 0135 and must not call this full rescan.
 */
export async function recalculateAgentTranscriptSessionTotals(
  db: D1Database,
  sessionId: string,
) {
  await db
    .prepare(
      `update briar_agent_transcript_sessions
       set event_count = coalesce((
             select sum(event_count)
             from briar_agent_transcript_segments
             where session_id = ?
           ), 0),
           byte_count = coalesce((
             select sum(uncompressed_bytes)
             from briar_agent_transcript_segments
             where session_id = ?
           ), 0)
       where session_id = ?`,
    )
    .bind(sessionId, sessionId, sessionId)
    .run();
}

async function storeRawSegment(
  db: D1Database,
  bucket: R2Bucket,
  sessionId: string,
  projectId: string,
  events: TranscriptEventInput[],
  recordedAt: string,
) {
  const firstSequence = events[0]!.sequence;
  const lastSequence = events.at(-1)!.sequence;
  const plain = utf8Bytes(rawSegmentText(events));
  const digest = await sha256(plain);
  const existing = await db
    .prepare(
      `select * from briar_agent_transcript_segments
       where session_id = ? and first_sequence = ? and last_sequence = ?`,
    )
    .bind(sessionId, firstSequence, lastSequence)
    .first<AgentTranscriptSegmentRow>();
  if (existing && existing.sha256 !== digest) {
    throw new WorkerConflictError(
      "Transcript segment sequence range was reused with different content",
    );
  }
  if (existing) {
    return { row: existing, stored: false };
  }

  const objectKey = rawSegmentObjectKey(
    projectId,
    sessionId,
    firstSequence,
    lastSequence,
    digest,
  );
  const existingObject = await bucket.head(objectKey);
  let compressedBytes: number;
  if (existingObject) {
    const metadata = existingObject.customMetadata;
    if (
      metadata?.projectId !== projectId ||
      metadata.sessionId !== sessionId ||
      metadata.firstSequence !== String(firstSequence) ||
      metadata.lastSequence !== String(lastSequence) ||
      metadata.sha256 !== digest
    ) {
      throw new WorkerConflictError(
        "Transcript segment object metadata does not match its deterministic key",
      );
    }
    compressedBytes = existingObject.size;
  } else {
    const compressed = await gzip(plain);
    await bucket.put(objectKey, compressed, {
      httpMetadata: {
        contentType: "application/x-ndjson",
        contentEncoding: "gzip",
      },
      customMetadata: {
        projectId,
        sessionId,
        firstSequence: String(firstSequence),
        lastSequence: String(lastSequence),
        sha256: digest,
        archivePolicy: "meaningful-events-coalesced-deltas-v1",
      },
    });
    compressedBytes = compressed.byteLength;
  }
  const row: AgentTranscriptSegmentRow = {
    session_id: sessionId,
    first_sequence: firstSequence,
    last_sequence: lastSequence,
    object_key: objectKey,
    event_count: events.length,
    uncompressed_bytes: plain.byteLength,
    compressed_bytes: compressedBytes,
    sha256: digest,
    recorded_at: recordedAt,
  };
  const inserted = await db
    .prepare(
      `insert into briar_agent_transcript_segments (
         session_id, first_sequence, last_sequence, object_key, event_count,
         uncompressed_bytes, compressed_bytes, sha256, recorded_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict (session_id, first_sequence, last_sequence) do nothing`,
    )
    .bind(
      row.session_id,
      row.first_sequence,
      row.last_sequence,
      row.object_key,
      row.event_count,
      row.uncompressed_bytes,
      row.compressed_bytes,
      row.sha256,
      row.recorded_at,
    )
    .run();
  if ((inserted.meta.changes ?? 0) < 1) {
    const concurrent = await db
      .prepare(
        `select * from briar_agent_transcript_segments
         where session_id = ? and first_sequence = ? and last_sequence = ?`,
      )
      .bind(sessionId, firstSequence, lastSequence)
      .first<AgentTranscriptSegmentRow>();
    if (!concurrent || concurrent.sha256 !== digest) {
      await bucket.delete(objectKey);
      throw new WorkerConflictError(
        "Transcript segment changed while it was being stored",
      );
    }
    return { row: concurrent, stored: false };
  }
  return { row, stored: true };
}

const newMessageEntry = (
  sessionId: string,
  entryId: string,
  sequence: number,
  observedAt: string,
  event: NormalizedEvent,
): AgentWorkLogEntryRow => ({
  session_id: sessionId,
  entry_id: entryId,
  sequence,
  updated_sequence: sequence,
  entry_type: "message",
  activity_kind: null,
  phase: string(event.phase),
  title: null,
  body: boundedWorkLogText(string(event.text) ?? ""),
  status: event.type === "messageCompleted" ? "completed" : "writing",
  started_at: observedAt,
  updated_at: observedAt,
  completed_at: event.type === "messageCompleted" ? observedAt : null,
});

const newActivityEntry = (
  sessionId: string,
  entryId: string,
  sequence: number,
  observedAt: string,
  event: NormalizedEvent,
): AgentWorkLogEntryRow => ({
  session_id: sessionId,
  entry_id: entryId,
  sequence,
  updated_sequence: sequence,
  entry_type: "activity",
  activity_kind: activityKind(event.kind),
  phase: null,
  title: string(event.title),
  body: boundedWorkLogText(string(event.text) ?? ""),
  status: event.type === "activityCompleted"
    ? completedActivityStatus(event.status)
    : "writing",
  started_at: observedAt,
  updated_at: observedAt,
  completed_at: event.type === "activityCompleted" ? observedAt : null,
});

async function projectWorkLog(
  db: D1Database,
  sessionId: string,
  events: TranscriptEventInput[],
  observedAt: string,
) {
  const projectable = events
    .map((item) => ({ item, event: normalizedEvent(item.payload) }))
    .filter(
      (value): value is { item: TranscriptEventInput; event: NormalizedEvent } =>
        value.event !== null,
    );
  const entryIds = [...new Set(
    projectable
      .map(({ event }) => string(event.id))
      .filter((entryId): entryId is string => entryId !== null),
  )];
  const closesTurn = projectable.some(
    ({ event }) => event.type === "turnCompleted",
  );
  if (entryIds.length === 0 && !closesTurn) return 0;
  const existingFilters: string[] = [];
  const bindings: unknown[] = [sessionId];
  if (entryIds.length > 0) {
    existingFilters.push(
      `entry_id in (${entryIds.map(() => "?").join(", ")})`,
    );
    bindings.push(...entryIds);
  }
  if (closesTurn) existingFilters.push("status = 'writing'");
  const existingRows = await db
    .prepare(
      `select * from briar_agent_worklog_entries
       where session_id = ? and (${existingFilters.join(" or ")})
       order by sequence, entry_id`,
    )
    .bind(...bindings)
    .all<AgentWorkLogEntryRow>();
  const entries = new Map(
    (existingRows.results ?? []).map((entry) => [entry.entry_id, entry]),
  );
  const changed = new Set<string>();
  let turnCompletedSequence: number | null = null;

  for (const { item, event } of projectable) {
    if (event.type === "turnCompleted") {
      turnCompletedSequence = item.sequence;
      continue;
    }
    const entryId = string(event.id);
    if (!entryId) continue;
    const existing = entries.get(entryId);
    if (existing && item.sequence <= existing.updated_sequence) continue;

    let next: AgentWorkLogEntryRow | null = null;
    if (event.type === "messageStarted" || event.type === "messageCompleted") {
      next = existing ?? newMessageEntry(
        sessionId,
        entryId,
        item.sequence,
        observedAt,
        event,
      );
      next = {
        ...next,
        phase: string(event.phase) ?? next.phase,
        body: boundedWorkLogText(string(event.text) ?? next.body),
        status: event.type === "messageCompleted" ? "completed" : next.status,
        updated_sequence: item.sequence,
        updated_at: observedAt,
        completed_at: event.type === "messageCompleted"
          ? observedAt
          : next.completed_at,
      };
    } else if (event.type === "messageDelta") {
      next = existing ?? newMessageEntry(
        sessionId,
        entryId,
        item.sequence,
        observedAt,
        { ...event, type: "messageStarted", text: "" },
      );
      if (next.status === "writing") {
        next = {
          ...next,
          body: boundedWorkLogText(
            `${next.body}${string(event.delta) ?? ""}`,
          ),
          updated_sequence: item.sequence,
          updated_at: observedAt,
        };
      }
    } else if (
      event.type === "activityStarted" || event.type === "activityCompleted"
    ) {
      next = existing ?? newActivityEntry(
        sessionId,
        entryId,
        item.sequence,
        observedAt,
        event,
      );
      next = {
        ...next,
        activity_kind: activityKind(event.kind ?? next.activity_kind),
        title: string(event.title) ?? next.title,
        body: boundedWorkLogText(string(event.text) ?? next.body),
        status: event.type === "activityCompleted"
          ? completedActivityStatus(event.status)
          : next.status,
        updated_sequence: item.sequence,
        updated_at: observedAt,
        completed_at: event.type === "activityCompleted"
          ? observedAt
          : next.completed_at,
      };
    } else if (event.type === "activityDelta") {
      next = existing ?? newActivityEntry(
        sessionId,
        entryId,
        item.sequence,
        observedAt,
        { ...event, type: "activityStarted", text: "" },
      );
      if (next.status === "writing") {
        next = {
          ...next,
          body: boundedWorkLogText(
            `${next.body}${string(event.delta) ?? ""}`,
          ),
          updated_sequence: item.sequence,
          updated_at: observedAt,
        };
      }
    }
    if (next) {
      entries.set(entryId, next);
      changed.add(entryId);
    }
  }

  if (turnCompletedSequence !== null) {
    for (const [entryId, entry] of entries) {
      if (entry.status !== "writing") continue;
      entries.set(entryId, {
        ...entry,
        status: "interrupted",
        updated_sequence: Math.max(
          entry.updated_sequence,
          turnCompletedSequence,
        ),
        updated_at: observedAt,
        completed_at: observedAt,
      });
      changed.add(entryId);
    }
  }

  if (changed.size === 0) return 0;
  await db.batch(
    [...changed].map((entryId) => {
      const entry = entries.get(entryId)!;
      return db.prepare(
        `insert into briar_agent_worklog_entries (
           session_id, entry_id, sequence, updated_sequence, entry_type,
           activity_kind, phase, title, body, status, started_at, updated_at,
           completed_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict (session_id, entry_id) do update set
           updated_sequence = excluded.updated_sequence,
           activity_kind = excluded.activity_kind,
           phase = excluded.phase,
           title = excluded.title,
           body = excluded.body,
           status = excluded.status,
           updated_at = excluded.updated_at,
           completed_at = excluded.completed_at
         where excluded.updated_sequence >
           briar_agent_worklog_entries.updated_sequence`,
      ).bind(
        entry.session_id,
        entry.entry_id,
        entry.sequence,
        entry.updated_sequence,
        entry.entry_type,
        entry.activity_kind,
        entry.phase,
        entry.title,
        entry.body,
        entry.status,
        entry.started_at,
        entry.updated_at,
        entry.completed_at,
      );
    }),
  );
  return changed.size;
}

export async function ingestAgentTranscript(
  db: D1Database,
  bucket: R2Bucket,
  projectId: string,
  input: {
    sessionId: string;
    runId: string | null;
    workerId: string | null;
    agentProvider: AgentProvider;
    events: TranscriptEventInput[];
    observedAt: string;
  },
) {
  validateEvents(input.events);
  await ensureTranscriptSession(db, projectId, input);
  const retainedEvents = retainedRawTranscriptEvents(input.events);
  const segment = retainedEvents.length > 0
    ? await storeRawSegment(
      db,
      bucket,
      input.sessionId,
      projectId,
      retainedEvents,
      input.observedAt,
    )
    : null;
  const projected = await projectWorkLog(
    db,
    input.sessionId,
    input.events,
    input.observedAt,
  );
  return {
    sessionId: input.sessionId,
    stored: segment?.stored ? retainedEvents.length : 0,
    storedBytes: segment?.stored ? segment.row.uncompressed_bytes : 0,
    compressedBytes: segment?.stored ? segment.row.compressed_bytes : 0,
    projected,
    pruned: [] as string[],
  };
}

export async function readAgentWorkLog(
  db: D1Database,
  projectId: string,
  sessionId: string,
) {
  const session = await db
    .prepare(
      `select session.*
       from briar_agent_transcript_sessions session
       left join briar_hunt_runs run on run.id = session.run_id
       where session.session_id = ? and session.project_id = ?
         and (session.run_id is null or run.project_id = session.project_id)`,
    )
    .bind(sessionId, projectId)
    .first<TranscriptSessionRow>();
  if (!session) return null;
  const result = await db
    .prepare(
      `select * from briar_agent_worklog_entries
       where session_id = ? order by sequence, entry_id`,
    )
    .bind(sessionId)
    .all<AgentWorkLogEntryRow>();
  return { session, entries: result.results ?? [] };
}

export async function readLatestAgentWorkLogForRun(
  db: D1Database,
  projectId: string,
  runId: string,
) {
  const latest = await db
    .prepare(
      `select session.session_id
       from briar_agent_transcript_sessions session
       join briar_hunt_runs run
         on run.id = session.run_id and run.project_id = session.project_id
       where session.project_id = ? and session.run_id = ?
       order by session.last_event_at desc, session.started_at desc,
                session.session_id desc limit 1`,
    )
    .bind(projectId, runId)
    .first<{ session_id: string }>();
  return latest
    ? readAgentWorkLog(db, projectId, latest.session_id)
    : null;
}

export async function listAgentTranscriptSegments(
  db: D1Database,
  projectId: string,
  sessionId: string,
) {
  const owned = await db
    .prepare(
      `select 1 as owned
       from briar_agent_transcript_sessions session
       left join briar_hunt_runs run on run.id = session.run_id
       where session.session_id = ? and session.project_id = ?
         and (session.run_id is null or run.project_id = session.project_id)`,
    )
    .bind(sessionId, projectId)
    .first<{ owned: number }>();
  if (!owned) return null;
  const result = await db
    .prepare(
      `select * from briar_agent_transcript_segments
       where session_id = ? order by first_sequence, last_sequence`,
    )
    .bind(sessionId)
    .all<AgentTranscriptSegmentRow>();
  return result.results ?? [];
}

export async function readRawTranscriptSegment(
  bucket: R2Bucket,
  segment: AgentTranscriptSegmentRow,
) {
  const object = await bucket.get(segment.object_key);
  if (!object) return null;
  return {
    body: object.body,
    contentType: object.httpMetadata?.contentType ?? "application/x-ndjson",
    contentEncoding: object.httpMetadata?.contentEncoding ?? "gzip",
    filename: `${segment.session_id}-${segment.first_sequence}-${segment.last_sequence}.jsonl.gz`,
  };
}

export const workLogEntryTranscriptEvent = (entry: AgentWorkLogEntryRow) => {
  if (entry.entry_type === "message") {
    return {
      type: entry.status === "writing" ? "messageStarted" : "messageCompleted",
      id: entry.entry_id,
      phase: entry.phase,
      text: entry.body,
    };
  }
  if (entry.status === "writing") {
    return {
      type: "activityStarted",
      id: entry.entry_id,
      kind: entry.activity_kind ?? "tool",
      title: entry.title ?? "Use tool",
      text: entry.body,
    };
  }
  return {
    type: "activityCompleted",
    id: entry.entry_id,
    kind: entry.activity_kind ?? "tool",
    title: entry.title ?? "Use tool",
    text: entry.body,
    status: entry.status === "failed"
      ? "failed"
      : entry.status === "completed"
        ? "completed"
        : "cancelled",
  };
};
