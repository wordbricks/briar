/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { Suspense, act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../../i18n";
import { demoDashboard, demoRepositoryReadiness } from "../../lib/demo-data";
import { createTestRegistry, type AtomRegistry } from "../../state/registry";
import { tokenAtom, userAtom } from "../../state/session/atoms";
import { applySyncEvent } from "../../state/sync/apply";
import { activeTeamIdAtom, teamsAtom } from "../../state/team/atoms";
import {
  connectedTeamIdsAtom,
  healthAtom,
  teamReadinessAtom,
} from "../../state/workspace/atoms";
import { createReactTestRoot, type ReactTestRoot } from "../../test/react";
import { createRenderCounter } from "../../test/render-count";
import type { DashboardPayload, Project, SessionUser } from "../../types";
import {
  ConnectionHealthWithWorkspace,
  TeamRepositorySetupDialogWithWorkspace,
} from "./WorkspaceViews";

/*
  What Phase 3 promises the workspace views.

  The health probe was three `useState`s on `useBriar`, so every probe rendered
  the app shell and everything the shell drew. The shell now renders zero times
  and only the view that displays the probe updates.

  That pair is asserted as "the shell's counter did not move and this view's
  output did", because `renderCounter.track` only sees the renders a parent
  pushes in — and a view re-rendering from its own subscription is precisely
  what is being checked here.
*/

const user: SessionUser = {
  id: "user-1",
  name: "Tester",
  email: "tester@briar.local",
};

const teamOf = (id: string): Project => ({ ...demoDashboard.team, id, name: id });
const teamA = teamOf("team-a");
const teamB = teamOf("team-b");

const snapshot: DashboardPayload = {
  ...demoDashboard,
  team: teamA,
  runs: [],
  cursor: 1,
  generatedAt: "2026-09-01T00:00:00.000Z",
};

const harness = () => {
  const registry: AtomRegistry = createTestRegistry([
    [userAtom, user],
    [tokenAtom, "token-1"],
    [teamsAtom, [teamA, teamB]],
    [activeTeamIdAtom, teamA.id],
    [connectedTeamIdsAtom, [teamA.id, teamB.id]],
  ]);
  applySyncEvent(registry, {
    kind: "team-snapshot",
    teamId: teamA.id,
    payload: snapshot,
  });
  return registry;
};

/** Settles React's work and whatever promises it is waiting on. */
const flush = async (attempts = 5) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

/**
 * Waits for the `lazy()` boundaries these wrappers hold: a first paint waits on
 * a module load, so a fixed number of ticks is not enough. The bound is
 * generous because the wait is over a module load the whole suite competes
 * for — a loaded machine resolves it late, not never — and an already painted
 * view returns on the first attempt regardless.
 */
const paint = async (view: ReactTestRoot) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if ((view.container.textContent ?? "") !== "") return;
    await flush(1);
  }
  throw new Error("The lazy workspace views never painted");
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

describe("workspace view wrappers", () => {
  it("shows a health probe without re-rendering the shell", async () => {
    const registry = harness();
    const renders = createRenderCounter();
    const view = createReactTestRoot({ attachToDocument: true });

    function AppShell() {
      // Stands in for App.tsx: it owns the navigation callbacks and subscribes
      // to none of the atoms these views render from.
      renders.useRenderCount("shell");
      return (
        <>
          <ConnectionHealthWithWorkspace onReconnect={() => undefined} />
          <TeamRepositorySetupDialogWithWorkspace
            onClose={() => undefined}
            teamId={teamB.id}
          />
        </>
      );
    }

    await view.render(
      <RegistryContext.Provider value={registry}>
        <I18nProvider>
          <Suspense fallback={null}>
            <AppShell />
          </Suspense>
        </I18nProvider>
      </RegistryContext.Provider>,
    );
    await paint(view);
    renders.reset();
    const before = view.container.textContent ?? "";

    await act(async () => {
      registry.set(healthAtom, {
        status: "ready",
        value: { projectId: teamA.id, healthy: true } as never,
        error: null,
      });
    });
    await flush();

    // The shell that used to own the probe never hears about it…
    renders.expectRenderCounts({});
    // …and the indicator that displays it did re-render.
    expect(view.container.textContent).not.toBe(before);

    await view.cleanup();
  });

  it("keeps one team's readiness probe out of another team's dialog", async () => {
    const registry = harness();
    const renders = createRenderCounter();
    const view = createReactTestRoot({ attachToDocument: true });

    function AppShell() {
      renders.useRenderCount("shell");
      return (
        <TeamRepositorySetupDialogWithWorkspace
          onClose={() => undefined}
          teamId={teamB.id}
        />
      );
    }

    await view.render(
      <RegistryContext.Provider value={registry}>
        <I18nProvider>
          <Suspense fallback={null}>
            <AppShell />
          </Suspense>
        </I18nProvider>
      </RegistryContext.Provider>,
    );
    await paint(view);
    renders.reset();
    const before = view.container.textContent ?? "";

    // Another team's probe. The record shaped `useState`s this family replaced
    // notified every reader on every probe.
    await act(async () => {
      registry.set(teamReadinessAtom(teamA.id), {
        readiness: demoRepositoryReadiness,
        error: null,
        loading: false,
      });
    });
    await flush();
    renders.expectRenderCounts({});
    expect(view.container.textContent).toBe(before);

    // This team's own probe does reach it.
    await act(async () => {
      registry.set(teamReadinessAtom(teamB.id), {
        readiness: demoRepositoryReadiness,
        error: null,
        loading: false,
      });
    });
    await flush();
    renders.expectRenderCounts({});
    expect(view.container.textContent).not.toBe(before);

    await view.cleanup();
  });
});
