import { describe, expect, it } from "vitest";

import { agyBlockedRetry } from "./agy-runner-lib";

describe("Antigravity block classification", () => {
  it("covers auth, billing and context failures beyond quota and overload", () => {
    expect(agyBlockedRetry({
      event: "error",
      error: { code: "UNAUTHENTICATED", message: "Request had invalid authentication credentials." },
    })).toMatchObject({ reason: "auth_required", provider: "agy" });
    expect(agyBlockedRetry("[429] RESOURCE_EXHAUSTED: Quota exceeded for quota metric"))
      .toMatchObject({ reason: "usage_exhausted", statusCode: 429 });
    expect(agyBlockedRetry({
      event: "error",
      error: { message: "The input token count exceeds the maximum context length." },
    })).toMatchObject({ reason: "context_window_exceeded" });
    expect(agyBlockedRetry({
      event: "error",
      error: { statusCode: 402, message: "Billing account required" },
    })).toMatchObject({ reason: "billing_required", statusCode: 402 });
    expect(agyBlockedRetry({ event: "error", error: { message: "Tool crashed" } })).toBeNull();
    expect(agyBlockedRetry("plain stderr line about quotaProject")).toBeNull();
  });
});
