/** @vitest-environment jsdom */

import { act } from "react";
import { createReactTestRoot } from "../test/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import type { AgentUsageSnapshot } from "../lib/agent-usage";
import { defaultAppProviderSettings } from "../lib/project-llm";
import { AgentUsageStatusBar } from "./AgentUsageStatusBar";

const snapshot: AgentUsageSnapshot = {
  updatedAt: 1,
  claude: {
    provider: "claude",
    status: "ok",
    session: {
      usedPercent: 12,
      windowMinutes: 300,
      resetsAt: Date.now() + 4 * 3_600_000,
    },
    weekly: {
      usedPercent: 48,
      windowMinutes: 10_080,
      resetsAt: Date.now() + 3 * 86_400_000,
    },
    monthly: null,
    planType: null,
    updatedAt: 1,
    error: null,
  },
  codex: {
    provider: "codex",
    status: "ok",
    session: {
      usedPercent: 93,
      windowMinutes: 300,
      resetsAt: Date.now() + 4 * 86_400_000,
    },
    weekly: {
      usedPercent: 8,
      windowMinutes: 10_080,
      resetsAt: Date.now() + 6 * 86_400_000,
    },
    monthly: null,
    planType: "plus",
    updatedAt: 1,
    error: null,
  },
  grok: {
    provider: "grok",
    status: "ok",
    session: null,
    weekly: {
      usedPercent: 5,
      windowMinutes: 10_080,
      resetsAt: Date.now() + 2 * 86_400_000,
    },
    monthly: null,
    planType: "SuperGrok",
    updatedAt: 1,
    error: null,
  },
  agy: {
    provider: "agy",
    status: "ok",
    session: {
      usedPercent: 22,
      windowMinutes: 60,
      resetsAt: Date.now() + 40 * 60_000,
    },
    weekly: null,
    monthly: null,
    planType: null,
    updatedAt: 1,
    error: null,
  },
  opencode: {
    provider: "opencode",
    status: "unavailable",
    session: null,
    weekly: null,
    monthly: null,
    planType: null,
    updatedAt: 1,
    error: null,
  },
  openrouter: {
    provider: "openrouter",
    status: "unavailable",
    session: null,
    weekly: null,
    monthly: null,
    planType: null,
    updatedAt: 1,
    error: null,
  },
  cursor: {
    provider: "cursor",
    status: "ok",
    session: null,
    weekly: null,
    monthly: {
      usedPercent: 41,
      windowMinutes: 43_200,
      resetsAt: Date.now() + 12 * 86_400_000,
    },
    planType: "Pro",
    updatedAt: 1,
    error: null,
  },
};

describe("AgentUsageStatusBar", () => {
  it("shows compact provider usage and opens the detailed roster", async () => {
    localStorage.setItem("briar.locale.v1", "en");
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    const loadUsage = vi.fn().mockResolvedValue(snapshot);
    const onManageAccounts = vi.fn();
    const onOpenUsageDetails = vi.fn();

    await act(async () => {
      root.render(
        <I18nProvider>
          <AgentUsageStatusBar
            loadUsage={loadUsage}
            onManageAccounts={onManageAccounts}
            onOpenUsageDetails={onOpenUsageDetails}
          />
        </I18nProvider>,
      );
      await Promise.resolve();
    });

    expect(loadUsage).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("48%");
    expect(container.textContent).toContain("93%");
    expect(container.textContent).toContain("5%");
    expect(container.textContent).toContain("22%");
    expect(container.textContent).toContain("41%");
    const trigger = container.querySelector<HTMLButtonElement>(
      ".agent-usage-status-trigger",
    );
    await act(async () => trigger?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
      "Usage",
    );
    expect(container.textContent).toContain("Usage details & history");
    expect(container.textContent).toContain("Grok");
    expect(container.textContent).toContain("Antigravity");
    expect(container.textContent).toContain("OpenCode");
    expect(container.textContent).toContain("Cursor");

    const details = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Usage details & history"),
    );
    await act(async () => details?.click());
    expect(onOpenUsageDetails).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => trigger?.click());
    const manage = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Manage Accounts"),
    );
    await act(async () => manage?.click());
    expect(onManageAccounts).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    await cleanup();
    localStorage.removeItem("briar.locale.v1");
    localStorage.removeItem("briar.agent-usage.history.v1");
  });

});
