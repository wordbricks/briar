/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutionWorker, ProjectAgent } from "../types";
import { WorkerDispatchDialog } from "./WorkerDispatchDialog";

const agent: ProjectAgent = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  projectId: "11111111-1111-4111-8111-111111111111",
  name: "Builder",
  avatar: null,
  codexPet: null,
  provider: "codex",
  model: null,
  responsibility: "Build",
  skill: "# Build",
  calendarColor: "#000000",
  createdAt: "2026-07-29T00:00:00Z",
  updatedAt: "2026-07-29T00:00:00Z",
};

const worker = (id: string, label: string): ExecutionWorker => ({
  id,
  deviceId: `device-${id}`,
  ownerUserId: "owner",
  label,
  agentProvider: "codex",
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
});

describe("WorkerDispatchDialog", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows only policy-allowed Workers and preselects the project default", async () => {
    const allowed = worker("worker-allowed", "Allowed Mac");
    const denied = worker("worker-denied", "Denied Mac");
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <WorkerDispatchDialog
          agents={[agent]}
          error={null}
          isDispatching={false}
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
          open
          policy={{
            selectionMode: "allowlist",
            defaultWorkerId: allowed.id,
            allowedWorkerIds: [allowed.id],
            updatedAt: "2026-07-29T00:00:00Z",
          }}
          run={null}
          workers={[allowed, denied]}
        />,
      );
    });

    expect(document.body.textContent).toContain("Allowed Mac");
    expect(document.body.textContent).not.toContain("Denied Mac");
    expect(
      document.body.querySelector<HTMLButtonElement>(
        '[aria-label="Worker 실행 환경"]',
      )?.textContent,
    ).toContain("Allowed Mac");

    await act(async () => root.unmount());
  });
});
