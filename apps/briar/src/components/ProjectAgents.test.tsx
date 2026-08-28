/** @vitest-environment jsdom */

import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { describe, expect, it, vi } from "vitest";
import type { AutoHuntSession } from "../hooks/useAutoHuntSessions";
import type { Project } from "../types";
import { ProjectAgents } from "./ProjectAgents";
import { I18nProvider } from "../i18n";

const project: Project = {
  id: "project-1",
  name: "Briar",
  issueKeyPrefix: "BR",
  scheduleTabEnabled: true,
  icon: null,
  organizationId: "org-1",
  organizationName: "Briar Org",
  role: "owner",
  createdAt: "2026-07-28T00:00:00.000Z",
};

const session: AutoHuntSession = {
  id: "session-1",
  dispatchGroupId: "",
  projectId: "project-1",
  agentId: "demo-agent-auto-hunt",
  sessionType: "task",
  request: "Review release status",
  status: "running",
  issues: [],
  startedAt: "2026-07-28T01:00:00.000Z",
  completedAt: null,
  conversationId: "thread-1",
  workspaceRoot: "/repo",
  summary: null,
  error: null,
  events: [],
  dispatchEvents: [],
  workers: [],
};

describe("ProjectAgents", () => {
  it("resets agent session view back to agent list when agentListRequestKey changes", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    try {
      await renderReactTestRoot(
        root,
        <I18nProvider>
          <ProjectAgents
            agentListRequestKey={0}
            dashboard={null}
            error={null}
            isSidebarOpen={true}
            onIssueOpen={vi.fn()}
            onSettleTaskSession={vi.fn()}
            onStopSession={vi.fn().mockResolvedValue(true)}
            onStart={vi.fn().mockReturnValue("run-1")}
            onStartTaskSession={vi.fn()}
            project={project}
            requestedSessionId="session-1"
            sessions={[session]}
            token={null}
          />
        </I18nProvider>,
      );

      // Initially with requestedSessionId="session-1", the session detail view should be rendered
      expect(container.querySelector("#project-agents")).toBeNull();
      expect(container.querySelector("#project-agent-session")).not.toBeNull();

      // When agentListRequestKey increments and requestedSessionId is cleared (as done when clicking agent tab)
      await renderReactTestRoot(
        root,
        <I18nProvider>
          <ProjectAgents
            agentListRequestKey={1}
            dashboard={null}
            error={null}
            isSidebarOpen={true}
            onIssueOpen={vi.fn()}
            onSettleTaskSession={vi.fn()}
            onStopSession={vi.fn().mockResolvedValue(true)}
            onStart={vi.fn().mockReturnValue("run-1")}
            onStartTaskSession={vi.fn()}
            project={project}
            requestedSessionId={null}
            sessions={[session]}
            token={null}
          />
        </I18nProvider>,
      );

      // Now the agent list should be shown
      expect(container.querySelector("#project-agents")).not.toBeNull();
      expect(container.querySelector("#project-agent-session")).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("resets agent detail view back to agent list when agentListRequestKey changes", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    try {
      await renderReactTestRoot(
        root,
        <I18nProvider>
          <ProjectAgents
            agentListRequestKey={0}
            dashboard={null}
            error={null}
            isSidebarOpen={true}
            onIssueOpen={vi.fn()}
            onSettleTaskSession={vi.fn()}
            onStopSession={vi.fn().mockResolvedValue(true)}
            onStart={vi.fn().mockReturnValue("run-1")}
            onStartTaskSession={vi.fn()}
            project={project}
            requestedSessionId={null}
            sessions={[]}
            token={null}
          />
        </I18nProvider>,
      );

      // Agent list is initially shown
      expect(container.querySelector("#project-agents")).not.toBeNull();

      // Click on an agent card to open agent detail
      const agentCardButton = container.querySelector<HTMLButtonElement>(
        'button[aria-label^="Open details for"]',
      );
      expect(agentCardButton).not.toBeNull();
      agentCardButton?.click();

      // After clicking agent card, detail view is shown
      await renderReactTestRoot(
        root,
        <I18nProvider>
          <ProjectAgents
            agentListRequestKey={0}
            dashboard={null}
            error={null}
            isSidebarOpen={true}
            onIssueOpen={vi.fn()}
            onSettleTaskSession={vi.fn()}
            onStopSession={vi.fn().mockResolvedValue(true)}
            onStart={vi.fn().mockReturnValue("run-1")}
            onStartTaskSession={vi.fn()}
            project={project}
            requestedSessionId={null}
            sessions={[]}
            token={null}
          />
        </I18nProvider>,
      );
      expect(container.querySelector("#project-agent-detail")).not.toBeNull();
      expect(container.querySelector("#project-agents")).toBeNull();

      // When agentListRequestKey changes, should return to agent list
      await renderReactTestRoot(
        root,
        <I18nProvider>
          <ProjectAgents
            agentListRequestKey={1}
            dashboard={null}
            error={null}
            isSidebarOpen={true}
            onIssueOpen={vi.fn()}
            onSettleTaskSession={vi.fn()}
            onStopSession={vi.fn().mockResolvedValue(true)}
            onStart={vi.fn().mockReturnValue("run-1")}
            onStartTaskSession={vi.fn()}
            project={project}
            requestedSessionId={null}
            sessions={[]}
            token={null}
          />
        </I18nProvider>,
      );
      expect(container.querySelector("#project-agents")).not.toBeNull();
      expect(container.querySelector("#project-agent-detail")).toBeNull();
    } finally {
      cleanup();
    }
  });
});
