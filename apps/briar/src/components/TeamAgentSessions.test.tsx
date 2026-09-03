/** @vitest-environment jsdom */

import { act } from "react";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { describe, expect, it, vi } from "vitest";
import type { AutoHuntSession } from "../hooks/useAutoHuntSessions";
import type { ProjectAgent } from "../types";
import { TeamAgentSessions } from "./TeamAgentSessions";

const agent: ProjectAgent = {
  id: "agent-1",
  teamId: "project-1",
  name: "Release agent",
  avatar: null,
  codexPet: null,
  provider: "codex",
  model: null,
  effort: null,
  responsibility: "Review the release.",
  skill: "# Release agent",
  skills: [],
  calendarColor: "#3275d5",
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
};

const taskSession: AutoHuntSession = {
  id: "task-session",
  dispatchGroupId: "task-session",
  projectId: "project-1",
  agentId: agent.id,
  sessionType: "task",
  request: "Review the current release status.",
  status: "completed",
  issues: [],
  startedAt: "2026-07-28T01:00:00.000Z",
  updatedAt: "2026-07-28T01:01:00.000Z",
  completedAt: "2026-07-28T01:01:00.000Z",
  conversationId: "thread-1",
  workspaceRoot: "/repo",
  summary: "The release is ready.",
  error: null,
  events: [],
  dispatchEvents: [],
  workers: [],
};

describe("TeamAgentSessions", () => {
  it("shows direct task sessions for only the selected agent", async () => {
    const onSessionOpen = vi.fn();
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <TeamAgentSessions
        agent={agent}
        onSessionOpen={onSessionOpen}
        projectId="project-1"
        sessions={[
          taskSession,
          {
            ...taskSession,
            id: "scheduled-session",
            trigger: "scheduled",
            request: "Daily repository audit",
            status: "skipped",
            summary: "대기 상태인 이슈가 없어 세션을 건너뛰었습니다.",
            events: [{
              id: "scheduled-session-skipped",
              type: "skipped",
              occurredAt: "2026-07-28T01:01:00.000Z",
            }],
          },
          {
            ...taskSession,
            id: "other-agent-session",
            agentId: "agent-2",
            request: "Do not show this task.",
          },
        ]}
      />,
    );

    expect(container.textContent).toContain(
      "Review the current release status.",
    );
    expect(container.textContent).toContain("스케줄 실행");
    expect(container.textContent).toContain("Daily repository audit");
    expect(container.textContent).toContain("건너뜀");
    expect(container.textContent).not.toContain("Do not show this task.");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".auto-hunt-session-row")
        ?.click();
    });
    expect(onSessionOpen).toHaveBeenCalledWith("task-session");
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await cleanup();
  });

  it("shows a task and its Auto Hunt dispatch as one session", async () => {
    const onSessionOpen = vi.fn();
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    const dispatchSession: AutoHuntSession = {
      ...taskSession,
      id: "dispatch-session",
      dispatchGroupId: "dispatch-session",
      sessionType: "dispatch",
      parentSessionId: taskSession.id,
      request: taskSession.request,
      status: "running",
      completedAt: null,
      conversationId: null,
      summary: null,
      issues: [{
        runId: "run-1",
        runNumber: 1,
        sourceKey: "issue-1",
        title: "Queued issue",
        outcome: "pending",
        summary: null,
      }],
    };

    await renderReactTestRoot(
      root,
      <TeamAgentSessions
        agent={agent}
        onSessionOpen={onSessionOpen}
        projectId="project-1"
        sessions={[dispatchSession, taskSession]}
      />,
    );

    expect(
      container.querySelectorAll(".auto-hunt-session-row"),
    ).toHaveLength(1);
    expect(container.textContent).toContain(
      "Review the current release status.",
    );
    expect(container.textContent).toContain("1개 이슈");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".auto-hunt-session-row")
        ?.click();
    });
    expect(onSessionOpen).toHaveBeenCalledWith("dispatch-session");

    await cleanup();
  });

  it("renders stop button for running session and handles stopping", async () => {
    const onSessionOpen = vi.fn();
    const onStopSession = vi.fn().mockResolvedValue(true);
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    const runningSession: AutoHuntSession = {
      ...taskSession,
      id: "running-session",
      status: "running",
      completedAt: null,
      localOwner: true,
    };

    await renderReactTestRoot(
      root,
      <TeamAgentSessions
        agent={agent}
        onSessionOpen={onSessionOpen}
        onStopSession={onStopSession}
        projectId="project-1"
        sessions={[runningSession]}
      />,
    );

    const stopButton = container.querySelector<HTMLButtonElement>(
      ".auto-hunt-session-row-stop",
    );
    expect(stopButton).not.toBeNull();
    expect(stopButton?.getAttribute("aria-label")).toBe("세션 정지");

    await act(async () => {
      stopButton?.click();
    });

    expect(onStopSession).toHaveBeenCalledWith("running-session");
    expect(onSessionOpen).not.toHaveBeenCalled();

    await cleanup();
  });

  it("does not render stop button for non-running or remote sessions", async () => {
    const onSessionOpen = vi.fn();
    const onStopSession = vi.fn().mockResolvedValue(true);
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    const remoteRunningSession: AutoHuntSession = {
      ...taskSession,
      id: "remote-running-session",
      status: "running",
      completedAt: null,
      localOwner: false,
    };

    await renderReactTestRoot(
      root,
      <TeamAgentSessions
        agent={agent}
        onSessionOpen={onSessionOpen}
        onStopSession={onStopSession}
        projectId="project-1"
        sessions={[taskSession, remoteRunningSession]}
      />,
    );

    const stopButtons = container.querySelectorAll(
      ".auto-hunt-session-row-stop",
    );
    expect(stopButtons).toHaveLength(0);

    await cleanup();
  });
});
