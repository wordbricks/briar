/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import {
  loadAgentUsage,
  type AgentUsageSnapshot,
} from "../lib/agent-usage";
import type { AgentUsageRun } from "../types";
import { AgentUsageSettings } from "./AgentUsageSettings";

vi.mock("../lib/agent-usage", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/agent-usage")>();
  return {
    ...original,
    loadAgentUsage: vi.fn(),
  };
});

const now = new Date();
const recentDate = new Date(
  now.getFullYear(),
  now.getMonth(),
  now.getDate(),
  12,
).toISOString();

const run = (
  id: string,
  provider: "codex" | "claude",
  model: string,
  totalTokens: number,
): AgentUsageRun =>
  ({
    id,
    projectId: "project-1",
    status: "completed",
    claimedBy: "worker",
    claimedAt: recentDate,
    claimAttempts: 1,
    workerId: "worker-1",
    startedAt: recentDate,
    updatedAt: recentDate,
    completedAt: recentDate,
    preferredProvider: provider,
    preferredModel: model,
    requestedProvider: null,
    requestedModel: null,
    executionProvider: provider,
    executionModel: model,
    executionMetrics: {
      totalTokens,
      inputTokens: Math.round(totalTokens * 0.8),
      outputTokens: Math.round(totalTokens * 0.2),
      cacheReadTokens: Math.round(totalTokens * 0.5),
      cacheWriteTokens: provider === "claude" ? 50 : null,
      reasoningOutputTokens: 25,
      durationMs: 60_000,
    },
  }) as AgentUsageRun;

const provider = (
  id: "claude" | "codex" | "grok",
  usedPercent: number,
) => ({
  provider: id,
  status: "ok" as const,
  session: {
    usedPercent,
    windowMinutes: 300,
    resetsAt: Date.now() + 60 * 60 * 1_000,
  },
  weekly: null,
  monthly: null,
  planType: "plus",
  accountLabel: null,
  authenticated: true,
  updatedAt: Date.now(),
  error: null,
});

const snapshot: AgentUsageSnapshot = {
  claude: provider("claude", 45),
  codex: provider("codex", 30),
  grok: provider("grok", 10),
  updatedAt: Date.now(),
};

describe("AgentUsageSettings", () => {
  beforeEach(() => {
    vi.mocked(loadAgentUsage).mockReset();
    vi.mocked(loadAgentUsage).mockResolvedValue(snapshot);
    window.localStorage.clear();
    window.localStorage.setItem("briar.locale.v1", "en");
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("renders recorded token usage and switches chart and breakdown modes", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onLoadUsageRuns = vi.fn().mockResolvedValue([
      run("codex-run", "codex", "gpt-5.6-sol", 1_000),
      run("claude-run", "claude", "opus", 500),
    ]);

    await act(async () => {
      root.render(
        <I18nProvider>
          <AgentUsageSettings
            onManageAccounts={() => undefined}
            onLoadUsageRuns={onLoadUsageRuns}
            usageScopeKey="organization-1"
          />
        </I18nProvider>,
      );
    });

    expect(loadAgentUsage).toHaveBeenCalledOnce();
    expect(onLoadUsageRuns).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Observed tokens");
    expect(container.textContent).toContain("1,500");
    expect(container.textContent).toContain("gpt-5.6-sol");
    expect(container.textContent).toContain("opus");
    expect(container.textContent).toContain("Provider limits");
    expect(container.textContent).toContain("Not priced");

    const runsButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Runs");
    await act(async () => runsButton?.click());
    expect(runsButton?.getAttribute("aria-pressed")).toBe("true");
    expect(
      container
        .querySelector<SVGElement>(".usage-overview-chart-svg")
        ?.getAttribute("aria-label"),
    ).toBe("Daily run count by provider");
    expect(
      Array.from(
        container.querySelectorAll(".usage-overview-chart-axis:not(.date)"),
        (tick) => tick.textContent,
      ),
    ).toEqual(["0", "1"]);

    const dayButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Day");
    await act(async () => dayButton?.click());
    expect(dayButton?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector("tbody time")).not.toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it("does not reload usage when the loader identity changes", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const initialLoader = vi.fn().mockResolvedValue([]);
    const replacementLoader = vi.fn().mockResolvedValue([]);

    await act(async () => {
      root.render(
        <I18nProvider>
          <AgentUsageSettings
            onManageAccounts={() => undefined}
            onLoadUsageRuns={initialLoader}
            usageScopeKey="organization-1"
          />
        </I18nProvider>,
      );
    });

    await act(async () => {
      root.render(
        <I18nProvider>
          <AgentUsageSettings
            onManageAccounts={() => undefined}
            onLoadUsageRuns={replacementLoader}
            usageScopeKey="organization-1"
          />
        </I18nProvider>,
      );
    });

    expect(initialLoader).toHaveBeenCalledOnce();
    expect(replacementLoader).not.toHaveBeenCalled();

    await act(async () => {
      root.render(
        <I18nProvider>
          <AgentUsageSettings
            onManageAccounts={() => undefined}
            onLoadUsageRuns={replacementLoader}
            usageScopeKey="organization-2"
          />
        </I18nProvider>,
      );
    });

    expect(replacementLoader).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    container.remove();
  });

  it("does not present a failed organization request as zero usage", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nProvider>
          <AgentUsageSettings
            onManageAccounts={() => undefined}
            onLoadUsageRuns={() => Promise.reject(new Error("usage unavailable"))}
            usageScopeKey="organization-1"
          />
        </I18nProvider>,
      );
    });

    expect(container.textContent).toContain(
      "Organization usage could not be loaded.",
    );
    expect(container.textContent).toContain("usage unavailable");
    expect(container.textContent).not.toContain("Loading organization usage");
    expect(container.textContent).not.toContain("0 of 0 runs");
    expect(container.textContent).not.toContain(
      "No token usage was recorded in this period.",
    );
    expect(
      container.querySelector(".usage-overview-summary > strong")?.textContent,
    ).toBe("—");
    expect(
      Array.from(
        container.querySelectorAll(".usage-overview-chart-axis:not(.date)"),
        (tick) => tick.textContent,
      ),
    ).toEqual(["0"]);

    await act(async () => root.unmount());
    container.remove();
  });
});
