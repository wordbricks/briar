/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { createReactTestRoot, flush, renderReactTestRoot, settle } from "../test/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AutoHuntSession } from "../types";
import type { Project } from "../types";
import { requestedTeamAgentSettingsIdAtom } from "../state/dialogs/atoms";
import { createTestRegistry, type AtomRegistry } from "../state/registry";
import { applySyncEvent } from "../state/sync/apply";
import { TeamAgents } from "./TeamAgents";
import { I18nProvider } from "../i18n";

const project: Project = {
  id: "project-1",
  name: "Briar",
  issueKeyPrefix: "BR",
  scheduleTabEnabled: true,
  icon: null,
  iconName: null,
  iconColor: null,
  organizationId: "org-1",
  organizationName: "Briar Org",
  role: "owner",
  createdAt: "2026-07-28T00:00:00.000Z",
};

const session: AutoHuntSession = {
  id: "session-1",
  dispatchGroupId: "session-1",
  projectId: "project-1",
  agentId: "demo-agent-auto-hunt",
  sessionType: "task",
  request: "Review release status",
  status: "running",
  issues: [],
  startedAt: "2026-07-28T01:00:00.000Z",
  updatedAt: "2026-07-28T01:00:00.000Z",
  completedAt: null,
  conversationId: "thread-1",
  workspaceRoot: "/repo",
  summary: null,
  error: null,
  events: [],
  dispatchEvents: [],
  workers: [],
};

/** A registry holding `sessions`, which the page reads instead of a prop. */
const registryWith = (sessions: AutoHuntSession[]): AtomRegistry => {
  const registry = createTestRegistry();
  applySyncEvent(registry, { kind: "agent-sessions-changed", sessions });
  return registry;
};

/*
  The profile editor draws Radix controls that size themselves, which jsdom does
  not provide. The stub is enough: nothing here asserts on a measured layout.
*/
beforeEach(() => {
  Object.assign(globalThis, {
    IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
});

describe("TeamAgents", () => {
  /*
    The page under a registry, with the demo agent list `token: null` loads.
    Only the two "Edit Profile" cases below use it; the older cases spell their
    own markup out because they re-render it with changed props.
  */
  const page = (registry: AtomRegistry) => (
    <RegistryContext.Provider value={registry}>
      <I18nProvider>
        <TeamAgents
          agentListRequestKey={0}
          board={null}
          error={null}
          isSidebarOpen={true}
          onIssueOpen={vi.fn()}
          onSettleTaskSession={vi.fn()}
          onStopSession={vi.fn().mockResolvedValue(true)}
          onStart={vi.fn().mockReturnValue("run-1")}
          onStartTaskSession={vi.fn()}
          project={project}
          requestedSessionId={null}
          token={null}
        />
      </I18nProvider>
    </RegistryContext.Provider>
  );

  it("opens the profile editor for the agent Edit Profile asked for", async () => {
    const registry = registryWith([]);
    registry.set(requestedTeamAgentSettingsIdAtom, "demo-agent-sentry");
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    try {
      await renderReactTestRoot(root, page(registry));
      await settle(
        () => container.querySelector("#project-agent-settings") !== null,
        { description: "the agent profile editor" },
      );
      expect(container.querySelector("#project-agents")).toBeNull();
      // Consumed, so returning to the page later starts on the list.
      expect(registry.get(requestedTeamAgentSettingsIdAtom)).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it("leaves a request for an agent this team does not list alone", async () => {
    const registry = registryWith([]);
    registry.set(requestedTeamAgentSettingsIdAtom, "agent-on-another-team");
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    try {
      await renderReactTestRoot(root, page(registry));
      await flush();
      expect(container.querySelector("#project-agent-settings")).toBeNull();
      expect(container.querySelector("#project-agents")).not.toBeNull();
      // The team may still be switching, so the request waits rather than
      // being dropped by the page that cannot serve it.
      expect(registry.get(requestedTeamAgentSettingsIdAtom)).toBe(
        "agent-on-another-team",
      );
    } finally {
      await cleanup();
    }
  });

  it("resets agent session view back to agent list when agentListRequestKey changes", async () => {
    const registry = registryWith([session]);
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    try {
      await renderReactTestRoot(
        root,
        <RegistryContext.Provider value={registry}>
        <I18nProvider>
          <TeamAgents
            agentListRequestKey={0}
            board={null}
            error={null}
            isSidebarOpen={true}
            onIssueOpen={vi.fn()}
            onSettleTaskSession={vi.fn()}
            onStopSession={vi.fn().mockResolvedValue(true)}
            onStart={vi.fn().mockReturnValue("run-1")}
            onStartTaskSession={vi.fn()}
            project={project}
            requestedSessionId="session-1"
            token={null}
          />
        </I18nProvider>
        </RegistryContext.Provider>,
      );

      // Initially with requestedSessionId="session-1", the session detail view should be rendered
      expect(container.querySelector("#project-agents")).toBeNull();
      expect(container.querySelector("#project-agent-session")).not.toBeNull();

      // When agentListRequestKey increments and requestedSessionId is cleared (as done when clicking agent tab)
      await renderReactTestRoot(
        root,
        <RegistryContext.Provider value={registry}>
        <I18nProvider>
          <TeamAgents
            agentListRequestKey={1}
            board={null}
            error={null}
            isSidebarOpen={true}
            onIssueOpen={vi.fn()}
            onSettleTaskSession={vi.fn()}
            onStopSession={vi.fn().mockResolvedValue(true)}
            onStart={vi.fn().mockReturnValue("run-1")}
            onStartTaskSession={vi.fn()}
            project={project}
            requestedSessionId={null}
            token={null}
          />
        </I18nProvider>
        </RegistryContext.Provider>,
      );

      // Now the agent list should be shown
      expect(container.querySelector("#project-agents")).not.toBeNull();
      expect(container.querySelector("#project-agent-session")).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("resets agent detail view back to agent list when agentListRequestKey changes", async () => {
    const registry = registryWith([]);
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    try {
      await renderReactTestRoot(
        root,
        <RegistryContext.Provider value={registry}>
        <I18nProvider>
          <TeamAgents
            agentListRequestKey={0}
            board={null}
            error={null}
            isSidebarOpen={true}
            onIssueOpen={vi.fn()}
            onSettleTaskSession={vi.fn()}
            onStopSession={vi.fn().mockResolvedValue(true)}
            onStart={vi.fn().mockReturnValue("run-1")}
            onStartTaskSession={vi.fn()}
            project={project}
            requestedSessionId={null}
            token={null}
          />
        </I18nProvider>
        </RegistryContext.Provider>,
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
        <RegistryContext.Provider value={registry}>
        <I18nProvider>
          <TeamAgents
            agentListRequestKey={0}
            board={null}
            error={null}
            isSidebarOpen={true}
            onIssueOpen={vi.fn()}
            onSettleTaskSession={vi.fn()}
            onStopSession={vi.fn().mockResolvedValue(true)}
            onStart={vi.fn().mockReturnValue("run-1")}
            onStartTaskSession={vi.fn()}
            project={project}
            requestedSessionId={null}
            token={null}
          />
        </I18nProvider>
        </RegistryContext.Provider>,
      );
      expect(container.querySelector("#project-agent-detail")).not.toBeNull();
      expect(container.querySelector("#project-agents")).toBeNull();

      // When agentListRequestKey changes, should return to agent list
      await renderReactTestRoot(
        root,
        <RegistryContext.Provider value={registry}>
        <I18nProvider>
          <TeamAgents
            agentListRequestKey={1}
            board={null}
            error={null}
            isSidebarOpen={true}
            onIssueOpen={vi.fn()}
            onSettleTaskSession={vi.fn()}
            onStopSession={vi.fn().mockResolvedValue(true)}
            onStart={vi.fn().mockReturnValue("run-1")}
            onStartTaskSession={vi.fn()}
            project={project}
            requestedSessionId={null}
            token={null}
          />
        </I18nProvider>
        </RegistryContext.Provider>,
      );
      expect(container.querySelector("#project-agents")).not.toBeNull();
      expect(container.querySelector("#project-agent-detail")).toBeNull();
    } finally {
      cleanup();
    }
  });
});
