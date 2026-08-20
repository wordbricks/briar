import * as Option from "effect/Option";
import { describe, expect, it } from "vitest";
import {
  archiveFormatVersion,
  decodeArchivedIssueMessage,
  decodeArchivedProjectAgentSession,
  decodeArchiveLine,
  decodeArchiveManifest,
  decodeRelatedArchiveObjectKeysOption,
} from "./archive-contract";

const archiveId = "a".repeat(64);

describe("archive Effect contracts", () => {
  it("keeps persisted envelopes forward-compatible while stripping excess fields", () => {
    expect(decodeArchiveManifest({
      recordType: "manifest",
      formatVersion: archiveFormatVersion,
      archiveId,
      projectId: "project-1",
      runId: null,
      scopeId: "run-1",
      kind: "run_events",
      rowCount: 1,
      periodStart: "2026-01-01T00:00:00.000Z",
      periodEnd: "2026-01-01T00:01:00.000Z",
      createdAt: "2026-02-01T00:00:00.000Z",
      futureManifestField: true,
    })).not.toHaveProperty("futureManifestField");

    expect(decodeArchiveLine({
      recordType: "issue_message",
      data: { id: "message-1", nested: [1, true, null] },
      futureEnvelopeField: "ignored",
    })).toEqual({
      recordType: "issue_message",
      data: { id: "message-1", nested: [1, true, null] },
    });
  });

  it("decodes legacy issue messages with nullable Agent fields defaulted", () => {
    const decoded = decodeArchivedIssueMessage({
      id: "message-1",
      run_id: "run-1",
      parent_message_id: null,
      author_user_id: "user-1",
      author_agent_provider: null,
      author_name: "Ada",
      author_image: null,
      body: "Archived message",
      reply_count: 0,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      futureMessageField: { ignored: true },
    });

    expect(decoded).toMatchObject({
      author_agent_id: null,
      author_agent_name: null,
      author_agent_image: null,
    });
    expect(decoded).not.toHaveProperty("futureMessageField");
  });

  it("preserves non-strict archived rows without leaking unknown fields", () => {
    const decoded = decodeArchivedProjectAgentSession({
      project_id: "project-1",
      id: "session-1",
      agent_id: null,
      status: "completed",
      session_type: "task",
      payload_json: "{}",
      started_at: "2026-01-01T00:00:00.000Z",
      completed_at: "2026-01-01T00:01:00.000Z",
      updated_at: "2026-01-01T00:01:00.000Z",
      futureSessionField: "ignored",
    });

    expect(decoded).not.toHaveProperty("futureSessionField");
  });

  it("returns mutable related-object key arrays and ignores malformed metadata", () => {
    const decoded = decodeRelatedArchiveObjectKeysOption(["one"]);
    expect(Option.isSome(decoded)).toBe(true);
    if (Option.isSome(decoded)) {
      decoded.value.push("two");
      expect(decoded.value).toEqual(["one", "two"]);
    }

    expect(Option.isNone(decodeRelatedArchiveObjectKeysOption(["one", 2])))
      .toBe(true);
  });

  it("rejects non-positive or non-finite manifest row counts", () => {
    const manifest = {
      recordType: "manifest",
      formatVersion: archiveFormatVersion,
      archiveId,
      projectId: "project-1",
      runId: null,
      scopeId: "run-1",
      kind: "run_events",
      rowCount: 1,
      periodStart: "2026-01-01T00:00:00.000Z",
      periodEnd: "2026-01-01T00:01:00.000Z",
      createdAt: "2026-02-01T00:00:00.000Z",
    } as const;

    expect(() => decodeArchiveManifest({ ...manifest, rowCount: 0 }))
      .toThrow();
    expect(() => decodeArchiveManifest({ ...manifest, rowCount: Infinity }))
      .toThrow();
  });
});
