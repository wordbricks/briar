/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { App } from "./App";
import { AppKeyboardCommandProvider } from "./hooks/appKeyboardCommands";
import { I18nProvider } from "./i18n";
import { TooltipProvider } from "./components/ui/tooltip";
import { ToastProvider } from "./components/ui/toast";
import { demoDashboard } from "./lib/demo-data";
import { initialOnboardingStorageKey } from "./lib/initial-onboarding";
import { launchIntroStorageKey } from "./lib/launch-intro";
import { createTestRegistry, type AtomRegistry } from "./state/registry";
import { activeOrganizationIdAtom, organizationsAtom } from "./state/organization/atoms";
import {
  restoringSessionAtom,
  loadingAtom,
  tokenAtom,
  userAtom,
} from "./state/session/atoms";
import { applySyncEvent } from "./state/sync/apply";
import { teamSyncApiAtom } from "./state/sync/loader";
import { activeTeamIdAtom, teamsAtom } from "./state/team/atoms";
import { createReactTestRoot } from "./test/react";
import { createRenderCounter } from "./test/render-count";
import type {
  DashboardPayload,
  HuntRun,
  Organization,
  Project,
  SessionUser,
} from "./types";

/*
  What a run change costs the app shell.

  Phase 5 fixed the gate and the shells at zero renders per run change, but
  `App` itself still counted one: the facade subscribed to the open board and
  `useInbox` took it as an argument. Both moved — the board is `InboxBridge`'s
  and the inbox is published to `state/inbox` — so this pins the whole chain
  above the page slot at zero.

  Everything below the shell is the shells' own tests; what this one asserts is
  that nothing *between* the store and the board re-renders on the way.
*/

const user: SessionUser = {
  id: "user-1",
  name: "Tester",
  email: "tester@briar.local",
};

const organization: Organization = {
  id: demoDashboard.team.organizationId,
  name: demoDashboard.team.organizationName,
  handle: "org-a",
  logo: null,
  role: "owner",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const team: Project = { ...demoDashboard.team, id: "team-a", name: "team-a" };

const run: HuntRun = {
  ...demoDashboard.runs[0]!,
  id: "run-1",
  title: "Fix the thing",
  teamId: team.id,
};

const payload: DashboardPayload = {
  ...demoDashboard,
  team,
  runs: [run],
  cursor: 1,
  generatedAt: "2026-09-01T00:00:00.000Z",
};

const renderCounter = createRenderCounter();
const TrackedApp = renderCounter.track("app", App);

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

const harness = (): AtomRegistry => {
  const registry = createTestRegistry([
    [userAtom, user],
    [tokenAtom, "token-1"],
    [restoringSessionAtom, false],
    [loadingAtom, false],
    [teamsAtom, [team]],
    [activeTeamIdAtom, team.id],
    [organizationsAtom, [organization]],
    [activeOrganizationIdAtom, organization.id],
    // The board is already loaded, so no fetch has to settle before the
    // counters mean anything.
    [
      teamSyncApiAtom,
      {
        loadDashboard: (async () => payload) as never,
        loadDashboardDelta: (async () => {
          throw new Error("unexpected delta");
        }) as never,
      },
    ],
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
              <TrackedApp />
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
  window.localStorage.clear();
  window.localStorage.setItem("briar.locale.v1", "en");
  // A returning account: neither the initial onboarding gate nor the launch
  // intro is due, so what mounts is the steady state this is measuring.
  window.localStorage.setItem(initialOnboardingStorageKey, "true");
  window.localStorage.setItem(launchIntroStorageKey, "true");
  document.body.replaceChildren();
  renderCounter.reset();
});

describe("App", () => {
  it("renders the desktop shell for a signed-in account", async () => {
    const registry = harness();
    const view = await mount(registry);
    await settle(() => view.container.textContent?.includes(run.title) === true);
    expect(view.container.textContent).toContain(run.title);
    await view.cleanup();
  });

  it("does not re-render for a run change", async () => {
    const registry = harness();
    const view = await mount(registry);
    await settle(() => view.container.textContent?.includes(run.title) === true);
    // The counter is wired to the component under test, so a zero below means
    // "did not render" rather than "was never counted".
    expect(renderCounter.count("app")).toBeGreaterThan(0);
    renderCounter.reset();

    await act(async () => {
      applySyncEvent(registry, {
        kind: "run-changed",
        teamId: team.id,
        run: { ...run, title: "Fix the other thing" },
      });
    });
    await settle(
      () =>
        view.container.textContent?.includes("Fix the other thing") === true,
    );

    expect(view.container.textContent).toContain("Fix the other thing");
    // The board read the change itself. Nothing between the store and it —
    // not the app, not the gate, not the shell — subscribes to a run.
    expect(renderCounter.count("app")).toBe(0);
    await view.cleanup();
  });
});
