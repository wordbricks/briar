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
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../../state/organization/atoms";
import { createTestRegistry, type AtomRegistry } from "../../state/registry";
import { tokenAtom, userAtom } from "../../state/session/atoms";
import { applySyncEvent } from "../../state/sync/apply";
import { activeTeamIdAtom, teamsAtom } from "../../state/team/atoms";
import { createReactTestRoot } from "../../test/react";
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
  activeTeam: team,
  agents: [],
  loadTeamHomeUsage: createCachedTeamUsageSummaryLoader(async () => null),
  processingIssueIds: new Set<string>(),
  sessions: {
    adoptRemoteSession: () => "session-1",
    list: [],
    stopSession: async () => true,
  },
};

const renderCounter = createRenderCounter();
const TrackedShell = renderCounter.track("shell", CompanionShell);

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

    await act(async () => {
      registry.set(companionPageAtom, "inbox");
    });
    await settle(
      () => view.container.textContent?.includes(run.title) !== true,
    );
    expect(view.container.textContent).not.toContain(run.title);
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
