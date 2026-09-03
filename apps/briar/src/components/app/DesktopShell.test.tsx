/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../../i18n";
import { AppKeyboardCommandProvider } from "../../hooks/appKeyboardCommands";
import { ToastProvider } from "../ui/toast";
import { TooltipProvider } from "../ui/tooltip";
import { demoDashboard } from "../../lib/demo-data";
import { createCachedTeamUsageSummaryLoader } from "../../lib/team-usage-summary";
import { demoOrganization, demoUser } from "../../state/demo-fixtures";
import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../../state/organization/atoms";
import { createTestRegistry, type AtomRegistry } from "../../state/registry";
import { tokenAtom, userAtom } from "../../state/session/atoms";
import { applySyncEvent } from "../../state/sync/apply";
import { activeTeamIdAtom, teamsAtom } from "../../state/team/atoms";
import { createReactTestRoot } from "../../test/react";
import { createRenderCounter } from "../../test/render-count";
import type { DashboardPayload, HuntRun } from "../../types";
import { DesktopShell, type DesktopShellProps } from "./DesktopShell";

/*
  The desktop shell, rendered against a demo session.

  What Phase 5 changed is where the shell lives, not what it draws, so these
  are smoke cases: the frame and the issue board come up, the page chain follows
  `activePage`, and a run edit reaches the board without the shell rendering
  again — which is what the app's props no longer carrying the payload buys.
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

const navigation: DesktopShellProps["navigation"] = {
  activePage: "issues",
  activeProjectForTabs: team,
  canGoBack: false,
  canGoForward: false,
  closeSettings: () => undefined,
  desktopActiveChannelId: null,
  goBack: () => undefined,
  goForward: () => undefined,
  goToNavigationHistory: () => undefined,
  handleDesktopChannelFallback: () => undefined,
  navigateToChannel: () => undefined,
  navigateToIssue: () => undefined,
  navigateToLocation: () => undefined,
  navigateToPage: () => undefined,
  navigationHistoryIndex: 0,
  navigationHistoryItems: [],
  navigationProjectId: team.id,
  replaceNavigationLocation: () => undefined,
  resetNavigation: () => undefined,
  selectedRunId: null,
  setDefaultTeam: () => undefined,
};

const props: DesktopShellProps = {
  activeProject: team,
  agents: {
    activeTeamAgents: [],
    all: [],
    processingIssueIds: new Set<string>(),
    rememberAgent: () => undefined,
  },
  autoHunt: {
    adoptRemoteSession: () => "session-1",
    removeProjectSessions: () => undefined,
    sessions: [],
    settleTaskSession: () => undefined,
    startTaskSession: () => "session-1",
    stopSession: async () => true,
  },
  channelInboxSyncSignal: "",
  conversationInboxSyncSignal: "",
  inbox: {
    allMessages: [],
    markAllRead: () => undefined,
    markIssueRead: () => undefined,
    markRead: () => undefined,
    markUnread: () => undefined,
    messages: [],
    unreadCount: 0,
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
  navigation,
  openAppSettings: () => undefined,
  openOrganizationIssue: () => undefined,
  openProjectInNewWindow: async () => undefined,
  repositorySetup: {
    beginTeamReconnect: () => undefined,
    closeRepositorySetup: () => undefined,
    openTeamRepository: () => undefined,
    repositorySetupTeamId: null,
  },
  session: {
    deleteAccount: async () => undefined,
    ensureTeamSelected: async () => undefined,
    logout: async () => undefined,
    refresh: async () => undefined,
    selectTeam: () => undefined,
    updateAccountProfile: async () => demoUser,
  },
  startAgentAutoHunt: async () => "dispatch-1",
  startProjectAgentTask: async () => "session-1",
};

const renderCounter = createRenderCounter();
const TrackedShell = renderCounter.track("shell", DesktopShell);

const flush = async (attempts = 6) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

const settle = async (check: () => boolean) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (check()) return;
    await flush(1);
  }
};

const harness = (): AtomRegistry => {
  const registry = createTestRegistry([
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
  return registry;
};

const mount = async (
  registry: AtomRegistry,
  overrides: Partial<DesktopShellProps> = {},
) => {
  document.body.replaceChildren();
  const view = createReactTestRoot({ attachToDocument: true });
  const render = (next: Partial<DesktopShellProps>) =>
    view.render(
      <RegistryContext.Provider value={registry}>
        <I18nProvider>
          <AppKeyboardCommandProvider>
            <ToastProvider>
              <TooltipProvider>
                <TrackedShell {...props} {...next} />
              </TooltipProvider>
            </ToastProvider>
          </AppKeyboardCommandProvider>
        </I18nProvider>
      </RegistryContext.Provider>,
    );
  await render(overrides);
  await flush();
  return { render, view };
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.setItem("briar.locale.v1", "en");
  renderCounter.reset();
});

describe("DesktopShell", () => {
  it("renders the frame, the sidebar and the issue board", async () => {
    const registry = harness();
    const { view } = await mount(registry);
    await settle(
      () => view.container.querySelector(".desktop-app-frame") !== null,
    );
    expect(view.container.querySelector(".desktop-app-frame")).not.toBeNull();
    expect(view.container.querySelector(".app-status-bar")).not.toBeNull();
    await settle(() => view.container.textContent?.includes(run.title) === true);
    expect(view.container.textContent).toContain(run.title);
    await view.cleanup();
  });

  it("hides the sidebar on the settings page", async () => {
    const registry = harness();
    const { render, view } = await mount(registry);
    await settle(() => view.container.textContent?.includes(run.title) === true);
    const sidebarBefore = view.container.querySelectorAll("nav").length;

    await render({
      navigation: { ...navigation, activePage: "settings" },
    });
    await flush(6);
    // The settings pages bring their own navigation column.
    expect(view.container.querySelectorAll("nav").length).not.toBe(
      sidebarBefore,
    );
    await view.cleanup();
  });

  it("does not re-render when a run changes", async () => {
    const registry = harness();
    const { view } = await mount(registry);
    await settle(() => view.container.textContent?.includes(run.title) === true);
    renderCounter.reset();

    await act(async () => {
      applySyncEvent(registry, {
        kind: "run-changed",
        teamId: team.id,
        run: { ...run, title: "Desktop issue edited" },
      });
    });
    await settle(
      () =>
        view.container.textContent?.includes("Desktop issue edited") === true,
    );
    expect(view.container.textContent).toContain("Desktop issue edited");
    // The board read the change itself; nothing was pushed through the shell.
    renderCounter.expectRenderCounts({});
    await view.cleanup();
  });
});
