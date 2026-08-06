/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { AutoHuntSession } from "../hooks/useAutoHuntSessions";
import type { ProjectAgent } from "../types";
import { ProjectAgentSessions } from "./ProjectAgentSessions";

const agent: ProjectAgent = {
  id: "agent-1",
  projectId: "project-1",
  name: "Release agent",
  avatar: null,
  codexPet: null,
  provider: "codex",
  model: null,
  effort: null,
  responsibility: "Review the release.",
  skill: "# Release agent",
  calendarColor: "#3275d5",
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
};

const taskSession: AutoHuntSession = {
  id: "task-session",
  dispatchGroupId: "",
  projectId: "project-1",
  agentId: agent.id,
  sessionType: "task",
  request: "Review the current release status.",
  status: "completed",
  issues: [],
  startedAt: "2026-07-28T01:00:00.000Z",
  completedAt: "2026-07-28T01:01:00.000Z",
  conversationId: "thread-1",
  workspaceRoot: "/repo",
  summary: "The release is ready.",
  error: null,
  events: [],
  dispatchEvents: [],
  workers: [],
};

describe("ProjectAgentSessions", () => {
  it("shows direct task sessions for only the selected agent", async () => {
    const onSessionOpen = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <ProjectAgentSessions
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
      ),
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

    await act(async () => root.unmount());
    container.remove();
  });

  it("shows a task and its Auto Hunt dispatch as one session", async () => {
    const onSessionOpen = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
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

    await act(async () =>
      root.render(
        <ProjectAgentSessions
          agent={agent}
          onSessionOpen={onSessionOpen}
          projectId="project-1"
          sessions={[dispatchSession, taskSession]}
        />,
      ),
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

    await act(async () => root.unmount());
    container.remove();
  });
});
