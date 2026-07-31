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
  provider: "claude",
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
  providers: ["codex", "claude", "grok"],
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

  it("selects an execution provider independently from the logical Agent", async () => {
    const codexWorker = {
      ...worker("worker-codex", "Codex Mac"),
      providers: ["codex"] as ExecutionWorker["providers"],
    };
    const claudeWorker = {
      ...worker("worker-claude", "Claude Mac"),
      providers: ["claude"] as ExecutionWorker["providers"],
    };
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
          run={null}
          workers={[codexWorker, claudeWorker]}
        />,
      );
    });

    expect(document.body.textContent).toContain("Claude Mac");
    expect(document.body.textContent).not.toContain("Codex Mac");

    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>('[aria-label="실행 프로바이더"]')
        ?.click();
    });
    expect(
      document.body.querySelector(
        '.select-menu-option[data-value="grok"]',
      ),
    ).toBeNull();
    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>(
          '.select-menu-option[data-value="codex"]',
        )
        ?.click();
    });

    expect(document.body.textContent).toContain("Codex Mac");
    expect(document.body.textContent).not.toContain("Claude Mac");

    await act(async () => root.unmount());
  });

  it("selects a Worker card and submits the Worker and provider", async () => {
    const first = worker("worker-first", "First Mac");
    const second = worker("worker-second", "Second Mac");
    const onSubmit = vi.fn();
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
          onSubmit={onSubmit}
          open
          run={null}
          workers={[first, second]}
        />,
      );
    });

    const secondCard = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>(
        ".worker-readiness-row",
      ),
    ).find((button) => button.textContent?.includes("Second Mac"));
    await act(async () => secondCard?.click());

    expect(secondCard?.getAttribute("aria-pressed")).toBe("true");

    const dispatchButton = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("실행 배정"));
    await act(async () => dispatchButton?.click());

    expect(onSubmit).toHaveBeenCalledWith({
      agentId: agent.id,
      provider: "claude",
      workerId: second.id,
    });

    await act(async () => root.unmount());
  });
});
