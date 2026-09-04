import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_PROVIDER_BLOCK_HOLD_MS,
  MACHINE_PROVIDER_BLOCK_HOLD_MS,
  MAX_PROVIDER_BLOCK_HOLD_MS,
  activeProviderBlock,
  clearProviderBlocks,
  recordProviderBlock,
} from "./provider-block-registry";

const start = Date.parse("2026-09-04T10:00:00.000Z");

describe("provider block registry", () => {
  afterEach(() => clearProviderBlocks());

  it("holds an exhausted provider until the announced reset", () => {
    const entry = recordProviderBlock("claude", {
      reason: "usage_exhausted",
      provider: "claude",
      message: "limit",
      nextRetryAt: "2026-09-04T12:00:00.000Z",
    }, () => start);
    expect(entry?.until).toBe("2026-09-04T12:00:00.000Z");
    expect(activeProviderBlock("claude", () => start + 60_000)?.block.reason)
      .toBe("usage_exhausted");
    expect(activeProviderBlock("claude", () => Date.parse("2026-09-04T12:00:00.000Z")))
      .toBeNull();
    expect(activeProviderBlock("codex", () => start)).toBeNull();
  });

  it("applies default holds when the provider gave no reset", () => {
    expect(recordProviderBlock("codex", {
      reason: "usage_exhausted",
      provider: "codex",
      message: "limit",
      nextRetryAt: null,
    }, () => start)?.until).toBe(
      new Date(start + DEFAULT_PROVIDER_BLOCK_HOLD_MS).toISOString(),
    );
    expect(recordProviderBlock("grok", {
      reason: "auth_required",
      provider: "grok",
      message: "signed out",
      nextRetryAt: null,
    }, () => start)?.until).toBe(
      new Date(start + MACHINE_PROVIDER_BLOCK_HOLD_MS).toISOString(),
    );
    expect(recordProviderBlock("agy", {
      reason: "free_tier_limit",
      provider: "agy",
      message: "limit",
      nextRetryAt: "2026-09-10T10:00:00.000Z",
    }, () => start)?.until).toBe(
      new Date(start + MAX_PROVIDER_BLOCK_HOLD_MS).toISOString(),
    );
  });

  it("ignores blocks that do not concern this machine's provider account", () => {
    for (const reason of [
      "upstream_overloaded",
      "context_window_exceeded",
      "model_unavailable",
      "mcp_auth_required",
    ] as const) {
      expect(recordProviderBlock("opencode", {
        reason,
        provider: "opencode",
        message: "x",
        nextRetryAt: null,
      }, () => start)).toBeNull();
    }
    expect(activeProviderBlock("opencode", () => start)).toBeNull();
  });
});
