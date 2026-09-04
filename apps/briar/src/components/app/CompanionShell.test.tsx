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
import { companionPageAtom } from "../../state/navigation/atoms";
import {
  activeShellAtom,
  keptPageKeysAtom,
} from "../../state/navigation/keep-alive";
import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../../state/organization/atoms";
import { createTestRegistry, type AtomRegistry } from "../../state/registry";
import { tokenAtom, userAtom } from "../../state/session/atoms";
import { applySyncEvent } from "../../state/sync/apply";
import { activeTeamIdAtom, teamsAtom } from "../../state/team/atoms";
import {
  createReactTestRoot,
  flush,
  settle,
  visibleText,
} from "../../test/react";
import { createRenderCounter } from "../../test/render-count";
import {
  demoOrganization,
  demoUser,
} from "../../state/demo-fixtures";
import type { DashboardPayload, HuntRun } from "../../types";
import {
  CompanionShell,
  type CompanionShellProps,
} from "./CompanionShell";

/*
  The phone shell, rendered against a demo session.

  It is a smoke test on purpose: what changed in Phase 5 is where the shell
  lives, not what it draws, so the cases check that the header and the issue
  board come up, that the companion page atom still switches surfaces, and that
  a run edit does not push a render through the shell.

  The last case counts with `renders.profile`, which sees a render an atom
  pushed into the shell — `track` only sees the ones a parent pushed, and after
  follow-up F2 there is no parent left to push one. It counts the shell's whole
  subtree, so it is measured on the inbox page: the board is *supposed* to
  redraw a card for a run change, and on the issues page that would be
  indistinguishable from the shell itself waking up.
*/

const team = demoDashboard.team;

const run: HuntRun = {
  ...demoDashboard.runs[0]!,
  id: "run-1",
  title: "Companion issue",
};

const payload: DashboardPayload = {
  ...demoDashboard,
  runs: [run],
  cursor: 1,
  generatedAt: "2026-09-01T00:00:00.000Z",
};

const props: CompanionShellProps = {
  agents: [],
  loadTeamHomeUsage: createCachedTeamUsageSummaryLoader(async () => null),
};

const renderCounter = createRenderCounter();
const TrackedShell = renderCounter.track("shell", CompanionShell);

const harness = (): AtomRegistry => {
  const registry = createTestRegistry([
    [userAtom, demoUser],
    [tokenAtom, "token-1"],
    [teamsAtom, [team]],
    [activeTeamIdAtom, team.id],
    [organizationsAtom, [demoOrganization]],
    [activeOrganizationIdAtom, demoOrganization.id],
    // A vitest run is not a companion build, so the shell constant says
    // "desktop". The phone chain is what these cases are about.
    [activeShellAtom, "companion"],
  ]);
  applySyncEvent(registry, {
    kind: "team-snapshot",
    teamId: team.id,
    payload,
  });
  return registry;
};

const mount = async (registry: AtomRegistry) => {
  const view = createReactTestRoot({ attachToDocument: true });
  await view.render(
    <RegistryContext.Provider value={registry}>
      <I18nProvider>
        <AppKeyboardCommandProvider>
          <ToastProvider>
            <TooltipProvider>
              <TrackedShell {...props} />
            </TooltipProvider>
          </ToastProvider>
        </AppKeyboardCommandProvider>
      </I18nProvider>
    </RegistryContext.Provider>,
  );
  await flush();
  return view;
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.setItem("briar.locale.v1", "en");
  document.body.replaceChildren();
  renderCounter.reset();
});

describe("CompanionShell", () => {
  it("renders the header and the issue board", async () => {
    const registry = harness();
    const view = await mount(registry);
    await settle(
      () => view.container.querySelector(".companion-shell") !== null,
    );
    expect(view.container.querySelector(".companion-shell")).not.toBeNull();
    await settle(() => view.container.textContent?.includes(run.title) === true);
    expect(view.container.textContent).toContain(run.title);
    await view.cleanup();
  });

  it("switches surface with the companion page atom", async () => {
    const registry = harness();
    const view = await mount(registry);
    await settle(() => view.container.textContent?.includes(run.title) === true);
    const board = view.container.querySelector<HTMLElement>(
      '[data-page-slot^="board:"]',
    )?.firstElementChild;
    expect(board).toBeTruthy();

    await act(async () => {
      registry.set(companionPageAtom, "inbox");
    });
    await settle(() => visibleText(view.container).includes(run.title) !== true);
    // The board went off screen rather than away: the phone keeps it, so the
    // task list is where it was when the user comes back to it.
    expect(visibleText(view.container)).not.toContain(run.title);
    expect(view.container.textContent).toContain(run.title);

    await act(async () => {
      registry.set(companionPageAtom, "issues");
    });
    await settle(() => visibleText(view.container).includes(run.title));
    expect(
      view.container.querySelector<HTMLElement>('[data-page-slot^="board:"]')
        ?.firstElementChild,
    ).toBe(board);
    expect(registry.get(keptPageKeysAtom)).toEqual([
      `inbox:${demoOrganization.id}`,
      `board:${team.id}`,
    ]);

    await view.cleanup();
  });

  it("hides every kept page while a page that is not kept is open", async () => {
    const registry = harness();
    const view = await mount(registry);
    await settle(() => view.container.textContent?.includes(run.title) === true);

    await act(async () => {
      registry.set(companionPageAtom, "settings");
    });
    await settle(() => visibleText(view.container).includes(run.title) !== true);

    // Settings unmounts on leave and is drawn by the chain, not a slot, so
    // every slot is off screen — and the board is still one of them.
    const slots = [...view.container.querySelectorAll("[data-page-slot]")];
    expect(slots).toHaveLength(1);
    expect(slots.every((slot) => slot.hasAttribute("inert"))).toBe(true);
    expect(registry.get(keptPageKeysAtom)).toEqual([`board:${team.id}`]);

    await view.cleanup();
  });

  it("renders nothing without a signed-in user", async () => {
    const registry = createTestRegistry([[userAtom, null]]);
    const view = await mount(registry);
    expect(view.container.textContent).toBe("");
    await view.cleanup();
  });

  it("does not re-render when a run changes", async () => {
    const registry = harness();
    const view = await mount(registry);
    await settle(() => view.container.textContent?.includes(run.title) === true);
    renderCounter.reset();

    await act(async () => {
      applySyncEvent(registry, {
        kind: "run-changed",
        teamId: team.id,
        run: { ...run, title: "Companion issue edited" },
      });
    });
    await settle(
      () =>
        view.container.textContent?.includes("Companion issue edited") === true,
    );
    expect(view.container.textContent).toContain("Companion issue edited");
    // The board read the change itself; nothing was pushed through the shell.
    renderCounter.expectRenderCounts({});
    await view.cleanup();
  });

  it("subscribes to no run of its own", async () => {
    const registry = harness();
    registry.set(companionPageAtom, "inbox");
    const renders = createRenderCounter();
    const view = createReactTestRoot({ attachToDocument: true });
    await view.render(
      <RegistryContext.Provider value={registry}>
        <I18nProvider>
          <AppKeyboardCommandProvider>
            <ToastProvider>
              <TooltipProvider>
                {renders.profile("companion-shell", <CompanionShell {...props} />)}
              </TooltipProvider>
            </ToastProvider>
          </AppKeyboardCommandProvider>
        </I18nProvider>
      </RegistryContext.Provider>,
    );
    await flush();
    renders.reset();

    await act(async () => {
      applySyncEvent(registry, {
        kind: "run-changed",
        teamId: team.id,
        run: { ...run, title: "Companion issue edited again" },
      });
    });

    // The shell reads the team's workers, not its runs, so a run edit reaches
    // nothing inside it while the board is off screen.
    renders.expectRenderCounts({});
    await view.cleanup();
  });
});
