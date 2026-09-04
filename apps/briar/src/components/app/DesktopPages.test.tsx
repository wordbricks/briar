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
import { runAtom } from "../../state/entities/runs";
import { createTestRegistry, type AtomRegistry } from "../../state/registry";
import { tokenAtom, userAtom } from "../../state/session/atoms";
import { applySyncEvent } from "../../state/sync/apply";
import {
  activeTeamIdAtom,
  teamSettingsAtom,
  teamsAtom,
} from "../../state/team/atoms";
import { healthAtom } from "../../state/workspace/atoms";
import {
  createReactTestRoot,
  flush,
  settle,
  settleLazy,
  visibleText,
} from "../../test/react";
import {
  createRenderCounter,
  type RenderCounter,
} from "../../test/render-count";
import { inboxMessagesAtom } from "../../state/inbox/atoms";
import { DesktopPages, type DesktopPagesProps } from "./DesktopPages";
import { SidebarWithSession } from "./SidebarWithSession";
import { WindowNavigationControlsWithHistory } from "./WindowNavigationControlsWithHistory";
import { ConnectionHealthWithWorkspace } from "./WorkspaceViews";
import type { DashboardPayload, HuntRun } from "../../types";

/*
  Who a visit reaches, and who a sync event reaches.

  `DesktopPages` and `SidebarWithSession` subscribe to the navigation location;
  the shell around them — which owns their callbacks — subscribes to nothing
  that a visit moves. This renders that arrangement with the shell as a counted
  stand-in, walks from one page to another, and asserts that both connected
  views followed while the stand-in and an unrelated wrapper never rendered
  again.

  The second and third cases are about the store rather than the location. They
  are counted with `renders.profile`, which sees a render an atom pushed into a
  component — `track` cannot, because its wrapper only re-renders when a parent
  hands it new props. It counts the whole subtree, so they are measured on the
  inbox page: a board on screen is *supposed* to redraw a card for a run
  change, and that would be indistinguishable from the page itself waking up.
  What is asserted is that a run change and a settings change reach nothing in
  the page, the window controls or the inbox bridge at all.
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
  agents: {
    activeTeamAgents: [],
    all: [],
    rememberAgent: noop,
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

const currentSidebarPages = (container: HTMLElement) =>
  [...container.querySelectorAll('[aria-current="page"]')].map(
    (element) => element.textContent?.trim() ?? "",
  );

/** One run's own subscriber, so a change that reaches nobody else is visible. */
function RunProbe({ renders }: { renders: RenderCounter }) {
  renders.useRenderCount("run-probe");
  const value = useAtomValue(runAtom(run.id));
  return <output>{value?.title ?? ""}</output>;
}

/** What the inbox derivation is allowed to be woken by. */
function InboxMessagesProbe() {
  const messages = useAtomValue(inboxMessagesAtom);
  return <output>{messages.length}</output>;
}

/** What a settings write is allowed to reach. */
function SettingsProbe({ renders }: { renders: RenderCounter }) {
  renders.useRenderCount("settings-probe");
  const settings = useAtomValue(teamSettingsAtom(team.id));
  return <output>{settings?.velenOrg ?? ""}</output>;
}

/**
 * The three subscription boundaries above the page slot, on the inbox page and
 * with nothing selected in it. Counting starts after the first paint.
 */
const mountInboxPage = async () => {
  const registry: AtomRegistry = createTestRegistry([
    [userAtom, demoUser],
    [tokenAtom, "token-1"],
    [teamsAtom, [team]],
    [activeTeamIdAtom, team.id],
    [organizationsAtom, [demoOrganization]],
    [activeOrganizationIdAtom, demoOrganization.id],
  ]);
  applySyncEvent(registry, { kind: "team-snapshot", teamId: team.id, payload });
  createNavigationActions(registry).resetNavigation("inbox");
  const renders = createRenderCounter();

  const view = createReactTestRoot({ attachToDocument: true });
  await view.render(
    <RegistryContext.Provider value={registry}>
      <I18nProvider>
        <AppKeyboardCommandProvider>
          <ToastProvider>
            <TooltipProvider>
              {renders.profile("desktop-pages", <DesktopPages {...pageProps} />)}
              {renders.profile(
                "window-controls",
                <WindowNavigationControlsWithHistory />,
              )}
              {renders.profile("inbox-messages", <InboxMessagesProbe />)}
              <RunProbe renders={renders} />
              <SettingsProbe renders={renders} />
            </TooltipProvider>
          </ToastProvider>
        </AppKeyboardCommandProvider>
      </I18nProvider>
    </RegistryContext.Provider>,
  );
  await settle(
    () => view.container.querySelector(".inbox-detail-pane") !== null,
  );
  renders.reset();
  return { registry, renders, view };
};

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.setItem("briar.locale.v1", "en");
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
    // …and put the board away rather than throwing it away: its DOM is still
    // there, held off screen by its slot.
    expect(visibleText(view.container)).not.toContain(run.title);
    expect(view.container.textContent).toContain(run.title);
    // …and the sidebar followed the same location.
    expect(currentSidebarPages(view.container)).toContain("Agents");
    expect(currentSidebarPages(view.container)).not.toContain("Issues");
    // Neither the shell that owns their callbacks nor the health wrapper beside
    // them rendered again.
    renders.expectRenderCounts({});

    await view.cleanup();
  });

  it("keeps a run change out of the page, the window controls and the bridge", async () => {
    const { registry, renders, view } = await mountInboxPage();

    await act(async () => {
      applySyncEvent(registry, {
        kind: "run-changed",
        teamId: team.id,
        run: { ...run, title: "Desktop issue edited" },
      });
    });

    /*
      The run's own subscriber saw it, and nothing else did: not the page (the
      inbox detail pane reads only the run its notification points at, and none
      is open), not the window's history popover (it labels only the runs the
      visit stack points at), and not the inbox derivation (a running run
      produces no message, so the source atom keeps the references it had).
    */
    renders.expectRenderCounts({ "run-probe": 1 });
    expect(registry.get(runAtom(run.id))?.title).toBe("Desktop issue edited");

    await view.cleanup();
  });

  it("keeps a settings change to the settings readers", async () => {
    const { registry, renders, view } = await mountInboxPage();

    await act(async () => {
      applySyncEvent(registry, {
        kind: "team-settings-changed",
        teamId: team.id,
        settings: { ...payload.settings, velenOrg: "wordbricks" },
      });
    });

    // Only what reads the settings. The page shows none of them here, and a
    // settings write is not a run.
    renders.expectRenderCounts({ "settings-probe": 1 });
    expect(registry.get(teamSettingsAtom(team.id))?.velenOrg).toBe(
      "wordbricks",
    );

    await view.cleanup();
  });
});

/*
  What a visit costs, before and after the slot.

  The board and the agents page make the pair: the board is kept and the agents
  page is not, so the same walk — away and back — is a reveal for one and a
  rebuild for the other, in the same render tree and counted the same way.
*/
describe("desktop page keep-alive", () => {
  const boardRoot = (container: HTMLElement) =>
    container.querySelector<HTMLElement>('[data-page-slot^="board:"]')
      ?.firstElementChild ?? null;

  /*
    Waits until the counted subtree stops committing on its own.

    The counter is over the whole subtree, so it also sees work a render left
    behind — a `lazy()` chunk still arriving, an effect's promise. Waiting for
    that to stop is what makes a later count mean "this visit did it" rather
    than "the machine was busy".
  */
  const quiesce = async (renders: RenderCounter) => {
    for (let attempt = 0; ; attempt += 1) {
      renders.reset();
      await flush(2);
      if (renders.count("pages") === 0) return;
      if (attempt >= 20) throw new Error("the page slot never went quiet");
    }
  };

  const mountIssuesPage = async (renders: RenderCounter) => {
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

    const view = createReactTestRoot({ attachToDocument: true });
    await view.render(
      <RegistryContext.Provider value={registry}>
        <I18nProvider>
          <AppKeyboardCommandProvider>
            <ToastProvider>
              <TooltipProvider>
                {renders.profile("pages", <DesktopPages {...pageProps} />)}
              </TooltipProvider>
            </ToastProvider>
          </AppKeyboardCommandProvider>
        </I18nProvider>
      </RegistryContext.Provider>,
    );
    await settle(() => visibleText(view.container).includes(run.title), {
      description: "the board to draw its first run",
    });
    await quiesce(renders);
    return { actions, view };
  };

  it("returns to the board as a reveal and to the agents page as a rebuild", async () => {
    const renders = createRenderCounter();
    const { actions, view } = await mountIssuesPage(renders);
    const board = boardRoot(view.container);
    expect(board).not.toBeNull();

    await act(async () => actions.navigateToPage("agents", team.id));
    await settle(() => visibleText(view.container).includes("Agent list"));
    const firstAgents = view.container.querySelector("#project-agents");
    expect(firstAgents).not.toBeNull();
    await quiesce(renders);

    await act(async () => actions.navigateToPage("issues", team.id));
    await settle(() => visibleText(view.container).includes(run.title));

    /*
      The board is the node it was — a reveal, not a rebuild. The same walk
      against the chain this replaced returned a different node, so the ~350
      elements the board had built were thrown away and made again; here the
      return is a couple of commits and no new element at all.
    */
    expect(boardRoot(view.container)).toBe(board);
    expect(renders.count("pages")).toBeLessThanOrEqual(4);
    // The agents page is gone, because nothing keeps it.
    expect(view.container.querySelector("#project-agents")).toBeNull();

    await act(async () => actions.navigateToPage("agents", team.id));
    await settle(() => visibleText(view.container).includes("Agent list"));
    // …and coming back to it built a new one, which is what every page did
    // before the slot.
    expect(view.container.querySelector("#project-agents")).not.toBe(
      firstAgents,
    );

    await view.cleanup();
  });

  it("does not show a kept page's lazy fallback twice", async () => {
    const renders = createRenderCounter();
    const { actions, view } = await mountIssuesPage(renders);
    const fallbacks = () =>
      view.container.querySelectorAll(".lazy-view-placeholder").length;

    await act(async () => actions.navigateToPage("my-issues"));
    await settle(() => fallbacks() === 0 && visibleText(view.container) !== "", {
      description: "my issues to come out of its lazy boundary",
    });
    const myIssues = view.container.querySelector<HTMLElement>(
      '[data-page-slot^="my-issues:"]',
    )?.firstElementChild;
    expect(myIssues).not.toBeNull();

    await act(async () => actions.navigateToPage("issues", team.id));
    await settle(() => visibleText(view.container).includes(run.title));

    await act(async () => actions.navigateToPage("my-issues"));
    // The chunk is loaded and the tree it built is still there, so there is
    // nothing to suspend on and no placeholder to flash.
    expect(fallbacks()).toBe(0);
    expect(
      view.container.querySelector<HTMLElement>(
        '[data-page-slot^="my-issues:"]',
      )?.firstElementChild,
    ).toBe(myIssues);

    await view.cleanup();
  });

  it("bounds the kept pages and drops them all when the organization changes", async () => {
    const renders = createRenderCounter();
    const { actions, view } = await mountIssuesPage(renders);
    const slotKeys = () =>
      [...view.container.querySelectorAll("[data-page-slot]")].map(
        (slot) => slot.getAttribute("data-page-slot") ?? "",
      );

    for (const page of ["inbox", "my-issues", "channels", "dms"] as const) {
      await act(async () => actions.navigateToPage(page));
      await settleLazy();
    }
    // Four heavy pages at most: the one on screen and the three before it.
    expect(slotKeys()).toHaveLength(4);
    expect(slotKeys()).not.toContain(`board:${team.id}`);

    await view.cleanup();
  });
});
