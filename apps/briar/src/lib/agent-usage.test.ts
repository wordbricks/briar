/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearAgentUsageHistory,
  compressedHistoryStorageKey,
  isProviderUsageExhausted,
  readAgentUsageHistory,
  recordAgentUsageSnapshot,
  tightestUsageWindow,
} from "./agent-usage";
import type { ProviderUsage } from "../generated/tauri";

const provider: ProviderUsage = {
  provider: "codex",
  status: "ok",
  session: {
    usedPercent: 34,
    windowMinutes: 300,
    resetsAt: null,
  },
  weekly: {
    usedPercent: 82,
    windowMinutes: 10_080,
    resetsAt: null,
  },
  monthly: null,
  planType: "plus",
  accountLabel: null,
  authenticated: true,
  reauthenticationRequired: false,
  updatedAt: 1,
  error: null,
};

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("agent usage presentation", () => {
  it("selects the most consumed window for the thin status bar", () => {
    expect(tightestUsageWindow(provider)).toEqual(provider.weekly);
  });

  it("treats only fully consumed ok usage as exhausted", () => {
    expect(isProviderUsageExhausted(provider)).toBe(false);
    expect(
      isProviderUsageExhausted({
        ...provider,
        weekly: { ...provider.weekly!, usedPercent: 100 },
      }),
    ).toBe(true);
    expect(
      isProviderUsageExhausted({
        ...provider,
        session: { ...provider.session!, usedPercent: 100 },
        weekly: { ...provider.weekly!, usedPercent: 40 },
      }),
    ).toBe(true);
    expect(
      isProviderUsageExhausted({
        ...provider,
        status: "error",
        weekly: { ...provider.weekly!, usedPercent: 100 },
      }),
    ).toBe(false);
    expect(
      isProviderUsageExhausted({
        ...provider,
        session: null,
        weekly: null,
        monthly: null,
      }),
    ).toBe(false);
  });

  it("persists one usage snapshot per minute", () => {
    clearAgentUsageHistory();
    const snapshot = {
      updatedAt: 61_000,
      claude: { ...provider, provider: "claude" as const },
      codex: provider,
      grok: { ...provider, provider: "grok" as const },
      agy: { ...provider, provider: "agy" as const },
      opencode: { ...provider, provider: "opencode" as const },
      openrouter: { ...provider, provider: "openrouter" as const },
      vertex: { ...provider, provider: "vertex" as const },
      pi: { ...provider, provider: "pi" as const },
      cursor: { ...provider, provider: "cursor" as const },
    };
    recordAgentUsageSnapshot(snapshot);
    recordAgentUsageSnapshot({ ...snapshot, updatedAt: 62_000 });

    expect(readAgentUsageHistory()).toHaveLength(1);
    expect(readAgentUsageHistory()[0]?.updatedAt).toBe(62_000);
    clearAgentUsageHistory();
  });

  it("migrates the legacy aggregate and removes it", () => {
    const snapshot = {
      updatedAt: 61_000,
      claude: { ...provider, provider: "claude" as const },
      codex: provider,
      grok: { ...provider, provider: "grok" as const },
      agy: { ...provider, provider: "agy" as const },
      opencode: { ...provider, provider: "opencode" as const },
      openrouter: { ...provider, provider: "openrouter" as const },
      vertex: { ...provider, provider: "vertex" as const },
      pi: { ...provider, provider: "pi" as const },
      cursor: { ...provider, provider: "cursor" as const },
    };
    localStorage.setItem(
      "briar.agent-usage.history.v1",
      JSON.stringify([snapshot]),
    );

    recordAgentUsageSnapshot({ ...snapshot, updatedAt: 121_000 });

    expect(localStorage.getItem("briar.agent-usage.history.v1")).toBeNull();
    expect(readAgentUsageHistory().map((item) => item.updatedAt)).toEqual([
      121_000,
      61_000,
    ]);
  });

  it("stores a full history in one compact value", () => {
    const snapshot = {
      updatedAt: 61_000,
      claude: { ...provider, provider: "claude" as const },
      codex: provider,
      grok: { ...provider, provider: "grok" as const },
      agy: { ...provider, provider: "agy" as const },
      opencode: { ...provider, provider: "opencode" as const },
      openrouter: { ...provider, provider: "openrouter" as const },
      vertex: { ...provider, provider: "vertex" as const },
      pi: { ...provider, provider: "pi" as const },
      cursor: { ...provider, provider: "cursor" as const },
    };
    for (let minute = 1; minute <= 96; minute += 1) {
      recordAgentUsageSnapshot({ ...snapshot, updatedAt: minute * 60_000 });
    }
    const legacyBytes = JSON.stringify(readAgentUsageHistory()).length * 2;
    const before = localStorage.getItem(compressedHistoryStorageKey);

    recordAgentUsageSnapshot({ ...snapshot, updatedAt: 96 * 60_000 + 1 });

    const compressed = localStorage.getItem(compressedHistoryStorageKey);
    expect(compressed).not.toBe(before);
    expect(localStorage).toHaveLength(1);
    expect(localStorage.getItem("briar.agent-usage.history.v1")).toBeNull();
    expect(compressed!.length * 2).toBeLessThan(legacyBytes / 15);
    expect(readAgentUsageHistory()).toHaveLength(96);
  });
});
