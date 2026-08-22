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
  workerBriarVersion,
  workerProviders,
  workerRemoteUpdateSupported,
  workerUpdateAvailable,
} from "./WorkerStatusBar";

vi.mock("../lib/api", () => ({
  loadOrganizationExecutionWorkers: vi.fn(),
  requestOrganizationExecutionWorkerUpdate: vi.fn(),
}));

import {
  loadOrganizationExecutionWorkers,
  requestOrganizationExecutionWorkerUpdate,
} from "../lib/api";

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
    vi.mocked(loadOrganizationExecutionWorkers).mockReset();
    vi.mocked(requestOrganizationExecutionWorkerUpdate).mockReset();
    vi.mocked(loadOrganizationExecutionWorkers).mockResolvedValue({
      workers: [],
      latestVersion: null,
      canManage: true,
      generatedAt: "2026-07-29T00:00:00Z",
    });
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

  it("shows each worker's current Briar version", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nProvider>
          <WorkerStatusBar
            onOpenSettings={() => undefined}
            workers={[worker({ versions: { briar: "1.2.69" } })]}
          />
        </I18nProvider>,
      );
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".worker-status-trigger")
        ?.click();
    });

    expect(container.querySelector(".worker-status-version")?.textContent).toBe(
      "v1.2.69",
    );

    await act(async () => root.unmount());
  });

  it("shows an update control when a Worker is behind the latest version", async () => {
    vi.mocked(loadOrganizationExecutionWorkers).mockResolvedValue({
      workers: [
        {
          deviceId: "device-1",
          ownerUserId: "owner-1",
          ownerName: "Owner",
          label: "Janet's Mac",
          state: "online",
          maxConcurrentSessions: 1,
          activeSessions: 0,
          lastHeartbeatAt: "2026-07-29T00:00:00Z",
          createdAt: "2026-07-29T00:00:00Z",
          versions: { briar: "1.2.69" },
          remoteUpdateSupported: true,
          updateRequest: null,
          bindings: [],
        },
      ],
      latestVersion: "1.2.84",
      canManage: true,
      generatedAt: "2026-07-29T00:00:00Z",
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nProvider>
          <WorkerStatusBar
            onOpenSettings={() => undefined}
            organizationId="organization-1"
            token="token"
            userId="owner-1"
            workers={[
              worker({
                versions: { briar: "1.2.69" },
                capabilities: {
                  remoteUpdates: { supported: true, protocol: 1 },
                },
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
    await act(async () => {
      await Promise.resolve();
    });

    const update = container.querySelector<HTMLButtonElement>(
      ".worker-status-update",
    );
    expect(update).not.toBeNull();
    expect(update?.disabled).toBe(false);
    expect(update?.getAttribute("aria-label")).toBe("Janet's Mac 컴퓨터 업데이트");

    await act(async () => root.unmount());
  });

  it("spins while requesting an update and hides the control once current", async () => {
    let resolveRequest: ((value: {
      outcome: "requested";
      requestId: string;
      targetVersion: string;
    }) => void) | null = null;
    vi.mocked(requestOrganizationExecutionWorkerUpdate).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );
    vi.mocked(loadOrganizationExecutionWorkers)
      .mockResolvedValueOnce({
        workers: [
          {
            deviceId: "device-1",
            ownerUserId: "owner-1",
            ownerName: "Owner",
            label: "Janet's Mac",
            state: "online",
            maxConcurrentSessions: 1,
            activeSessions: 0,
            lastHeartbeatAt: "2026-07-29T00:00:00Z",
            createdAt: "2026-07-29T00:00:00Z",
            versions: { briar: "1.2.69" },
            remoteUpdateSupported: true,
            updateRequest: null,
            bindings: [],
          },
        ],
        latestVersion: "1.2.84",
        canManage: true,
        generatedAt: "2026-07-29T00:00:00Z",
      })
      .mockResolvedValueOnce({
        workers: [
          {
            deviceId: "device-1",
            ownerUserId: "owner-1",
            ownerName: "Owner",
            label: "Janet's Mac",
            state: "online",
            maxConcurrentSessions: 1,
            activeSessions: 0,
            lastHeartbeatAt: "2026-07-29T00:00:00Z",
            createdAt: "2026-07-29T00:00:00Z",
            versions: { briar: "1.2.69" },
            remoteUpdateSupported: true,
            updateRequest: {
              id: "77777777-7777-4777-8777-777777777777",
              targetVersion: "1.2.84",
              status: "requested",
              requestedAt: "2026-07-29T00:01:00Z",
            },
            bindings: [],
          },
        ],
        latestVersion: "1.2.84",
        canManage: true,
        generatedAt: "2026-07-29T00:01:00Z",
      });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nProvider>
          <WorkerStatusBar
            onOpenSettings={() => undefined}
            organizationId="organization-1"
            token="token"
            userId="owner-1"
            workers={[
              worker({
                versions: { briar: "1.2.69" },
                capabilities: {
                  remoteUpdates: { supported: true, protocol: 1 },
                },
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
    await act(async () => {
      await Promise.resolve();
    });

    const update = container.querySelector<HTMLButtonElement>(
      ".worker-status-update",
    );
    expect(update).not.toBeNull();

    await act(async () => {
      update?.click();
    });
    expect(update?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector(".spin")).not.toBeNull();

    await act(async () => {
      resolveRequest?.({
        outcome: "requested",
        requestId: "77777777-7777-4777-8777-777777777777",
        targetVersion: "1.2.84",
      });
      await Promise.resolve();
    });

    expect(requestOrganizationExecutionWorkerUpdate).toHaveBeenCalledWith(
      "token",
      "organization-1",
      "device-1",
    );
    expect(
      container
        .querySelector(".worker-status-update")
        ?.getAttribute("aria-busy"),
    ).toBe("true");
    expect(container.querySelector(".spin")).not.toBeNull();

    await act(async () => {
      root.render(
        <I18nProvider>
          <WorkerStatusBar
            onOpenSettings={() => undefined}
            organizationId="organization-1"
            token="token"
            userId="owner-1"
            workers={[
              worker({
                versions: { briar: "1.2.84" },
                capabilities: {
                  remoteUpdates: { supported: true, protocol: 1 },
                },
              }),
            ]}
          />
        </I18nProvider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Re-open after re-render if needed; control should not show once current.
    await act(async () => {
      vi.mocked(loadOrganizationExecutionWorkers).mockResolvedValue({
        workers: [
          {
            deviceId: "device-1",
            ownerUserId: "owner-1",
            ownerName: "Owner",
            label: "Janet's Mac",
            state: "online",
            maxConcurrentSessions: 1,
            activeSessions: 0,
            lastHeartbeatAt: "2026-07-29T00:00:00Z",
            createdAt: "2026-07-29T00:00:00Z",
            versions: { briar: "1.2.84" },
            remoteUpdateSupported: true,
            updateRequest: null,
            bindings: [],
          },
        ],
        latestVersion: "1.2.84",
        canManage: true,
        generatedAt: "2026-07-29T00:02:00Z",
      });
      container
        .querySelector<HTMLButtonElement>(".worker-status-trigger")
        ?.click();
    });
    await act(async () => {
      // ensure open
      if (!container.querySelector(".worker-status-popover")) {
        container
          .querySelector<HTMLButtonElement>(".worker-status-trigger")
          ?.click();
      }
      await Promise.resolve();
    });

    // Force refresh by toggling open again after version is current
    await act(async () => {
      const trigger = container.querySelector<HTMLButtonElement>(
        ".worker-status-trigger",
      );
      if (container.querySelector(".worker-status-popover")) {
        trigger?.click();
      }
      trigger?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector(".worker-status-version")?.textContent).toBe(
      "v1.2.84",
    );
    expect(container.querySelector(".worker-status-update")).toBeNull();

    await act(async () => root.unmount());
  });

  it("shows the handoff failure reason and allows a retry", async () => {
    vi.mocked(loadOrganizationExecutionWorkers).mockResolvedValue({
      workers: [
        {
          deviceId: "device-1",
          ownerUserId: "owner-1",
          ownerName: "Owner",
          label: "Janet's Mac",
          state: "online",
          maxConcurrentSessions: 1,
          activeSessions: 0,
          lastHeartbeatAt: "2026-07-29T00:00:00Z",
          createdAt: "2026-07-29T00:00:00Z",
          versions: { briar: "1.2.69" },
          remoteUpdateSupported: true,
          updateRequest: {
            id: "77777777-7777-4777-8777-777777777777",
            targetVersion: "1.2.84",
            status: "requested",
            requestedAt: "2026-07-29T00:01:00Z",
            handoffState: "failed",
            handoffError: "Provider process did not stop",
          },
          bindings: [],
        },
      ],
      latestVersion: "1.2.84",
      canManage: true,
      generatedAt: "2026-07-29T00:01:00Z",
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nProvider>
          <WorkerStatusBar
            onOpenSettings={() => undefined}
            organizationId="organization-1"
            token="token"
            userId="owner-1"
            workers={[
              worker({
                versions: { briar: "1.2.69" },
                capabilities: {
                  remoteUpdates: { supported: true, protocol: 1 },
                },
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
      await Promise.resolve();
    });

    const update = container.querySelector<HTMLButtonElement>(
      ".worker-status-update",
    );
    expect(update?.disabled).toBe(false);
    expect(update?.getAttribute("aria-label")).toBe(
      "v1.2.84 업데이트 지연됨",
    );
    expect(update?.title).toContain("Provider process did not stop");

    await act(async () => update?.click());
    expect(requestOrganizationExecutionWorkerUpdate).toHaveBeenCalledWith(
      "token",
      "organization-1",
      "device-1",
    );

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

  it("refreshes worker status from the popover header", async () => {
    let resolveRefresh: (() => void) | null = null;
    const onRefresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    vi.mocked(loadOrganizationExecutionWorkers).mockImplementation(
      () =>
        new Promise((resolve) => {
          window.setTimeout(() => {
            resolve({
              workers: [],
              latestVersion: null,
              canManage: true,
              generatedAt: "2026-07-29T00:00:00Z",
            });
          }, 0);
        }),
    );

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nProvider>
          <WorkerStatusBar
            onOpenSettings={() => undefined}
            onRefresh={onRefresh}
            organizationId="organization-1"
            token="token"
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
      await Promise.resolve();
    });

    // Opening the popover loads update metadata once.
    expect(loadOrganizationExecutionWorkers).toHaveBeenCalledTimes(1);

    const refresh = container.querySelector<HTMLButtonElement>(
      '[aria-label="Worker 상태 새로고침"]',
    );
    expect(refresh).not.toBeNull();
    expect(
      container.querySelector('[aria-label="Worker 설정 열기"]'),
    ).not.toBeNull();

    await act(async () => {
      refresh?.click();
    });

    expect(onRefresh).toHaveBeenCalledOnce();
    expect(refresh?.disabled).toBe(true);
    expect(refresh?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector(".spin")).not.toBeNull();
    expect(loadOrganizationExecutionWorkers).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveRefresh?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container
        .querySelector<HTMLButtonElement>('[aria-label="Worker 상태 새로고침"]')
        ?.disabled,
    ).toBe(false);
    expect(container.querySelector(".spin")).toBeNull();
    expect(container.querySelector(".worker-status-popover")).not.toBeNull();

    await act(async () => root.unmount());
  });

  it("does not expose a provider when health information is missing", () => {
    expect(
      workerProviders(worker({ agentProvider: "grok", providers: undefined })),
    ).toEqual([]);
  });

  it("does not expose providers from a Worker that cannot accept work", () => {
    expect(
      workerProviders(
        worker({
          acceptingWork: false,
          providers: ["codex", "grok"],
          readiness: "needs_attention",
        }),
      ),
    ).toEqual([]);
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

  it("detects Briar versions and remote update support", () => {
    expect(workerBriarVersion(worker({ versions: { briar: "1.2.69" } }))).toBe(
      "1.2.69",
    );
    expect(workerBriarVersion(worker())).toBeNull();
    expect(
      workerRemoteUpdateSupported(
        worker({
          capabilities: { remoteUpdates: { supported: true, protocol: 1 } },
        }),
      ),
    ).toBe(true);
    expect(
      workerUpdateAvailable({
        currentVersion: "1.2.69",
        latestVersion: "1.2.84",
      }),
    ).toBe(true);
    expect(
      workerUpdateAvailable({
        currentVersion: "1.2.84",
        latestVersion: "1.2.84",
      }),
    ).toBe(false);
  });
});
