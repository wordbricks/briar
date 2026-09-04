import { describe, expect, it } from "vitest";

import { replyFailureDisposition } from "./reply-failure-disposition";
import type { ProviderBlock } from "../../src/lib/provider-block";

const block = (reason: ProviderBlock["reason"]): ProviderBlock => ({
  reason,
  provider: "claude",
  message: "blocked",
  nextRetryAt: null,
});

describe("replyFailureDisposition", () => {
  it("retries ordinary failures until the attempt budget is spent", () => {
    expect(replyFailureDisposition({ attempts: 1, block: null, anotherWorkerAvailable: false }))
      .toBe("requeued");
    expect(replyFailureDisposition({ attempts: 3, block: null, anotherWorkerAvailable: true }))
      .toBe("failed");
  });

  it("fails immediately when no Worker could satisfy the request", () => {
    expect(replyFailureDisposition({
      attempts: 1,
      block: block("context_window_exceeded"),
      anotherWorkerAvailable: true,
    })).toBe("failed");
    expect(replyFailureDisposition({
      attempts: 1,
      block: block("model_unavailable"),
      anotherWorkerAvailable: true,
    })).toBe("failed");
  });

  it("requeues an account block only when another Worker can take the job", () => {
    expect(replyFailureDisposition({
      attempts: 1,
      block: block("usage_exhausted"),
      anotherWorkerAvailable: true,
    })).toBe("requeued");
    expect(replyFailureDisposition({
      attempts: 1,
      block: block("usage_exhausted"),
      anotherWorkerAvailable: false,
    })).toBe("failed");
    expect(replyFailureDisposition({
      attempts: 3,
      block: block("auth_required"),
      anotherWorkerAvailable: true,
    })).toBe("failed");
  });
});
