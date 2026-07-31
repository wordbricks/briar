/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import type { ExecutionWorker } from "../types";
import {
  activeWorkerCount,
  WorkerStatusBar,
  workerProviders,
} from "./WorkerStatusBar";

const worker = (overrides: Partial<ExecutionWorker> = {}): ExecutionWorker => ({
  id: "worker-1",
  deviceId: "device-1",
  ownerUserId: "owner-1",
  label: "Janet's Mac",
  agentProvider: "codex",
  providers: ["codex", "claude", "codex"],
  versions: {},
  state: "online",
  readiness: "available",
  acceptingWork: true,
  readinessDetail: null,
  capabilities: {},
  maxConcurrentSessions: 1,
  activeSessions: 0,
  availableSessions: 1,
  lastHeartbeatAt: "2026-07-29T00:00:00Z",
  createdAt: "2026-07-29T00:00:00Z",
  ...overrides,
});

describe("WorkerStatusBar", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.setItem("briar.locale.v1", "ko");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
  });

  it("shows a compact computer trigger with the active worker count", () => {
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <WorkerStatusBar
          onOpenSettings={() => undefined}
          workers={[
            worker(),
            worker({
              id: "worker-2",
              state: "stale",
              readiness: "offline",
            }),
          ]}
        />
      </I18nProvider>,
    );

    expect(markup).toContain("worker-status-trigger");
    expect(markup).toContain('aria-label="활성 Worker 1대"');
    expect(markup).toContain("<strong>1</strong>");
    expect(markup).not.toContain("worker-status-popover");
  });

  it("opens a list with readiness, name, and every supported provider icon", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nProvider>
          <WorkerStatusBar
            onOpenSettings={() => undefined}
            workers={[
              worker({ icon: { type: "emoji", value: "🍋" } }),
            ]}
          />
        </I18nProvider>,
      );
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".worker-status-trigger")
        ?.click();
    });

    expect(container.innerHTML).toContain("worker-status-dot available");
    expect(container.innerHTML).toContain("Janet's Mac");
    expect(container.querySelector(".worker-icon")?.textContent).toBe("🍋");
    expect(container.innerHTML).toContain("사용 가능");
    expect(container.innerHTML).toContain('aria-label="Codex"');
    expect(container.innerHTML).toContain('aria-label="Claude"');
    expect(container.innerHTML.match(/title="Codex"/g)).toHaveLength(1);
    expect(container.innerHTML.match(/title="Claude"/g)).toHaveLength(1);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();

    await act(async () => root.unmount());
  });

  it("shows each worker's used and total slots with an accessible meter", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nProvider>
          <WorkerStatusBar
            onOpenSettings={() => undefined}
            workers={[
              worker({
                activeSessions: 2,
                availableSessions: 2,
                maxConcurrentSessions: 4,
              }),
            ]}
          />
        </I18nProvider>,
      );
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".worker-status-trigger")
        ?.click();
    });

    const meter = container.querySelector<HTMLElement>('[role="progressbar"]');
    expect(meter?.getAttribute("aria-label")).toBe("슬롯 2/4개 사용 중");
    expect(meter?.getAttribute("aria-valuenow")).toBe("2");
    expect(meter?.getAttribute("aria-valuemax")).toBe("4");
    expect(meter?.querySelector("b")?.style.width).toBe("50%");
    expect(meter?.textContent).toBe("2/4");

    await act(async () => root.unmount());
  });

  it("opens Worker settings from the popover header", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onOpenSettings = vi.fn();

    await act(async () => {
      root.render(
        <I18nProvider>
          <WorkerStatusBar
            onOpenSettings={onOpenSettings}
            workers={[worker()]}
          />
        </I18nProvider>,
      );
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".worker-status-trigger")
        ?.click();
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Worker 설정 열기"]',
        )
        ?.click();
    });

    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(container.querySelector(".worker-status-popover")).toBeNull();

    await act(async () => root.unmount());
  });

  it("falls back to the worker binding provider for older responses", () => {
    expect(
      workerProviders(worker({ agentProvider: "grok", providers: undefined })),
    ).toEqual(["grok"]);
  });

  it("only counts online workers as active", () => {
    expect(
      activeWorkerCount([
        worker(),
        worker({ id: "worker-2", state: "stale", readiness: "offline" }),
        worker({ id: "worker-3", state: "disabled", readiness: "disabled" }),
      ]),
    ).toBe(1);
  });
});
