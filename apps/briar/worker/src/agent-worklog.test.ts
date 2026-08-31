import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agentProviders } from "../../src/lib/agent-provider";
import {
  ingestAgentTranscript,
  listAgentTranscriptSegments,
  recalculateAgentTranscriptSessionTotals,
  readAgentWorkLog,
  retainedRawTranscriptEvents,
} from "./agent-worklog";
import { MAX_TRANSCRIPT_PAYLOAD_BYTES } from "./transcript-limits";
import { executeD1Sql } from "./test-helpers/d1";

const projectId = "11111111-1111-4111-8111-111111111111";
const observedAt = "2026-08-13T00:00:00.000Z";

describe("provider-independent agent work log", () => {
  const db = env.DB;
  const bucket = env.ARCHIVES;

  beforeAll(async () => {
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

  beforeEach(async () => {
    await executeD1Sql(
      db,
      `delete from briar_agent_transcript_sessions;`,
    );
  });

  const expectSessionTotalsToMatchSegments = async (sessionId: string) => {
    const totals = await db.prepare(
      `select session.event_count, session.byte_count,
              coalesce(sum(segment.event_count), 0) as summed_event_count,
              coalesce(sum(segment.uncompressed_bytes), 0) as summed_byte_count
       from briar_agent_transcript_sessions session
       left join briar_agent_transcript_segments segment
         on segment.session_id = session.session_id
       where session.session_id = ?
       group by session.session_id`,
    ).bind(sessionId).first<{
      event_count: number;
      byte_count: number;
      summed_event_count: number;
      summed_byte_count: number;
    }>();
    expect(totals).not.toBeNull();
    expect(totals?.event_count).toBe(totals?.summed_event_count);
    expect(totals?.byte_count).toBe(totals?.summed_byte_count);
    return totals!;
  };

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
    const input: Parameters<typeof ingestAgentTranscript>[3] = {
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
            event: {
              type: "messageDelta",
              id: "assistant-1",
              delta: " output",
            },
            archiveCompaction: {
              kind: "delta",
              firstSequence: 2,
              eventCount: 12,
            },
          },
        },
        {
          sequence: 3,
          direction: "server",
          payload: {
            type: "event",
            event: { type: "turnCompleted", status: "failed" },
          },
        },
      ],
    };
    await ingestAgentTranscript(db, bucket, projectId, input);

    expect(
      (await readAgentWorkLog(db, projectId, "interrupted-session"))
        ?.entries[0],
    ).toMatchObject({
      body: "Partial output",
      status: "interrupted",
      updated_sequence: 3,
    });

    const retry = await ingestAgentTranscript(db, bucket, projectId, input);
    expect(retry).toMatchObject({ stored: 0, projected: 0 });
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

  it("replays user messages, compacted tool output, and the final result", async () => {
    const sessionId = "representative-compact-session";
    const events: Parameters<typeof ingestAgentTranscript>[3]["events"] = [
      {
        sequence: 1,
        direction: "client",
        payload: {
          type: "event",
          direction: "client",
          event: {
            type: "messageCompleted",
            id: "user-1",
            phase: "user",
            text: "Inspect the deployment",
          },
        },
      },
      {
        sequence: 2,
        direction: "server",
        payload: {
          type: "event",
          event: {
            type: "activityStarted",
            id: "tool-1",
            kind: "command",
            title: "wrangler deployments list",
            text: "",
          },
        },
      },
      {
        sequence: 4,
        direction: "server",
        payload: {
          type: "event",
          event: {
            type: "activityDelta",
            id: "tool-1",
            delta: "deployment-a\ndeployment-b",
          },
          archiveCompaction: {
            kind: "delta",
            firstSequence: 3,
            eventCount: 2,
          },
        },
      },
      {
        sequence: 5,
        direction: "server",
        payload: {
          type: "event",
          event: {
            type: "activityCompleted",
            id: "tool-1",
            kind: "command",
            title: "wrangler deployments list",
            text: "deployment-a\ndeployment-b",
            status: "completed",
          },
        },
      },
      {
        sequence: 6,
        direction: "server",
        payload: {
          type: "event",
          event: {
            type: "messageCompleted",
            id: "assistant-1",
            phase: "final",
            text: "Deployment is healthy",
          },
        },
      },
      {
        sequence: 7,
        direction: "server",
        payload: {
          type: "event",
          event: { type: "turnCompleted", status: "completed" },
        },
      },
    ];
    const input = {
      sessionId,
      runId: null,
      workerId: null,
      agentProvider: "codex" as const,
      events,
      observedAt,
    };

    await ingestAgentTranscript(db, bucket, projectId, input);
    expect(await ingestAgentTranscript(db, bucket, projectId, input))
      .toMatchObject({ stored: 0, projected: 0 });

    const workLog = await readAgentWorkLog(db, projectId, sessionId);
    expect(workLog?.entries).toEqual([
      expect.objectContaining({
        entry_id: "user-1",
        entry_type: "message",
        body: "Inspect the deployment",
        status: "completed",
      }),
      expect.objectContaining({
        entry_id: "tool-1",
        entry_type: "activity",
        activity_kind: "command",
        body: "deployment-a\ndeployment-b",
        status: "completed",
      }),
      expect.objectContaining({
        entry_id: "assistant-1",
        entry_type: "message",
        body: "Deployment is healthy",
        status: "completed",
      }),
    ]);
    expect(await listAgentTranscriptSegments(db, projectId, sessionId))
      .toEqual([
        expect.objectContaining({
          first_sequence: 1,
          last_sequence: 7,
          event_count: 6,
        }),
      ]);
  });

  it("reuses an exact R2 object when retry repairs a missing D1 manifest", async () => {
    const sessionId = "manifest-recovery-session";
    const input = {
      sessionId,
      runId: null,
      workerId: null,
      agentProvider: "codex" as const,
      observedAt,
      events: [{
        sequence: 1,
        direction: "server" as const,
        payload: { type: "result", message: "done" },
      }],
    };
    await ingestAgentTranscript(db, bucket, projectId, input);
    const [firstSegment] =
      (await listAgentTranscriptSegments(db, projectId, sessionId))!;
    expect((await expectSessionTotalsToMatchSegments(sessionId)).event_count)
      .toBe(1);
    await db.prepare(
      `delete from briar_agent_transcript_segments where session_id = ?`,
    ).bind(sessionId).run();
    expect(await expectSessionTotalsToMatchSegments(sessionId)).toMatchObject({
      event_count: 0,
      byte_count: 0,
    });
    const retryBucket = {
      head: bucket.head.bind(bucket),
      put: () => {
        throw new Error("retry must not put the existing object again");
      },
      delete: bucket.delete.bind(bucket),
    } as unknown as R2Bucket;

    await expect(
      ingestAgentTranscript(db, retryBucket, projectId, input),
    ).resolves.toMatchObject({ stored: 1, projected: 0 });
    expect(await listAgentTranscriptSegments(db, projectId, sessionId))
      .toEqual([expect.objectContaining({ object_key: firstSegment.object_key })]);
    expect((await expectSessionTotalsToMatchSegments(sessionId)).event_count)
      .toBe(1);
    await expect(bucket.head(firstSegment.object_key)).resolves.toMatchObject({
      customMetadata: {
        archivePolicy: "meaningful-events-coalesced-deltas-v1",
      },
    });
  });

  it("keeps incremental session totals exact across insert, duplicate, upsert, retry, and concurrent ingest", async () => {
    const sessionId = "incremental-session-totals";
    const inputFor = (sequence: number) => ({
      sessionId,
      runId: null,
      workerId: null,
      agentProvider: "codex" as const,
      observedAt: `2026-08-13T00:00:0${sequence}.000Z`,
      events: [{
        sequence,
        direction: "server" as const,
        payload: { type: "result", message: `result-${sequence}` },
      }],
    });

    const first = inputFor(1);
    expect(await ingestAgentTranscript(db, bucket, projectId, first))
      .toMatchObject({ stored: 1 });
    const afterInsert = await expectSessionTotalsToMatchSegments(sessionId);
    expect(afterInsert.event_count).toBe(1);

    expect(await ingestAgentTranscript(db, bucket, projectId, first))
      .toMatchObject({ stored: 0 });
    expect(await expectSessionTotalsToMatchSegments(sessionId))
      .toEqual(afterInsert);

    const concurrent = await Promise.all([
      ingestAgentTranscript(db, bucket, projectId, inputFor(2)),
      ingestAgentTranscript(db, bucket, projectId, inputFor(2)),
      ingestAgentTranscript(db, bucket, projectId, inputFor(3)),
    ]);
    expect(concurrent.map((result) => result.stored).sort()).toEqual([0, 1, 1]);
    expect((await expectSessionTotalsToMatchSegments(sessionId)).event_count)
      .toBe(3);

    const [segment] = (await listAgentTranscriptSegments(
      db,
      projectId,
      sessionId,
    ))!;
    await db.prepare(
      `insert into briar_agent_transcript_segments (
         session_id, first_sequence, last_sequence, object_key, event_count,
         uncompressed_bytes, compressed_bytes, sha256, recorded_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict (session_id, first_sequence, last_sequence) do update set
         event_count = excluded.event_count,
         uncompressed_bytes = excluded.uncompressed_bytes`,
    ).bind(
      segment.session_id,
      segment.first_sequence,
      segment.last_sequence,
      segment.object_key,
      segment.event_count + 2,
      segment.uncompressed_bytes + 11,
      segment.compressed_bytes,
      segment.sha256,
      segment.recorded_at,
    ).run();
    const afterUpsert = await expectSessionTotalsToMatchSegments(sessionId);
    expect(afterUpsert.event_count).toBe(5);
    expect(afterUpsert.byte_count).toBe(afterInsert.byte_count * 3 + 11);

    expect(await ingestAgentTranscript(db, bucket, projectId, inputFor(2)))
      .toMatchObject({ stored: 0 });
    expect(await expectSessionTotalsToMatchSegments(sessionId))
      .toEqual(afterUpsert);

    await db.prepare(
      `update briar_agent_transcript_sessions
       set event_count = 0, byte_count = 0
       where session_id = ?`,
    ).bind(sessionId).run();
    await recalculateAgentTranscriptSessionTotals(db, sessionId);
    expect(await expectSessionTotalsToMatchSegments(sessionId))
      .toEqual(afterUpsert);
  });
});
