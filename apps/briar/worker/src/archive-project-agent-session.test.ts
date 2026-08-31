import { describe, expect, it } from "vitest";
import {
  type ArchiveBucket,
  type ArchiveMetadataRow,
  readArchivedProjectAgentSession,
} from "./archive";
import { archiveFormatVersion } from "./archive-contract";

const encoder = new TextEncoder();
const archiveId = "a".repeat(64);
const projectId = "project-1";
const sessionId = "session-1";

const bytesToHex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

const sha256 = async (bytes: ArrayBuffer | Uint8Array) =>
  bytesToHex(
    await crypto.subtle.digest(
      "SHA-256",
      bytes instanceof Uint8Array ? bytes.slice().buffer : bytes,
    ),
  );

const gzip = (content: string) =>
  new Response(
    new Blob([content]).stream().pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer();

const sessionRecord = (overrides: Record<string, unknown> = {}) => ({
  recordType: "project_agent_session",
  data: {
    project_id: projectId,
    id: sessionId,
    agent_id: "agent-1",
    requested_by_user_id: null,
    status: "completed",
    session_type: "task",
    payload_json: '{"summary":"done"}',
    started_at: "2026-01-01T00:00:00.000Z",
    completed_at: "2026-01-01T00:01:00.000Z",
    updated_at: "2026-01-01T00:01:00.000Z",
    ...overrides,
  },
});

const fixture = async (
  records: unknown[] = [sessionRecord()],
  status: ArchiveMetadataRow["status"] = "complete",
) => {
  const manifest = {
    recordType: "manifest",
    formatVersion: archiveFormatVersion,
    archiveId,
    projectId,
    runId: null,
    scopeId: sessionId,
    kind: "project_agent_sessions",
    rowCount: records.length,
    periodStart: "2026-01-01T00:00:00.000Z",
    periodEnd: "2026-01-01T00:01:00.000Z",
    createdAt: "2026-02-01T00:00:00.000Z",
  };
  const content = [
    JSON.stringify(manifest),
    ...records.map((record) => JSON.stringify(record)),
    "",
  ].join("\n");
  const compressed = await gzip(content);
  const contentSha256 = await sha256(encoder.encode(content));
  const objectSha256 = await sha256(compressed);
  const metadata: ArchiveMetadataRow = {
    id: archiveId,
    project_id: projectId,
    run_id: null,
    scope_id: sessionId,
    archive_kind: "project_agent_sessions",
    object_key: `archives/${archiveId}.jsonl.gz`,
    format_version: archiveFormatVersion,
    status,
    row_count: records.length,
    byte_size: compressed.byteLength,
    sha256: objectSha256,
    content_sha256: contentSha256,
    period_start: manifest.periodStart,
    period_end: manifest.periodEnd,
    created_at: manifest.createdAt,
    verified_at: manifest.createdAt,
    completed_at: status === "complete" ? manifest.createdAt : null,
    expires_at: "2027-01-01T00:00:00.000Z",
    failure_count: 0,
    last_error: null,
    related_object_keys_json: "[]",
  };
  const bucket: ArchiveBucket = {
    async head(key) {
      if (key !== metadata.object_key) return null;
      return {
        size: compressed.byteLength,
        checksums: {},
        customMetadata: {
          sha256: objectSha256,
          contentSha256,
        },
      };
    },
    async get(key) {
      if (key !== metadata.object_key) return null;
      return {
        size: compressed.byteLength,
        checksums: {},
        customMetadata: {
          sha256: objectSha256,
          contentSha256,
        },
        body: new Blob([compressed]).stream(),
      };
    },
    async put() {},
    async delete() {},
  };
  return { bucket, metadata };
};

describe("readArchivedProjectAgentSession", () => {
  it.each(["verified", "complete"] as const)(
    "returns the single scoped session from a %s archive",
    async (status) => {
      const { bucket, metadata } = await fixture(undefined, status);

      await expect(
        readArchivedProjectAgentSession(bucket, metadata),
      ).resolves.toMatchObject({
        project_id: projectId,
        id: sessionId,
        status: "completed",
      });
    },
  );

  it("rejects the wrong archive kind and unreadable status before reading R2", async () => {
    const { bucket, metadata } = await fixture();
    const unreadableBucket: ArchiveBucket = {
      ...bucket,
      async head() {
        throw new Error("R2 must not be read");
      },
    };

    await expect(
      readArchivedProjectAgentSession(unreadableBucket, {
        ...metadata,
        archive_kind: "run_events",
      }),
    ).rejects.toThrow("not a project agent session");
    await expect(
      readArchivedProjectAgentSession(unreadableBucket, {
        ...metadata,
        status: "failed",
      }),
    ).rejects.toThrow("is not readable");
  });

  it("rejects archives with a non-session record or any extra record", async () => {
    const wrongRecord = await fixture([
      { recordType: "execution_audit", data: {} },
    ]);
    await expect(
      readArchivedProjectAgentSession(
        wrongRecord.bucket,
        wrongRecord.metadata,
      ),
    ).rejects.toThrow("must contain exactly one session");

    const extraRecord = await fixture([
      sessionRecord(),
      sessionRecord({ id: "session-2" }),
    ]);
    await expect(
      readArchivedProjectAgentSession(
        extraRecord.bucket,
        extraRecord.metadata,
      ),
    ).rejects.toThrow("must contain exactly one session");

    const singleRecord = await fixture();
    await expect(
      readArchivedProjectAgentSession(singleRecord.bucket, {
        ...singleRecord.metadata,
        row_count: 2,
      }),
    ).rejects.toThrow("Archive manifest does not match D1 metadata");
  });

  it.each([
    { project_id: "other-project" },
    { id: "other-session" },
  ])("rejects a session outside the metadata scope", async (overrides) => {
    const { bucket, metadata } = await fixture([sessionRecord(overrides)]);

    await expect(
      readArchivedProjectAgentSession(bucket, metadata),
    ).rejects.toThrow("scope does not match metadata");
  });

  it("rejects an R2 object that fails checksum validation", async () => {
    const { bucket, metadata } = await fixture();

    await expect(
      readArchivedProjectAgentSession(bucket, {
        ...metadata,
        content_sha256: "0".repeat(64),
      }),
    ).rejects.toThrow("R2 checksum verification failed");
  });
});
