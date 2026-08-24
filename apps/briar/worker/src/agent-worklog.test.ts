import { Miniflare } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agentProviders } from "../../src/lib/agent-provider";
import {
  ingestAgentTranscript,
  listAgentTranscriptSegments,
  readAgentWorkLog,
  retainedRawTranscriptEvents,
} from "./agent-worklog";
import { MAX_TRANSCRIPT_PAYLOAD_BYTES } from "./transcript-limits";
import {
  createIsolatedTestDatabase,
  executeD1Sql,
} from "./test-helpers/d1";

const projectId = "11111111-1111-4111-8111-111111111111";
const observedAt = "2026-08-13T00:00:00.000Z";

describe("provider-independent agent work log", () => {
  let miniflare: Miniflare;
  let db: D1Database;
  let bucket: R2Bucket;

  beforeAll(async () => {
    const database = await createIsolatedTestDatabase({
      suite: "agent-worklog",
      miniflareOptions: {
        modules: true,
        script: "export default { fetch() { return new Response('ok') } }",
        r2Buckets: ["ARCHIVES"],
      },
    });
    miniflare = database.miniflare;
    db = database.db;
    bucket = (await miniflare.getR2Bucket("ARCHIVES")) as unknown as R2Bucket;
    await executeD1Sql(
      db,
      `insert into user (id, name, email, emailVerified, createdAt, updatedAt)
       values ('owner', 'Owner', 'owner@example.com', 1, '${observedAt}', '${observedAt}');
       insert into briar_organizations (id, name, handle, created_at, updated_at)
       values ('${projectId}', 'Worklog Org', 'worklog-org', '${observedAt}', '${observedAt}');
       insert into briar_organization_members (
         organization_id, user_id, role, created_at, updated_at
       ) values ('${projectId}', 'owner', 'owner', '${observedAt}', '${observedAt}');
       insert into briar_projects (
         id, owner_user_id, organization_id, name, agent_token_hash,
         created_at, updated_at
       ) values (
         '${projectId}', 'owner', '${projectId}', 'Worklog',
         'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         '${observedAt}', '${observedAt}'
       );`,
    );
  });

  afterAll(async () => {
    await miniflare.dispose();
  });

  beforeEach(async () => {
    await executeD1Sql(
      db,
      `delete from briar_agent_transcript_sessions;`,
    );
  });

  it.each(agentProviders)(
    "projects %s events into the same compact schema",
    async (provider) => {
      const sessionId = `provider-${provider}`;
      const first = [
        {
          sequence: 1,
          direction: "server" as const,
          payload: {
            type: "event",
            event: {
              type: "messageStarted",
              id: "assistant-1",
              phase: "commentary",
              text: "Hello",
            },
          },
        },
        {
          sequence: 2,
          direction: "server" as const,
          payload: {
            type: "event",
            raw: { provider, token: " world" },
            event: {
              type: "messageDelta",
              id: "assistant-1",
              delta: " world",
            },
          },
        },
      ];
      await ingestAgentTranscript(db, bucket, projectId, {
        sessionId,
        runId: null,
        workerId: null,
        agentProvider: provider,
        events: first,
        observedAt,
      });
      const finalBatch: Parameters<typeof ingestAgentTranscript>[3] = {
        sessionId,
        runId: null,
        workerId: null,
        agentProvider: provider,
        events: [{
          sequence: 3,
          direction: "server",
          payload: {
            type: "event",
            event: {
              type: "messageCompleted",
              id: "assistant-1",
              phase: "final",
              text: "Hello world",
            },
          },
        }],
        observedAt: "2026-08-13T00:00:01.000Z",
      };
      await ingestAgentTranscript(db, bucket, projectId, finalBatch);
      expect(
        await ingestAgentTranscript(db, bucket, projectId, finalBatch),
      ).toMatchObject({ stored: 0, projected: 0 });

      const workLog = await readAgentWorkLog(db, projectId, sessionId);
      expect(workLog?.entries).toEqual([
        expect.objectContaining({
          entry_id: "assistant-1",
          entry_type: "message",
          body: "Hello world",
          status: "completed",
          sequence: 1,
          updated_sequence: 3,
        }),
      ]);
      expect(await listAgentTranscriptSegments(db, projectId, sessionId))
        .toHaveLength(2);
      expect(workLog?.session).toMatchObject({ event_count: 2 });
      expect(
        await db.prepare(
          `select count(*) as count from briar_agent_transcripts
           where session_id = ?`,
        ).bind(sessionId).first<number>("count"),
      ).toBe(0);
    },
  );

  it("retains more than the former 5,000-event cap without growing D1 rows", async () => {
    const sessionId = "large-grok-session";
    const events = Array.from({ length: 5_200 }, (_, index) => ({
      sequence: index + 1,
      direction: "server" as const,
      payload: {
        type: "event",
        raw: {
          update: {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: `thought-${index}` },
          },
        },
      },
    }));
    for (let offset = 0; offset < events.length; offset += 200) {
      await ingestAgentTranscript(db, bucket, projectId, {
        sessionId,
        runId: null,
        workerId: null,
        agentProvider: "grok",
        events: events.slice(offset, offset + 200),
        observedAt,
      });
    }

    const segments = await listAgentTranscriptSegments(
      db,
      projectId,
      sessionId,
    );
    expect(segments).toEqual([]);
    expect((await readAgentWorkLog(db, projectId, sessionId))?.entries)
      .toEqual([]);
    expect(
      await db.prepare(
        `select count(*) as count from briar_agent_transcripts
         where session_id = ?`,
      ).bind(sessionId).first<number>("count"),
    ).toBe(0);
  });

  it("bounds an unfinished projected entry while raw deltas keep streaming", async () => {
    const events = Array.from({ length: 400 }, (_, index) => ({
      sequence: index + 1,
      direction: "server" as const,
      payload: {
        type: "event",
        event: {
          type: "messageDelta",
          id: "long-answer",
          delta: "가".repeat(100),
        },
      },
    }));
    for (let offset = 0; offset < events.length; offset += 200) {
      await ingestAgentTranscript(db, bucket, projectId, {
        sessionId: "bounded-projection",
        runId: null,
        workerId: null,
        agentProvider: "codex",
        events: events.slice(offset, offset + 200),
        observedAt,
      });
    }

    const entry = (await readAgentWorkLog(
      db,
      projectId,
      "bounded-projection",
    ))?.entries[0];
    expect(new TextEncoder().encode(entry?.body).byteLength)
      .toBeLessThanOrEqual(MAX_TRANSCRIPT_PAYLOAD_BYTES);
    expect(entry?.status).toBe("writing");
    expect(await listAgentTranscriptSegments(
      db,
      projectId,
      "bounded-projection",
    )).toEqual([]);
  });

  it("retains replay boundaries while removing high-frequency deltas", () => {
    const events = [
      {
        sequence: 1,
        direction: "client" as const,
        payload: { type: "userMessage", text: "Run tests" },
      },
      {
        sequence: 2,
        direction: "server" as const,
        payload: {
          type: "event",
          event: { type: "messageDelta", id: "answer", delta: "Working" },
        },
      },
      {
        sequence: 3,
        direction: "server" as const,
        payload: {
          type: "event",
          event: { type: "activityStarted", id: "tool", kind: "command" },
        },
      },
      {
        sequence: 4,
        direction: "server" as const,
        payload: {
          type: "event",
          event: { type: "activityDelta", id: "tool", delta: "PASS" },
        },
      },
      {
        sequence: 5,
        direction: "server" as const,
        payload: {
          type: "event",
          event: {
            type: "activityCompleted",
            id: "tool",
            text: "PASS",
            status: "completed",
          },
        },
      },
      {
        sequence: 6,
        direction: "server" as const,
        payload: {
          type: "event",
          event: { type: "messageCompleted", id: "answer", text: "Done" },
        },
      },
    ];

    expect(retainedRawTranscriptEvents(events).map((event) => event.sequence))
      .toEqual([1, 3, 5, 6]);
  });

  it("closes unfinished entries when a provider turn terminates", async () => {
    await ingestAgentTranscript(db, bucket, projectId, {
      sessionId: "interrupted-session",
      runId: null,
      workerId: null,
      agentProvider: "claude",
      observedAt,
      events: [
        {
          sequence: 1,
          direction: "server",
          payload: {
            type: "event",
            event: {
              type: "messageStarted",
              id: "assistant-1",
              phase: "commentary",
              text: "Partial",
            },
          },
        },
        {
          sequence: 2,
          direction: "server",
          payload: {
            type: "event",
            event: { type: "turnCompleted", status: "failed" },
          },
        },
      ],
    });

    expect(
      (await readAgentWorkLog(db, projectId, "interrupted-session"))
        ?.entries[0],
    ).toMatchObject({
      body: "Partial",
      status: "interrupted",
      updated_sequence: 2,
    });
  });

  it("recovers an interrupted delta stream without duplicate raw archives", async () => {
    const partial = {
      sessionId: "retried-interrupted-session",
      runId: null,
      workerId: null,
      agentProvider: "codex" as const,
      observedAt,
      events: [{
        sequence: 1,
        direction: "server" as const,
        payload: {
          type: "event",
          event: { type: "messageDelta", id: "answer", delta: "Partial" },
        },
      }],
    };
    expect(await ingestAgentTranscript(db, bucket, projectId, partial))
      .toMatchObject({ stored: 0, projected: 1 });
    expect(await ingestAgentTranscript(db, bucket, projectId, partial))
      .toMatchObject({ stored: 0, projected: 0 });

    const terminal = {
      ...partial,
      observedAt: "2026-08-13T00:00:01.000Z",
      events: [{
        sequence: 2,
        direction: "server" as const,
        payload: {
          type: "event",
          event: { type: "turnCompleted", status: "failed" },
        },
      }],
    };
    expect(await ingestAgentTranscript(db, bucket, projectId, terminal))
      .toMatchObject({ stored: 1, projected: 1 });
    expect(await ingestAgentTranscript(db, bucket, projectId, terminal))
      .toMatchObject({ stored: 0, projected: 0 });

    expect(
      (await readAgentWorkLog(db, projectId, partial.sessionId))?.entries[0],
    ).toMatchObject({ body: "Partial", status: "interrupted" });
    expect(await listAgentTranscriptSegments(
      db,
      projectId,
      partial.sessionId,
    )).toHaveLength(1);
  });

});
