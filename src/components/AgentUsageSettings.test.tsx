/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import {
  loadAgentUsage,
  type AgentUsageSnapshot,
} from "../lib/agent-usage";
import type { AgentUsageReport, AgentUsageRun } from "../types";
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
    preferredModel: "configured-default",
    requestedProvider: null,
    requestedModel: null,
    executionProvider: provider,
    executionModel: model,
    executionMetrics: {
      totalTokens: 99_999,
      inputTokens: 99_999,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: provider === "claude" ? 50 : null,
      reasoningOutputTokens: 0,
      durationMs: 60_000,
    },
    usageRecords: [
      {
        executionId: `${id}-execution`,
        projectId: "project-1",
        runAttempt: 1,
        claimAttempt: 1,
        workerId: "worker-1",
        claimedAt: recentDate,
        recordedAt: recentDate,
        usageKey: `${id}-usage`,
        sessionId: `${id}-session`,
        scopeId: `${id}-turn`,
        turnId: `${id}-turn`,
        agentProvider: provider,
        modelProvider: provider === "codex" ? "openai" : "anthropic",
        model,
        canonicalModel: null,
        modelSource: "providerReported",
        source:
          provider === "codex"
            ? "codex.turnUsage"
            : "claude.assistant.usage",
        uncachedInputTokens: Math.round(totalTokens * 0.3),
        cacheReadTokens: Math.round(totalTokens * 0.5),
        cacheWriteTokens: 0,
        outputTokens: Math.round(totalTokens * 0.2),
        reasoningOutputTokens: Math.round(totalTokens * 0.05),
        totalTokens,
        observedAt: recentDate,
      },
    ],
    costRecords:
      provider === "claude"
        ? [
            {
              executionId: `${id}-execution`,
              projectId: "project-1",
              runAttempt: 1,
              claimAttempt: 1,
              workerId: "worker-1",
              claimedAt: recentDate,
              recordedAt: recentDate,
              costKey: `${id}-cost`,
              usageKey: `${id}-usage`,
              sessionId: `${id}-session`,
              scopeId: `${id}-turn`,
              turnId: `${id}-turn`,
              agentProvider: provider,
              modelProvider: "anthropic",
              model,
              canonicalModel: null,
              modelSource: "providerReported",
              source: "claude.result.modelUsage.costUSD",
              amountUsdTicks: 200_000_000,
              observedAt: recentDate,
              costSource: "providerReported",
            },
          ]
        : [],
    estimatedCostRecords:
      provider === "codex"
        ? [
            {
              executionId: `${id}-execution`,
              projectId: "project-1",
              runAttempt: 1,
              claimAttempt: 1,
              workerId: "worker-1",
              claimedAt: recentDate,
              usageKey: `${id}-usage`,
              sessionId: `${id}-session`,
              scopeId: `${id}-turn`,
              turnId: `${id}-turn`,
              agentProvider: provider,
              modelProvider: "openai",
              model,
              canonicalModel: null,
              modelSource: "providerReported",
              usageSource: "codex.turnUsage",
              pricingKey: model,
              amountUsdTicks: 300_000_000,
              observedAt: recentDate,
              costSource: "modelPriced",
            },
          ]
        : [],
  }) as AgentUsageRun;

const report = (runs: AgentUsageRun[]): AgentUsageReport => ({
  runs,
  generatedAt: recentDate,
  pricing: {
    status: "live",
    source:
      "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json",
    fetchedAt: recentDate,
    knownModels: 2_500,
  },
});

const provider = (
  id: AgentUsageSnapshot["claude"]["provider"],
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
  agy: provider("agy", 18),
  opencode: provider("opencode", 7),
  cursor: provider("cursor", 33),
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
    const onLoadUsageReport = vi.fn().mockResolvedValue(
      report([
        run("codex-run", "codex", "gpt-5.6-sol", 1_000),
        run("claude-run", "claude", "claude-sonnet-4-6", 500),
      ]),
    );

    await act(async () => {
      root.render(
        <I18nProvider>
          <AgentUsageSettings
            onManageAccounts={() => undefined}
            onLoadUsageReport={onLoadUsageReport}
            usageScopeKey="organization-1"
          />
        </I18nProvider>,
      );
    });

    expect(loadAgentUsage).toHaveBeenCalledOnce();
    expect(onLoadUsageReport).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Observed tokens");
    expect(container.textContent).toContain("1,500");
    expect(container.textContent).toContain("gpt-5.6-sol");
    expect(container.textContent).toContain("claude-sonnet-4-6");
    expect(container.textContent).toContain("Provider limits");
    expect(container.textContent).toContain("Antigravity");
    expect(container.textContent).toContain("OpenCode");
    expect(container.textContent).toContain("Cursor");
    expect(container.textContent).toContain("Total cost");
    expect(container.textContent).toContain("$0.05");
    expect(container.textContent).toContain("Provider reported");
    expect(container.textContent).toContain("Current prices loaded");
    expect(container.textContent).not.toContain("Provider default");

    const costButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Cost");
    await act(async () => costButton?.click());
    expect(costButton?.getAttribute("aria-pressed")).toBe("true");
    expect(
      container
        .querySelector<SVGElement>(".usage-overview-chart-svg")
        ?.getAttribute("aria-label"),
    ).toBe("Daily cost by provider");

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
    const initialLoader = vi.fn().mockResolvedValue(report([]));
    const replacementLoader = vi.fn().mockResolvedValue(report([]));

    await act(async () => {
      root.render(
        <I18nProvider>
          <AgentUsageSettings
            onManageAccounts={() => undefined}
            onLoadUsageReport={initialLoader}
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
            onLoadUsageReport={replacementLoader}
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
            onLoadUsageReport={replacementLoader}
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
            onLoadUsageReport={() => Promise.reject(new Error("usage unavailable"))}
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

  it("keeps provider-limit errors separate from organization usage", async () => {
    vi.mocked(loadAgentUsage).mockRejectedValueOnce(
      new Error("provider quota unavailable"),
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nProvider>
          <AgentUsageSettings
            onManageAccounts={() => undefined}
            onLoadUsageReport={() =>
              Promise.resolve(
                report([run("codex-run", "codex", "gpt-5.6-sol", 1_000)]),
              )
            }
            usageScopeKey="organization-1"
          />
        </I18nProvider>,
      );
    });

    expect(container.textContent).toContain("1,000");
    expect(container.textContent).toContain("provider quota unavailable");
    expect(container.textContent).not.toContain(
      "Organization usage could not be loaded.",
    );

    await act(async () => root.unmount());
    container.remove();
  });
});
