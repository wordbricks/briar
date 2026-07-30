/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import {
  clearAgentUsageHistory,
  formatUsageDuration,
  formatUsageWindowLabel,
  readAgentUsageHistory,
  recordAgentUsageSnapshot,
  tightestUsageWindow,
  type AgentUsageProvider,
} from "./agent-usage";

const provider: AgentUsageProvider = {
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
  updatedAt: 1,
  error: null,
};

describe("agent usage presentation", () => {
  it("selects the most consumed window for the thin status bar", () => {
    expect(tightestUsageWindow(provider)).toEqual(provider.weekly);
  });

  it("formats compact reset durations", () => {
    expect(formatUsageDuration(4 * 86_400_000 + 19 * 3_600_000)).toBe("4d 19h");
    expect(formatUsageDuration(31 * 60_000)).toBe("31m");
  });

  it("labels standard usage windows", () => {
    expect(formatUsageWindowLabel(provider.session!)).toBe("5h");
    expect(formatUsageWindowLabel(provider.weekly!)).toBe("wk");
    expect(
      formatUsageWindowLabel({
        usedPercent: 1,
        windowMinutes: 43_200,
        resetsAt: null,
      }),
    ).toBe("30d");
  });

  it("persists one usage snapshot per minute", () => {
    clearAgentUsageHistory();
    const snapshot = {
      updatedAt: 61_000,
      claude: { ...provider, provider: "claude" as const },
      codex: provider,
      grok: { ...provider, provider: "grok" as const },
    };
    recordAgentUsageSnapshot(snapshot);
    recordAgentUsageSnapshot({ ...snapshot, updatedAt: 62_000 });

    expect(readAgentUsageHistory()).toHaveLength(1);
    expect(readAgentUsageHistory()[0]?.updatedAt).toBe(62_000);
    clearAgentUsageHistory();
  });
});
