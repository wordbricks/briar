import { describe, expect, it } from "vitest";

import {
  ProviderBlockedError,
  classifyProviderFailure,
  providerBlockFromError,
  providerBlockMessage,
  providerRetryAt,
  providerRetryAtFromText,
} from "./provider-block";

const now = () => Date.parse("2026-09-04T10:00:00.000Z");

describe("classifyProviderFailure", () => {
  it("prefers the provider's own error code over its text", () => {
    expect(classifyProviderFailure({
      provider: "claude",
      code: "rate_limit",
      message: "Something went wrong talking to the API",
    })).toMatchObject({ reason: "usage_exhausted", providerCode: "rate_limit" });
    expect(classifyProviderFailure({
      provider: "claude",
      code: "billing_error",
      message: "Rate limit",
    })).toMatchObject({ reason: "billing_required" });
    expect(classifyProviderFailure({
      provider: "claude",
      code: "authentication_failed",
    })).toMatchObject({ reason: "auth_required", message: "claude is not signed in." });
    expect(classifyProviderFailure({
      provider: "claude",
      code: "prompt_too_long",
    })).toMatchObject({ reason: "context_window_exceeded" });
    expect(classifyProviderFailure({
      provider: "claude",
      code: "model_not_found",
    })).toMatchObject({ reason: "model_unavailable" });
    expect(classifyProviderFailure({
      provider: "claude",
      code: "overloaded",
    })).toMatchObject({ reason: "upstream_overloaded" });
  });

  it("maps HTTP statuses when there is no code", () => {
    expect(classifyProviderFailure({ provider: "opencode", statusCode: 429, message: "Too Many Requests" }))
      .toMatchObject({ reason: "usage_exhausted", statusCode: 429 });
    expect(classifyProviderFailure({ provider: "opencode", statusCode: 401, message: "" }))
      .toMatchObject({ reason: "auth_required", statusCode: 401 });
    expect(classifyProviderFailure({ provider: "opencode", statusCode: 402, message: "Payment Required" }))
      .toMatchObject({ reason: "billing_required" });
    expect(classifyProviderFailure({ provider: "opencode", statusCode: 503, message: "" }))
      .toMatchObject({ reason: "upstream_overloaded", statusCode: 503 });
    expect(classifyProviderFailure({ provider: "opencode", statusCode: 529, message: "Overloaded" }))
      .toMatchObject({ reason: "upstream_overloaded" });
    // A 429 whose body says the credits are gone is a billing problem, not a
    // reset that time clears.
    expect(classifyProviderFailure({
      provider: "openrouter",
      statusCode: 429,
      message: "Insufficient credits. Add more credits and retry the request.",
    })).toMatchObject({ reason: "billing_required" });
    expect(classifyProviderFailure({ provider: "opencode", statusCode: 500, message: "Internal error" }))
      .toBeNull();
  });

  it("recognizes each provider's usage-limit text", () => {
    const usage = [
      "You've hit your usage limit for GPT-5. Try again at 3pm.",
      "usage_limit_reached",
      "Claude AI usage limit reached|1757000000",
      "RESOURCE_EXHAUSTED: Quota exceeded for quota metric 'Requests'",
      "429 Too Many Requests",
      "Rate limited; waiting for sampling capacity",
      "rate_limit_reached: slow down",
      "You have exceeded your current quota",
    ];
    for (const message of usage) {
      expect(classifyProviderFailure({ provider: "x", message })?.reason, message)
        .toBe("usage_exhausted");
    }
  });

  it("recognizes free tier, billing, auth, context, model and overload text", () => {
    expect(classifyProviderFailure({ provider: "opencode", message: "Free usage exceeded. Resets in 2 hours." }))
      .toMatchObject({ reason: "free_tier_limit" });
    expect(classifyProviderFailure({ provider: "codex", message: "usage_not_included: your plan does not include this model" }))
      .toMatchObject({ reason: "billing_required" });
    expect(classifyProviderFailure({ provider: "opencode", message: "insufficient_quota: You exceeded your current quota, please check your plan and billing details." }))
      .toMatchObject({ reason: "billing_required" });
    expect(classifyProviderFailure({ provider: "grok", message: "usage limit reached status 401 unauthorized" }))
      .toMatchObject({ reason: "auth_required" });
    expect(classifyProviderFailure({ provider: "cursor", message: "Not logged in. Run `cursor-agent login`." }))
      .toMatchObject({ reason: "auth_required" });
    expect(classifyProviderFailure({ provider: "claude", message: "Invalid API key · Please run /login" }))
      .toMatchObject({ reason: "auth_required" });
    expect(classifyProviderFailure({ provider: "claude", message: "Prompt is too long" }))
      .toMatchObject({ reason: "context_window_exceeded" });
    expect(classifyProviderFailure({ provider: "codex", message: "context window exceeded" }))
      .toMatchObject({ reason: "context_window_exceeded" });
    expect(classifyProviderFailure({ provider: "opencode", message: "This model's maximum context length is 200000 tokens." }))
      .toMatchObject({ reason: "context_window_exceeded" });
    expect(classifyProviderFailure({ provider: "claude", message: "model: claude-nope-5 not found" }))
      .toMatchObject({ reason: "model_unavailable" });
    expect(classifyProviderFailure({ provider: "cursor", message: "The selected model is not available on your plan" }))
      .toMatchObject({ reason: "model_unavailable" });
    expect(classifyProviderFailure({ provider: "agy", message: "[503] The request queue is full." }))
      .toMatchObject({ reason: "upstream_overloaded", statusCode: 503 });
    expect(classifyProviderFailure({ provider: "claude", message: "API Error: 529 overloaded_error" }))
      .toMatchObject({ reason: "upstream_overloaded" });
  });

  it("leaves ordinary failures alone", () => {
    for (const message of [
      "Command exited with code 1",
      "Codex turn did not complete: interrupted",
      "tests failed: expected 3 to be 4",
      "Model finished with 503 files changed",
      "",
    ]) {
      expect(classifyProviderFailure({ provider: "x", message }), message).toBeNull();
    }
  });

  it("carries the reset moment from structured fields or the text", () => {
    expect(classifyProviderFailure({
      provider: "claude",
      code: "rate_limit",
      retryAt: 1_757_000_000,
      now,
    })?.nextRetryAt).toBe("2025-09-04T15:33:20.000Z");
    expect(classifyProviderFailure({
      provider: "opencode",
      statusCode: 429,
      retryAfterSeconds: 90,
      now,
    })?.nextRetryAt).toBe("2026-09-04T10:01:30.000Z");
    expect(classifyProviderFailure({
      provider: "claude",
      message: "Claude AI usage limit reached|1757000000",
      now,
    })?.nextRetryAt).toBe("2025-09-04T15:33:20.000Z");
    expect(classifyProviderFailure({
      provider: "codex",
      message: "You've hit your usage limit. Try again in 2 hours.",
      now,
    })?.nextRetryAt).toBe("2026-09-04T12:00:00.000Z");
    // Auth and billing blocks are not cleared by waiting.
    expect(classifyProviderFailure({
      provider: "claude",
      code: "authentication_failed",
      retryAfterSeconds: 60,
      now,
    })?.nextRetryAt).toBeNull();
  });

  it("bounds and flattens the user-facing message", () => {
    const block = classifyProviderFailure({
      provider: "codex",
      message: `rate limit\n\n${"x".repeat(2_000)}`,
    });
    expect(block?.message.length).toBeLessThanOrEqual(600);
    expect(block?.message).not.toContain("\n");
  });
});

describe("providerBlockFromError", () => {
  it("reads status and code off error objects and unwraps blocked errors", () => {
    const block = { reason: "usage_exhausted" as const, provider: "agy", message: "quota", nextRetryAt: null };
    expect(providerBlockFromError("agy", new ProviderBlockedError(block))).toBe(block);
    expect(providerBlockFromError("opencode", { name: "APIError", status: 429, message: "slow down" }))
      .toMatchObject({ reason: "usage_exhausted", statusCode: 429 });
    expect(providerBlockFromError("claude", Object.assign(new Error("boom"), { code: "billing_error" })))
      .toMatchObject({ reason: "billing_required", providerCode: "billing_error" });
    expect(providerBlockFromError("claude", new Error("plain failure"))).toBeNull();
  });
});

describe("retry helpers", () => {
  it("parses epoch seconds, milliseconds, ISO strings and dates", () => {
    expect(providerRetryAt(1_757_000_000)).toBe("2025-09-04T15:33:20.000Z");
    expect(providerRetryAt(1_757_000_000_000)).toBe("2025-09-04T15:33:20.000Z");
    expect(providerRetryAt("1757000000")).toBe("2025-09-04T15:33:20.000Z");
    expect(providerRetryAt("2026-01-01T00:00:00Z")).toBe("2026-01-01T00:00:00.000Z");
    expect(providerRetryAt(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01-01T00:00:00.000Z");
    expect(providerRetryAt("not a date")).toBeNull();
    expect(providerRetryAt(null)).toBeNull();
  });

  it("finds reset moments inside provider text", () => {
    expect(providerRetryAtFromText("limit reached|1757000000")).toBe("2025-09-04T15:33:20.000Z");
    expect(providerRetryAtFromText("Resets at 2026-09-04T12:30:00Z")).toBe("2026-09-04T12:30:00.000Z");
    expect(providerRetryAtFromText("retry after 90 seconds", now)).toBe("2026-09-04T10:01:30.000Z");
    expect(providerRetryAtFromText("try again in 3 minutes", now)).toBe("2026-09-04T10:03:00.000Z");
    expect(providerRetryAtFromText("no timing here", now)).toBeNull();
  });

  it("flattens arbitrary error values", () => {
    expect(providerBlockMessage(new Error(" a\n b "))).toBe("a b");
    expect(providerBlockMessage({ message: "x" })).toBe('{"message":"x"}');
    expect(providerBlockMessage(undefined)).toBe("");
  });
});
