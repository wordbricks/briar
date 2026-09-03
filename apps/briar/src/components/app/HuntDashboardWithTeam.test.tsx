/** @vitest-environment jsdom */

import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { ToastProvider } from "../ui/toast";
import { TooltipProvider } from "../ui/tooltip";
import { demoDashboard } from "../../lib/demo-data";
import { runAtom } from "../../state/entities/runs";
import { createTestRegistry, type AtomRegistry } from "../../state/registry";
import { tokenAtom, userAtom } from "../../state/session/atoms";
import { applySyncEvent } from "../../state/sync/apply";
import { activeTeamIdAtom, teamsAtom } from "../../state/team/atoms";
import { createReactTestRoot } from "../../test/react";
import { createRenderCounter, type RenderCounter } from "../../test/render-count";
import type {
  DashboardDeltaPayload,
  DashboardPayload,
  HuntRun,
  Project,
  SessionUser,
} from "../../types";
import { HuntDashboardWithTeam } from "./HuntDashboardWithTeam";

/*
  What Phase 2 promises the board, checked by counting renders.

  1. A polling tick whose delta changes nothing renders nothing again — not the
     shell that owns the board's callbacks, not the board, not a row.
  2. A change to one run reaches that run's `runAtom` subscriber and nobody
     else's, and never reaches the shell.

  What is still not true is the board's *own* subtree for (2): it draws a card
  per run, so it reads the runs and not only their ids and renders again with
  them. Pushing its filtering and grouping onto derived atoms — the step that
  would make the list itself id-only — is left to a follow-up; it is a rewrite
  of the board rather than a change of where its data comes from.
*/

const user: SessionUser = {
  id: "user-1",
  name: "Tester",
  email: "tester@briar.local",
};

const team: Project = { ...demoDashboard.team, id: "team-a", name: "Team A" };

const runOf = (id: string, title: string): HuntRun => ({
  ...demoDashboard.runs[0]!,
  id,
  runNumber: Number(id.replace(/\D/g, "")) || 1,
  title,
  teamId: team.id,
  updatedAt: "2026-09-01T00:00:00.000Z",
});

const runA = runOf("run-a", "첫 번째 이슈");
const runB = runOf("run-b", "두 번째 이슈");

const snapshot: DashboardPayload = {
  ...demoDashboard,
  team,
  runs: [runA, runB],
  cursor: 1,
  generatedAt: "2026-09-01T00:00:00.000Z",
};

/** A delta page that moves the cursor and nothing else. */
const quietDelta: DashboardDeltaPayload = {
  reset: false,
  cursor: 2,
  hasMore: false,
  runs: [],
  deletedRunIds: [],
  workers: snapshot.workers ?? [],
  organizationProviders: snapshot.organizationProviders ?? [],
  generatedAt: "2026-09-01T00:01:00.000Z",
};

const boardProps = {
  error: null,
  isSidebarOpen: true,
  onDeleteIssue: async () => undefined,
  onSendIssueMessage: async () => {
    throw new Error("not implemented in this test");
  },
};

/** One board row: it subscribes to its own run and to nothing else. */
function RunRow({
  name,
  renders,
  runId,
}: {
  name: string;
  renders: RenderCounter;
  runId: string;
}) {
  renders.useRenderCount(name);
  const run = useAtomValue(runAtom(runId));
  return <output>{run?.title ?? ""}</output>;
}

const harness = () => {
  const registry: AtomRegistry = createTestRegistry([
    [userAtom, user],
    [tokenAtom, "token-1"],
    [teamsAtom, [team]],
    [activeTeamIdAtom, team.id],
  ]);
  applySyncEvent(registry, {
    kind: "team-snapshot",
    teamId: team.id,
    payload: snapshot,
  });
  return registry;
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

describe("HuntDashboardWithTeam", () => {
  it("renders nothing again for a delta tick that changed nothing", async () => {
    const registry = harness();
    const renders = createRenderCounter();
    const view = createReactTestRoot({ attachToDocument: true });

    const Board = renders.track("board", HuntDashboardWithTeam);

    function AppShell() {
      // Stands in for App.tsx: it owns the board's navigation callbacks and
      // subscribes to none of the atoms the board renders from.
      renders.useRenderCount("shell");
      return (
        <>
          <Board
            {...boardProps}
            projects={[team]}
            sessions={[]}
          />
          <RunRow name="row-a" renders={renders} runId={runA.id} />
          <RunRow name="row-b" renders={renders} runId={runB.id} />
        </>
      );
    }

    await view.render(
      <RegistryContext.Provider value={registry}>
        <ToastProvider>
          <TooltipProvider>
            <AppShell />
          </TooltipProvider>
        </ToastProvider>
      </RegistryContext.Provider>,
    );
    expect(view.container.textContent).toContain("첫 번째 이슈");
    renders.reset();

    await act(async () => {
      applySyncEvent(registry, {
        kind: "team-delta",
        teamId: team.id,
        payload: quietDelta,
      });
    });

    renders.expectRenderCounts({});

    await view.cleanup();
  });

  it("reaches only the changed run's row, never the shell", async () => {
    const registry = harness();
    const renders = createRenderCounter();
    const view = createReactTestRoot({ attachToDocument: true });

    const Board = renders.track("board", HuntDashboardWithTeam);

    function AppShell() {
      renders.useRenderCount("shell");
      return (
        <>
          <Board
            {...boardProps}
            projects={[team]}
            sessions={[]}
          />
          <RunRow name="row-a" renders={renders} runId={runA.id} />
          <RunRow name="row-b" renders={renders} runId={runB.id} />
        </>
      );
    }

    await view.render(
      <RegistryContext.Provider value={registry}>
        <ToastProvider>
          <TooltipProvider>
            <AppShell />
          </TooltipProvider>
        </ToastProvider>
      </RegistryContext.Provider>,
    );
    renders.reset();

    await act(async () => {
      applySyncEvent(registry, {
        kind: "run-changed",
        run: { ...runB, title: "고친 이슈", updatedAt: "2026-09-01T00:02:00.000Z" },
        teamId: team.id,
      });
    });

    // The row for the run that changed rendered once; the other run's row and
    // the shell that owns the board's callbacks did not render at all.
    expect(renders.count("row-b")).toBe(1);
    expect(renders.count("row-a")).toBe(0);
    expect(renders.count("shell")).toBe(0);
    // Nothing was pushed into the board from above either: the counter wraps
    // it, so it only counts renders the shell caused. The board's own subtree
    // does render again — it draws a card per run — which is why the follow-up
    // noted at the top of this file matters.
    expect(renders.count("board")).toBe(0);
    expect(view.container.textContent).toContain("고친 이슈");

    await view.cleanup();
  });
});
