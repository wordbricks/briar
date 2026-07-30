/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { loadOrganizationExecutionWorkers } from "../lib/api";
import { OrganizationWorkersSettings } from "./OrganizationWorkersSettings";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../lib/platform", () => ({ isDesktopTauri: () => true }));
vi.mock("../lib/api", () => ({
  disableOrganizationExecutionWorker: vi.fn(),
  loadOrganizationExecutionWorkers: vi.fn(),
  updateOrganizationExecutionWorkerConcurrency: vi.fn(),
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
          bindings: [],
        },
      ],
      canManage: true,
      generatedAt: "2026-07-30T00:00:00Z",
    });
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

    await act(async () => root.unmount());
    container.remove();
  });
});
