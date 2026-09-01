import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  archiveFormatVersion,
  decodeArchiveManifest,
} from "./archive-contract";

const archiveId = "a".repeat(64);

describe("archive Effect contracts", () => {
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

  it("keeps corrupt persisted data out of the HTTP request error channel", () => {
    try {
      decodeArchiveManifest({ recordType: "manifest" });
      throw new Error("Expected archive manifest decoding to fail");
    } catch (error) {
      expect(Schema.isSchemaError(error)).toBe(true);
    }
  });
});
