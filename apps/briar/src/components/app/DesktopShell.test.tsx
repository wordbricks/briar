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
import { settingsNavigationLocation } from "../../lib/app-navigation";
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
import { createReactTestRoot, flush, settle } from "../../test/react";
import { createRenderCounter } from "../../test/render-count";
import type { DashboardPayload, HuntRun } from "../../types";
import { DesktopShell, type DesktopShellProps } from "./DesktopShell";

/*
  The desktop shell, rendered against a demo session.

  What the refactors changed is where the shell lives and where it reads from,
  not what it draws, so these are smoke cases: the frame and the issue board
  come up, the page chain follows the navigation location, and a run edit
  reaches the board without the shell rendering again — which is what the app's
  props no longer carrying the payload buys.
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

const props: DesktopShellProps = {
  activeProject: team,
  agents: {
    activeTeamAgents: [],
    all: [],
    rememberAgent: () => undefined,
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
  openOrganizationIssue: () => undefined,
  openProjectInNewWindow: async () => undefined,
  repositorySetup: {
    beginTeamReconnect: () => undefined,
    closeRepositorySetup: () => undefined,
    openTeamRepository: () => undefined,
    repositorySetupTeamId: null,
  },
  startAgentAutoHunt: async () => "dispatch-1",
  startProjectAgentTask: async () => "session-1",
};

const renderCounter = createRenderCounter();
const TrackedShell = renderCounter.track("shell", DesktopShell);

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
  // The shell reads where it is from the store, so the harness puts it on the
  // issue board the same way a visit would.
  createNavigationActions(registry).navigateToPage("issues", team.id);
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
    const { view } = await mount(registry);
    await settle(() => view.container.textContent?.includes(run.title) === true);
    const sidebarBefore = view.container.querySelectorAll("nav").length;

    await act(async () => {
      createNavigationActions(registry).navigateToLocation(
        settingsNavigationLocation({
          scope: "application",
          section: "account",
        }),
      );
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
