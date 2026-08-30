import { describe, expect, it } from "vitest";
import {
  decodeRunEvidenceInput,
  httpErrorMessage,
} from "./command-contract";

describe("CLI command contracts", () => {
  it("uses decoded values when a command consumes the parse result", () => {
    const evidence = decodeRunEvidenceInput({
      evidenceKey: "test:1",
      stage: "local_qa",
      type: "  test  ",
      status: "passed",
      observedAt: "2026-08-20T08:00:00+00:00",
      actor: "briar-workflow",
      detail: null,
      command: "bun test",
      url: null,
      metadata: { durationMs: 100 },
    });

    expect(evidence.type).toBe("test");
    evidence.metadata = { ...evidence.metadata, retried: false };
    expect(evidence.metadata).toEqual({ durationMs: 100, retried: false });
  });

  it("reads supported HTTP error envelopes without trusting arbitrary bodies", () => {
    expect(httpErrorMessage({ message: "Conflict", requestId: "request-1" }))
      .toBe("Conflict");
    expect(httpErrorMessage({ message: 409 })).toBeUndefined();
    expect(httpErrorMessage(null)).toBeUndefined();
  });
});
