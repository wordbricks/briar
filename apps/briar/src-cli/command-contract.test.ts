import { describe, expect, it } from "vitest";
import {
  decodeRunEvidenceInput,
  httpErrorMessage,
  validateReworkRunInput,
} from "./command-contract";

const requestId = "11111111-1111-4111-8111-111111111111";

describe("CLI command contracts", () => {
  it("validates transformed fields without changing payloads whose parse result is discarded", () => {
    const input = {
      requestId,
      actor: "briar-workflow",
      workflowStage: "implementing",
      reason: "  keep the original wire value  ",
    };

    expect(validateReworkRunInput(input)).toBeUndefined();
    expect(input.reason).toBe("  keep the original wire value  ");
  });

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
