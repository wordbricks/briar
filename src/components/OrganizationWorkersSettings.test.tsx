/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  deleteOrganizationExecutionWorker,
  loadOrganizationExecutionWorkers,
  requestOrganizationExecutionWorkerUpdate,
  updateOrganizationExecutionWorkerIcon,
} from "../lib/api";
import { OrganizationWorkersSettings } from "./OrganizationWorkersSettings";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../lib/platform", () => ({
  isDesktopTauri: () => true,
  supportsManagedComputerRemoteDesktop: () => true,
}));
vi.mock("../lib/api", () => ({
  applyForManagedComputer: vi.fn(),
  deleteOrganizationExecutionWorker: vi.fn(),
  loadManagedComputerProduct: vi.fn(async () => ({
    product: {
      currency: "USD",
      monthlyPriceCents: 10_000,
      quantity: 1,
      specification: {
        instanceType: "m7i.large",
        vcpu: 2,
        memoryGiB: 8,
        volumeGiB: 100,
        maxConcurrentRuns: 1,
        region: "us-east-1",
      },
      modelApiCostsIncluded: false,
    },
    applicationsEnabled: false,
    configurationReady: false,
    canApply: true,
    organizationLimit: 1,
    fleetLimit: 1,
  })),
  loadManagedComputers: vi.fn(async () => ({
    computers: [],
    generatedAt: "2026-08-22T00:00:00.000Z",
  })),
  loadOrganizationExecutionWorkers: vi.fn(),
  requestOrganizationExecutionWorkerUpdate: vi.fn(),
  retryManagedComputer: vi.fn(),
  updateOrganizationExecutionWorkerConcurrency: vi.fn(),
  updateOrganizationExecutionWorkerIcon: vi.fn(),
  validateManagedComputerPromotion: vi.fn(),
}));

describe("OrganizationWorkersSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "sync_execution_worker_labels") {
        return { label: "renamed-host", syncedDevices: 1, failedDevices: 0 };
      }
      if (command === "inspect_execution_workers") {
        return [
          {
            projectId: "project-1",
            registered: true,
            workerId: "worker-1",
            deviceId: "device-1",
            label: "renamed-host",
            maxConcurrentSessions: 1,
          },
        ];
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    vi.mocked(loadOrganizationExecutionWorkers).mockResolvedValue({
      workers: [
        {
          deviceId: "device-1",
          ownerUserId: "user-1",
          ownerName: "Jay",
          label: "renamed-host",
          state: "online",
          maxConcurrentSessions: 1,
          activeSessions: 0,
          lastHeartbeatAt: "2026-07-30T00:00:00Z",
          createdAt: "2026-07-30T00:00:00Z",
          versions: { briar: "1.2.69" },
          remoteUpdateSupported: true,
          updateRequest: null,
          bindings: [],
        },
      ],
      latestVersion: "1.2.84",
      canManage: true,
      generatedAt: "2026-07-30T00:00:00Z",
    });
    vi.mocked(updateOrganizationExecutionWorkerIcon).mockResolvedValue({
      deviceId: "device-1",
      icon: { type: "emoji", value: "🍋" },
    });
    vi.mocked(requestOrganizationExecutionWorkerUpdate).mockResolvedValue({
      outcome: "requested",
      requestId: "77777777-7777-4777-8777-777777777777",
      targetVersion: "1.2.84",
    });
    localStorage.setItem("briar.locale.v1", "ko");
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("syncs the hostname before loading Worker settings", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <OrganizationWorkersSettings
          connectedProjectIds={["project-1"]}
          organization={{
            id: "organization-1",
            name: "Wordbricks",
            handle: "wordbricks",
            logo: null,
            role: "owner",
            createdAt: "2026-07-30T00:00:00Z",
          }}
          projects={[
            {
              id: "project-1",
              organizationId: "organization-1",
              name: "Briar",
              createdAt: "2026-07-30T00:00:00Z",
            },
          ]}
          token="token"
          userId="user-1"
        />,
      );
    });

    expect(invoke).toHaveBeenNthCalledWith(1, "sync_execution_worker_labels");
    expect(loadOrganizationExecutionWorkers).toHaveBeenCalledWith(
      "token",
      "organization-1",
    );
    expect(container.textContent).toContain("renamed-host");
    const capacity = container.querySelector('[role="progressbar"]');
    expect(capacity?.getAttribute("aria-valuemin")).toBe("0");
    expect(capacity?.getAttribute("aria-valuemax")).toBe("1");
    expect(capacity?.getAttribute("aria-valuenow")).toBe("0");

    await act(async () => root.unmount());
    container.remove();
  });

  it("saves one emoji as the Worker icon", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <OrganizationWorkersSettings
          connectedProjectIds={["project-1"]}
          organization={{
            id: "organization-1",
            name: "Wordbricks",
            handle: "wordbricks",
            logo: null,
            role: "owner",
            createdAt: "2026-07-30T00:00:00Z",
          }}
          projects={[
            {
              id: "project-1",
              organizationId: "organization-1",
              name: "Briar",
              createdAt: "2026-07-30T00:00:00Z",
            },
          ]}
          token="token"
          userId="user-1"
        />,
      );
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="renamed-host 컴퓨터 아이콘 편집"]',
        )
        ?.click();
    });
    const input = container.querySelector<HTMLInputElement>(
      "#worker-emoji-device-1",
    );
    await act(async () => {
      if (!input) return;
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(input, "🍋");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "저장",
    );
    await act(async () => {
      save?.click();
    });

    expect(updateOrganizationExecutionWorkerIcon).toHaveBeenCalledWith(
      "token",
      "organization-1",
      "device-1",
      { type: "emoji", value: "🍋" },
    );

    await act(async () => root.unmount());
    container.remove();
  });

  it("requests the latest signed version for a remote Worker", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <OrganizationWorkersSettings
          connectedProjectIds={["project-1"]}
          organization={{
            id: "organization-1",
            name: "Wordbricks",
            handle: "wordbricks",
            logo: null,
            role: "owner",
            createdAt: "2026-07-30T00:00:00Z",
          }}
          projects={[]}
          token="token"
          userId="user-1"
        />,
      );
    });

    const update = container.querySelector<HTMLButtonElement>(
      '[aria-label="renamed-host 컴퓨터 업데이트"]',
    );
    expect(update?.disabled).toBe(false);
    await act(async () => update?.click());
    expect(requestOrganizationExecutionWorkerUpdate).toHaveBeenCalledWith(
      "token",
      "organization-1",
      "device-1",
    );

    await act(async () => root.unmount());
    container.remove();
  });

  it("permanently deletes an old Worker after an irreversible warning", async () => {
    const currentWorker = {
      deviceId: "device-1",
      ownerUserId: "user-1",
      ownerName: "Jay",
      label: "renamed-host",
      state: "online" as const,
      maxConcurrentSessions: 1,
      activeSessions: 0,
      lastHeartbeatAt: "2026-07-30T00:00:00Z",
      createdAt: "2026-07-30T00:00:00Z",
      versions: { briar: "1.2.84" },
      remoteUpdateSupported: true,
      updateRequest: null,
      bindings: [],
    };
    const oldWorker = {
      ...currentWorker,
      deviceId: "device-old",
      label: "old-mango",
      state: "stale" as const,
      versions: { briar: "1.2.69" },
      updateRequest: {
        id: "77777777-7777-4777-8777-777777777779",
        targetVersion: "1.2.84",
        status: "requested" as const,
        requestedAt: "2026-07-30T00:00:00Z",
        handoffState: "ready" as const,
        handoffError: null,
      },
    };
    vi.mocked(loadOrganizationExecutionWorkers)
      .mockResolvedValueOnce({
        workers: [currentWorker, oldWorker],
        latestVersion: "1.2.84",
        canManage: true,
        generatedAt: "2026-07-30T00:00:00Z",
      })
      .mockResolvedValue({
        workers: [currentWorker],
        latestVersion: "1.2.84",
        canManage: true,
        generatedAt: "2026-07-30T00:01:00Z",
      });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <OrganizationWorkersSettings
          connectedProjectIds={["project-1"]}
          organization={{
            id: "organization-1",
            name: "Wordbricks",
            handle: "wordbricks",
            logo: null,
            role: "owner",
            createdAt: "2026-07-30T00:00:00Z",
          }}
          projects={[]}
          token="token"
          userId="user-1"
        />,
      );
    });

    const remove = container.querySelector<HTMLButtonElement>(
      '[aria-label="old-mango 컴퓨터 영구 삭제"]',
    );
    await act(async () => remove?.click());

    expect(deleteOrganizationExecutionWorker).not.toHaveBeenCalled();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.textContent).toContain("old-mango 컴퓨터 영구 삭제");
    expect(dialog?.textContent).toContain(
      "실행 자격 증명, 모든 프로젝트 연결, 대기 중 업데이트와 이 컴퓨터 전용 작업 데이터가 삭제되며 되돌릴 수 없습니다.",
    );
    const confirmDelete = Array.from(
      dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find((button) => button.textContent?.includes("영구 삭제"));
    await act(async () => confirmDelete?.click());

    expect(deleteOrganizationExecutionWorker).toHaveBeenCalledWith(
      "token",
      "organization-1",
      "device-old",
    );
    expect(container.textContent).not.toContain("old-mango");

    await act(async () => root.unmount());
    container.remove();
  });

  it("separates project readiness and providers from Worker capacity", async () => {
    vi.mocked(loadOrganizationExecutionWorkers).mockResolvedValue({
      workers: [
        {
          deviceId: "device-1",
          ownerUserId: "user-1",
          ownerName: "Jay",
          label: "renamed-host",
          state: "online",
          maxConcurrentSessions: 4,
          activeSessions: 1,
          lastHeartbeatAt: "2026-07-30T00:00:00Z",
          createdAt: "2026-07-30T00:00:00Z",
          bindings: [
            {
              id: "binding-1",
              projectId: "project-1",
              projectName: "Briar",
              agentProvider: "codex",
              providers: ["codex", "claude"],
              state: "online",
              acceptingWork: true,
              readiness: "available",
              readinessDetail: null,
            },
          ],
        },
      ],
      canManage: true,
      generatedAt: "2026-07-30T00:00:00Z",
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <OrganizationWorkersSettings
          connectedProjectIds={["project-1"]}
          organization={{
            id: "organization-1",
            name: "Wordbricks",
            handle: "wordbricks",
            logo: null,
            role: "owner",
            createdAt: "2026-07-30T00:00:00Z",
          }}
          projects={[
            {
              id: "project-1",
              organizationId: "organization-1",
              name: "Briar",
              createdAt: "2026-07-30T00:00:00Z",
            },
          ]}
          token="token"
          userId="user-1"
        />,
      );
    });

    expect(container.textContent).toContain("Briar");
    expect(container.textContent).toContain("사용 가능");
    expect(container.querySelector('[aria-label="Codex"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Claude"]')).not.toBeNull();
    const capacity = container.querySelector('[role="progressbar"]');
    expect(capacity?.getAttribute("aria-valuemax")).toBe("4");
    expect(capacity?.getAttribute("aria-valuenow")).toBe("1");
    expect(capacity?.getAttribute("aria-label")).toBe(
      "실행 슬롯 1/4 사용 중",
    );

    await act(async () => root.unmount());
    container.remove();
  });
});
