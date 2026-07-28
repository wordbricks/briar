/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
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
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <ProjectAgentSessions
          agent={agent}
          projectId="project-1"
          requestedSessionId={null}
          sessions={[
            taskSession,
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
    expect(container.textContent).not.toContain("Do not show this task.");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".auto-hunt-session-row")
        ?.click();
    });
    expect(document.body.textContent).toContain("The release is ready.");

    await act(async () => root.unmount());
    container.remove();
  });
});
