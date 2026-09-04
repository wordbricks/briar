/** @vitest-environment jsdom */

import { act } from "react";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { describe, expect, it, vi } from "vitest";
import type { AutoHuntSession } from "../hooks/useAutoHuntSessions";
import { TeamAgentSessionDetail } from "./TeamAgentSessionDetail";

const runningSession: AutoHuntSession = {
  id: "task-session",
  dispatchGroupId: "task-session",
  projectId: "project-1",
  agentId: "agent-1",
  sessionType: "task",
  request: "Review the current release status.",
  status: "running",
  issues: [],
  startedAt: "2026-07-28T01:00:00.000Z",
  updatedAt: "2026-07-28T01:00:00.000Z",
  completedAt: null,
  conversationId: null,
  workspaceRoot: null,
  summary: null,
  error: null,
  events: [],
  dispatchEvents: [],
  workers: [],
  localOwner: true,
  detailLoaded: true,
};

function stopButton(container: HTMLElement) {
  return container.querySelector<HTMLButtonElement>(
    ".auto-hunt-session-stop",
  );
}

describe("TeamAgentSessionDetail", () => {
  it("stops a running local session", async () => {
    const onStop = vi.fn().mockResolvedValue(true);
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
      <TeamAgentSessionDetail
        isSidebarOpen
        onBack={vi.fn()}
        onIssueOpen={vi.fn()}
        onStop={onStop}
        session={runningSession}
      />,
    );

    const button = stopButton(container);
    expect(button).not.toBeNull();
    expect(button?.getAttribute("aria-label")).toBe("세션 정지");

    await act(async () => {
      button?.click();
    });
    expect(onStop).toHaveBeenCalledTimes(1);

    await cleanup();
  });

  it("stops a running remote worker task session", async () => {
    const onStop = vi.fn().mockResolvedValue(true);
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
      <TeamAgentSessionDetail
        isSidebarOpen
        onBack={vi.fn()}
        onIssueOpen={vi.fn()}
        onStop={onStop}
        session={{
          ...runningSession,
          localOwner: false,
          requestedWorkerId: "worker-1",
          workerId: "worker-1",
        }}
      />,
    );

    const button = stopButton(container);
    expect(button).not.toBeNull();

    await act(async () => {
      button?.click();
    });
    expect(onStop).toHaveBeenCalledTimes(1);

    await cleanup();
  });

  it("hides the stop control for a remote session without a worker", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
      <TeamAgentSessionDetail
        isSidebarOpen
        onBack={vi.fn()}
        onIssueOpen={vi.fn()}
        onStop={vi.fn().mockResolvedValue(true)}
        session={{ ...runningSession, localOwner: false }}
      />,
    );

    expect(stopButton(container)).toBeNull();

    await cleanup();
  });

  it("hides the stop control once the session is no longer running", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
      <TeamAgentSessionDetail
        isSidebarOpen
        onBack={vi.fn()}
        onIssueOpen={vi.fn()}
        onStop={vi.fn().mockResolvedValue(true)}
        session={{
          ...runningSession,
          localOwner: false,
          workerId: "worker-1",
          status: "interrupted",
          completedAt: "2026-07-28T01:05:00.000Z",
        }}
      />,
    );

    expect(stopButton(container)).toBeNull();

    await cleanup();
  });
});
