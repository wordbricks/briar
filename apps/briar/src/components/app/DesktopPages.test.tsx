/** @vitest-environment jsdom */

import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../../i18n";
import { AppKeyboardCommandProvider } from "../../hooks/appKeyboardCommands";
import { ToastProvider } from "../ui/toast";
import { TooltipProvider } from "../ui/tooltip";
import { demoDashboard } from "../../lib/demo-data";
import { createCachedTeamUsageSummaryLoader } from "../../lib/team-usage-summary";
import { demoOrganization, demoUser } from "../../state/demo-fixtures";
import { createNavigationActions } from "../../state/navigation/actions";
import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../../state/organization/atoms";
import { createTestRegistry, type AtomRegistry } from "../../state/registry";
import { tokenAtom, userAtom } from "../../state/session/atoms";
import { applySyncEvent } from "../../state/sync/apply";
import { activeTeamIdAtom, teamsAtom } from "../../state/team/atoms";
import { healthAtom } from "../../state/workspace/atoms";
import { createReactTestRoot } from "../../test/react";
import { createRenderCounter } from "../../test/render-count";
import { DesktopPages, type DesktopPagesProps } from "./DesktopPages";
import { SidebarWithSession } from "./SidebarWithSession";
import { ConnectionHealthWithWorkspace } from "./WorkspaceViews";
import type { DashboardPayload, HuntRun } from "../../types";

/*
  Who a visit reaches.

  `DesktopPages` and `SidebarWithSession` subscribe to the navigation location;
  the shell around them — which owns their callbacks — subscribes to nothing
  that a visit moves. This renders that arrangement with the shell as a counted
  stand-in, walks from one page to another, and asserts that both connected
  views followed while the stand-in and an unrelated wrapper never rendered
  again.
*/

const team = demoDashboard.team;

const run: HuntRun = {
  ...demoDashboard.runs[0]!,
  id: "run-1",
  title: "Desktop issue",
};

const payload: DashboardPayload = {
  ...demoDashboard,
  runs: [run],
  cursor: 1,
  generatedAt: "2026-09-01T00:00:00.000Z",
};

const noop = () => undefined;

const pageProps: DesktopPagesProps = {
  activeProject: team,
  agents: {
    activeTeamAgents: [],
    all: [],
    processingIssueIds: new Set<string>(),
    rememberAgent: noop,
  },
  autoHunt: {
    adoptRemoteSession: () => "session-1",
    removeProjectSessions: noop,
    sessions: [],
    settleTaskSession: noop,
    startTaskSession: () => "session-1",
    stopSession: async () => true,
  },
  loadOrganizationProjectDashboard: async () => null,
  loadProjectHomeMerges: async () => ({
    repository: "wordbricks/briar",
    generatedAt: "2026-09-01T00:00:00.000Z",
    pullRequests: [],
  }),
  loadProjectHomeUsage: createCachedTeamUsageSummaryLoader(async () => null),
  loadUsageReport: async () => ({
    runs: [],
    generatedAt: "2026-09-01T00:00:00.000Z",
    pricing: {
      status: "unavailable" as const,
      source: "test",
      fetchedAt: null,
      knownModels: 0,
    },
  }),
  openOrganizationIssue: noop,
  repositorySetup: {
    beginTeamReconnect: noop,
    closeRepositorySetup: noop,
    openTeamRepository: noop,
    repositorySetupTeamId: null,
  },
  startAgentAutoHunt: async () => "dispatch-1",
  startProjectAgentTask: async () => "session-1",
};

const sidebarProps = {
  agents: [],
  onAddOrganization: noop,
  onAddPlanningProject: noop,
  onAddProject: noop,
  onAgentSessionOpen: noop,
  onAgentsOpen: noop,
  onCreateIssue: noop,
  onInboxOpen: noop,
  onIssuesOpen: noop,
  onLobbyOpen: noop,
  onLogout: noop,
  onOrganizationChange: noop,
  onPlanningProjectEdit: noop,
  onPlanningProjectOpen: noop,
  onProjectChange: noop,
  onProjectRepositoryOpen: noop,
  onProjectSettings: noop,
  onScheduleOpen: noop,
  onSettings: noop,
  sessions: [],
  unreadInboxCount: 0,
};

const flush = async (attempts = 6) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

const settle = async (check: () => boolean) => {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (check()) return;
    await flush(1);
  }
};

const currentSidebarPages = (container: HTMLElement) =>
  [...container.querySelectorAll('[aria-current="page"]')].map(
    (element) => element.textContent?.trim() ?? "",
  );

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.setItem("briar.locale.v1", "en");
  // The agents page is behind a `lazy()` boundary; importing it up front lets
  // the visit below resolve inside an `act` flush.
  await import("../TeamAgents");
});

describe("desktop page slot", () => {
  it("moves the sidebar and the page on a visit, and nothing else", async () => {
    const registry: AtomRegistry = createTestRegistry([
      [userAtom, demoUser],
      [tokenAtom, "token-1"],
      [teamsAtom, [team]],
      [activeTeamIdAtom, team.id],
      [organizationsAtom, [demoOrganization]],
      [activeOrganizationIdAtom, demoOrganization.id],
    ]);
    applySyncEvent(registry, {
      kind: "team-snapshot",
      teamId: team.id,
      payload,
    });
    const actions = createNavigationActions(registry);
    actions.resetNavigation("issues");
    const renders = createRenderCounter();

    function ConnectionHealthProbe() {
      // The health wrapper's own subscription, counted here because a visit
      // must not disturb it.
      renders.record("connection-health", useAtomValue(healthAtom));
      return <ConnectionHealthWithWorkspace onReconnect={noop} />;
    }

    function AppShell() {
      // Stands in for `App` and `DesktopShell`: it owns the callbacks below and
      // subscribes to nothing the navigation moves, which is what both do.
      renders.useRenderCount("shell");
      return (
        <>
          <SidebarWithSession {...sidebarProps} />
          <DesktopPages {...pageProps} />
          <ConnectionHealthProbe />
        </>
      );
    }

    const view = createReactTestRoot({ attachToDocument: true });
    await view.render(
      <RegistryContext.Provider value={registry}>
        <I18nProvider>
          <AppKeyboardCommandProvider>
            <ToastProvider>
              <TooltipProvider>
                <AppShell />
              </TooltipProvider>
            </ToastProvider>
          </AppKeyboardCommandProvider>
        </I18nProvider>
      </RegistryContext.Provider>,
    );
    await settle(() => view.container.textContent?.includes(run.title) === true);
    expect(currentSidebarPages(view.container)).toContain("Issues");
    renders.reset();

    await act(async () => {
      actions.navigateToPage("agents", team.id);
    });
    await settle(() =>
      view.container.textContent?.includes("Agent list") === true
    );

    // The page slot swapped the board for the agents page…
    expect(view.container.textContent).toContain("Agent list");
    expect(view.container.textContent).not.toContain(run.title);
    // …and the sidebar followed the same location.
    expect(currentSidebarPages(view.container)).toContain("Agents");
    expect(currentSidebarPages(view.container)).not.toContain("Issues");
    // Neither the shell that owns their callbacks nor the health wrapper beside
    // them rendered again.
    renders.expectRenderCounts({});

    await view.cleanup();
  });
});
