import { Miniflare } from "miniflare";
import { afterEach, describe, expect, it } from "vitest";
import {
  ARCHIVE_MAX_ROWS,
  archiveProjectSessionBatch,
  archiveRunBatch,
  readArchivedRecords,
  restoreArchivedIssueMessage,
} from "./archive";

const projectId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const old = "2025-01-01T00:00:00.000Z";
const now = new Date("2026-08-01T00:00:00.000Z");

class MemoryR2 {
  readonly objects = new Map<string, ArrayBuffer>();
  failVerification = false;

  async put(key: string, value: ArrayBuffer | ArrayBufferView | string | Blob) {
    let bytes: ArrayBuffer;
    if (typeof value === "string") {
      bytes = new TextEncoder().encode(value).buffer;
    } else if (value instanceof Blob) {
      bytes = await value.arrayBuffer();
    } else if (ArrayBuffer.isView(value)) {
      bytes = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
    } else {
      bytes = value;
    }
    this.objects.set(key, bytes.slice(0));
    return {};
  }

  async get(key: string) {
    if (this.failVerification) return null;
    const value = this.objects.get(key);
    return value ? { arrayBuffer: async () => value.slice(0) } : null;
  }

  async delete(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key);
  }
}

const schema = `
  create table user (id text primary key, name text, image text);
  create table briar_projects (id text primary key);
  create table briar_hunt_runs (
    id text primary key, project_id text not null, status text not null,
    completed_at text, event_count integer not null default 0
  );
  create table briar_hunt_events (
    id text primary key, run_id text not null, occurred_at text not null,
    detail text
  );
  create table briar_run_evidence (
    id text primary key, project_id text not null, run_id text not null,
    observed_at text not null, detail text
  );
  create table briar_run_evidence_images (
    id text primary key, project_id text not null, run_id text not null,
    evidence_id text not null, object_key text not null, filename text not null,
    content_type text not null, byte_size integer not null, sha256 text not null,
    position integer not null, created_at text not null
  );
  create table briar_issue_messages (
    id text primary key, project_id text not null, run_id text not null,
    parent_message_id text, author_user_id text, author_agent_provider text,
    body text not null, updated_at text not null, created_at text not null
  );
  create table briar_execution_audit_events (
    id text primary key, project_id text not null, run_id text,
    occurred_at text not null, detail_json text not null
  );
  create table briar_agent_transcript_sessions (
    session_id text primary key, project_id text not null, run_id text,
    last_event_at text not null
  );
  create table briar_agent_transcripts (
    session_id text not null, sequence integer not null, direction text not null,
    payload_json text not null, recorded_at text not null,
    primary key (session_id, sequence)
  );
  create table briar_project_agent_sessions (
    project_id text not null, id text not null, status text not null,
    payload_json text not null, updated_at text not null,
    primary key (project_id, id)
  );
  create table briar_log_archives (
    id text primary key, project_id text not null, run_id text,
    object_key text not null unique, format_version integer not null,
    content_encoding text not null, row_count integer not null,
    byte_count integer not null, sha256 text not null, period_start text not null,
    period_end text not null, created_at text not null, verified_at text not null
  );
`;

async function fixture() {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: crypto.randomUUID() },
  });
  const db = await miniflare.getD1Database("DB") as unknown as D1Database;
  for (const statement of schema.split(/;\s*(?:\n|$)/u)) {
    if (statement.trim()) await db.prepare(statement).run();
  }
  await db.prepare("insert into briar_projects (id) values (?)").bind(projectId).run();
  await db.prepare(
    `insert into briar_hunt_runs (id, project_id, status, completed_at)
     values (?, ?, 'completed', ?)`,
  ).bind(runId, projectId, old).run();
  return { miniflare, db, bucket: new MemoryR2() };
}

const openMiniflares: Miniflare[] = [];
afterEach(async () => {
  await Promise.all(openMiniflares.splice(0).map((item) => item.dispose()));
});

describe("D1 to R2 log archive", () => {
  it("verifies R2 before atomically removing hot rows and is idempotent", async () => {
    const item = await fixture();
    openMiniflares.push(item.miniflare);
    await item.db.prepare(
      "insert into briar_hunt_events (id, run_id, occurred_at, detail) values (?, ?, ?, ?)",
    ).bind("event-1", runId, old, "historical event").run();
    await item.db.prepare(
      `insert into briar_agent_transcript_sessions
       (session_id, project_id, run_id, last_event_at) values (?, ?, ?, ?)`,
    ).bind("session-1", projectId, runId, old).run();
    await item.db.prepare(
      `insert into briar_agent_transcripts
       (session_id, sequence, direction, payload_json, recorded_at)
       values (?, 1, 'server', ?, ?)`,
    ).bind("session-1", '{"message":"archived"}', old).run();
    await item.db.prepare(
      `insert into briar_execution_audit_events
       (id, project_id, run_id, occurred_at, detail_json) values (?, ?, ?, ?, ?)`,
    ).bind("audit-1", projectId, runId, old, '{"action":"claimed"}').run();

    const manifest = await archiveRunBatch(
      item.db, item.bucket as unknown as R2Bucket, projectId, runId, now,
    );
    expect(manifest?.row_count).toBe(3);
    expect(manifest?.object_key).toMatch(/^v1\/projects\//u);
    expect(item.bucket.objects.size).toBe(1);
    expect((await item.db.prepare("select count(*) as count from briar_hunt_events").first<{ count: number }>())?.count).toBe(0);
    expect((await item.db.prepare("select count(*) as count from briar_agent_transcripts").first<{ count: number }>())?.count).toBe(0);
    const recovered = await readArchivedRecords(
      item.db, item.bucket as unknown as R2Bucket, projectId, runId,
    );
    expect(recovered.map((record) => record.key).sort()).toEqual([
      "audit-1", "event-1", "session-1:1",
    ]);
    expect(recovered.find((record) => record.key === "event-1")?.table)
      .toBe("briar_hunt_events");
    expect(recovered.find((record) => record.key === "audit-1")?.table)
      .toBe("briar_execution_audit_events");

    expect(await archiveRunBatch(
      item.db, item.bucket as unknown as R2Bucket, projectId, runId, now,
    )).toBeNull();
    expect(item.bucket.objects.size).toBe(1);
  });

  it("keeps D1 source rows when upload verification fails", async () => {
    const item = await fixture();
    openMiniflares.push(item.miniflare);
    await item.db.prepare(
      "insert into briar_hunt_events (id, run_id, occurred_at) values (?, ?, ?)",
    ).bind("event-safe", runId, old).run();
    item.bucket.failVerification = true;

    await expect(archiveRunBatch(
      item.db, item.bucket as unknown as R2Bucket, projectId, runId, now,
    )).rejects.toThrow(/verification failed/u);
    expect((await item.db.prepare("select count(*) as count from briar_hunt_events").first<{ count: number }>())?.count).toBe(1);
    expect((await item.db.prepare("select count(*) as count from briar_log_archives").first<{ count: number }>())?.count).toBe(0);
  });

  it("archives project-level sessions and audit records without a run", async () => {
    const item = await fixture();
    openMiniflares.push(item.miniflare);
    await item.db.prepare(
      `insert into briar_project_agent_sessions
       (project_id, id, status, payload_json, updated_at)
       values (?, ?, 'completed', ?, ?)`,
    ).bind(projectId, "dispatch-1", '{"summary":"done"}', old).run();
    await item.db.prepare(
      `insert into briar_execution_audit_events
       (id, project_id, run_id, occurred_at, detail_json)
       values (?, ?, null, ?, ?)`,
    ).bind("audit-project", projectId, old, '{"readiness":"ready"}').run();

    const manifest = await archiveProjectSessionBatch(
      item.db, item.bucket as unknown as R2Bucket, projectId, now,
    );
    expect(manifest?.row_count).toBe(2);
    const recovered = await readArchivedRecords(
      item.db, item.bucket as unknown as R2Bucket, projectId, null,
    );
    expect(recovered.map((record) => record.table).sort()).toEqual([
      "briar_execution_audit_events", "briar_project_agent_sessions",
    ]);
    expect((await item.db.prepare(
      "select count(*) as count from briar_project_agent_sessions",
    ).first<{ count: number }>())?.count).toBe(0);
    expect((await item.db.prepare(
      "select count(*) as count from briar_execution_audit_events where run_id is null",
    ).first<{ count: number }>())?.count).toBe(0);
  });

  it("rehydrates an archived thread root before a new reply", async () => {
    const item = await fixture();
    openMiniflares.push(item.miniflare);
    await item.db.prepare(
      `insert into briar_issue_messages (
         id, project_id, run_id, parent_message_id, author_user_id,
         author_agent_provider, body, created_at, updated_at
       ) values (?, ?, ?, null, null, 'codex', ?, ?, ?)`,
    ).bind("message-root", projectId, runId, "Archived question", old, old).run();
    await archiveRunBatch(
      item.db, item.bucket as unknown as R2Bucket, projectId, runId, now,
    );
    expect((await item.db.prepare(
      "select count(*) as count from briar_issue_messages",
    ).first<{ count: number }>())?.count).toBe(0);

    expect(await restoreArchivedIssueMessage(
      item.db, item.bucket as unknown as R2Bucket, projectId, runId,
      "message-root",
    )).toBe(true);
    expect((await item.db.prepare(
      "select body from briar_issue_messages where id = 'message-root'",
    ).first<{ body: string }>())?.body).toBe("Archived question");
  });

  it("bounds large fixtures and drains them across repeatable batches", async () => {
    const item = await fixture();
    openMiniflares.push(item.miniflare);
    const total = ARCHIVE_MAX_ROWS + 125;
    for (let offset = 0; offset < total; offset += 100) {
      await item.db.batch(
        Array.from({ length: Math.min(100, total - offset) }, (_, index) => {
          const sequence = offset + index;
          return item.db.prepare(
            "insert into briar_hunt_events (id, run_id, occurred_at, detail) values (?, ?, ?, ?)",
          ).bind(`event-${String(sequence).padStart(4, "0")}`, runId, old, "x".repeat(1_000));
        }),
      );
    }

    const first = await archiveRunBatch(
      item.db, item.bucket as unknown as R2Bucket, projectId, runId, now,
    );
    expect(first?.row_count).toBe(ARCHIVE_MAX_ROWS);
    expect(first?.byte_count).toBeLessThan(4 * 1024 * 1024);
    expect((await item.db.prepare("select count(*) as count from briar_hunt_events").first<{ count: number }>())?.count).toBe(125);

    const second = await archiveRunBatch(
      item.db, item.bucket as unknown as R2Bucket, projectId, runId, now,
    );
    expect(second?.row_count).toBe(125);
    expect(item.bucket.objects.size).toBe(2);
    expect((await readArchivedRecords(
      item.db, item.bucket as unknown as R2Bucket, projectId, runId,
    )).length).toBe(total);
  });
});
