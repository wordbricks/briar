import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearProviderBlocks,
  recordProviderBlock,
} from "./provider-block-registry";
import {
  inspectWorkerProviderHealth,
  providerHealthReadinessDetail,
  workerProviderIds,
  type WorkerProvider,
} from "./provider-health";

const enabled = Object.fromEntries(
  workerProviderIds.map((provider) => [provider, provider === "claude" || provider === "codex"]),
) as Record<WorkerProvider, boolean>;

const now = Date.parse("2026-09-04T10:00:00.000Z");

describe("provider health with runtime blocks", () => {
  afterEach(() => clearProviderBlocks());

  it("reports a provider a runner just saw exhausted as unhealthy without probing", async () => {
    recordProviderBlock("claude", {
      reason: "usage_exhausted",
      provider: "claude",
      message: "limit",
      nextRetryAt: "2026-09-04T12:00:00.000Z",
    }, () => now);
    const usage = vi.fn(async (provider: WorkerProvider) => {
      void provider;
      return { exhausted: false, maxUsedPercent: 10, error: null };
    });
    const health = await inspectWorkerProviderHealth(enabled, {
      now: () => now,
      which: (provider) => `/bin/${provider}`,
      authenticated: async () => true,
      usage,
    });
    expect(health.claude).toEqual({
      installed: true,
      authenticated: true,
      healthy: false,
      reason: "usage_exhausted",
      usageExhausted: true,
      maxUsedPercent: 100,
    });
    expect(health.codex.healthy).toBe(true);
    expect(usage).toHaveBeenCalledTimes(1);
    expect(usage.mock.calls[0]?.[0]).toBe("codex");
  });

  it("lets the block expire and maps auth and billing blocks to their reasons", async () => {
    recordProviderBlock("claude", {
      reason: "auth_required",
      provider: "claude",
      message: "signed out",
      nextRetryAt: null,
    }, () => now);
    recordProviderBlock("codex", {
      reason: "billing_required",
      provider: "codex",
      message: "no credits",
      nextRetryAt: null,
    }, () => now);
    const deps = {
      which: (provider: WorkerProvider) => `/bin/${provider}`,
      authenticated: async () => true,
      usage: async () => ({ exhausted: false, maxUsedPercent: 0, error: null }),
    };
    const blocked = await inspectWorkerProviderHealth(enabled, { ...deps, now: () => now });
    expect(blocked.claude).toMatchObject({ authenticated: false, reason: "not_authenticated" });
    expect(blocked.codex).toMatchObject({ healthy: false, reason: "billing_required" });
    expect(providerHealthReadinessDetail(blocked)).toBe(
      "결제 또는 크레딧 문제로 실행할 수 있는 coding agent가 없습니다.",
    );

    const later = await inspectWorkerProviderHealth(enabled, {
      ...deps,
      now: () => now + 11 * 60_000,
    });
    expect(later.claude.healthy).toBe(true);
    expect(later.codex.healthy).toBe(true);
  });
});
