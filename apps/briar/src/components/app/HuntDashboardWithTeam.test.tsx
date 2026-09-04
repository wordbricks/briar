/** @vitest-environment jsdom */

import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { ToastProvider } from "../ui/toast";
import { TooltipProvider } from "../ui/tooltip";
import { demoDashboard } from "../../lib/demo-data";
import { runIsProcessingAtom } from "../../state/agent-sessions/atoms";
import { testAgentSession } from "../../test/agent-sessions";
import {
  boardColumnKey,
  boardColumnRunIdsAtom,
  boardGroupedRunIdsAtom,
  boardRunCountAtom,
  boardStatusCountsAtom,
} from "../../state/board/atoms";
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
  3. A change that moves a run between columns reaches those two columns' id
     lists and the counts, and leaves every other column alone.

  How the counting works. `renderCounter.track` only sees renders a parent
  pushed, which is exactly what is asserted for the board itself: nothing is
  handed down to it any more. Everything below the board subscribes rather than
  receives, so the probes here subscribe to the very same atoms the components
  do — `boardColumnDefinitionsAtom` and the two count atoms for the chrome,
  `boardGroupedRunIdsAtom` for the kanban (its keyboard order is the grouping),
  `boardColumnRunIdsAtom` for one column, `runAtom` for one card — and a probe
  renders exactly when its component does. The real board is mounted alongside
  them, so the DOM assertions are about the board itself.
*/

const user: SessionUser = {
  id: "user-1",
  name: "Tester",
  email: "tester@briar.local",
};

const team: Project = { ...demoDashboard.team, id: "team-a", name: "Team A" };

const runOf = (id: string, title: string, status: HuntRun["status"]): HuntRun => ({
  ...demoDashboard.runs[0]!,
  id,
  runNumber: Number(id.replace(/\D/g, "")) || 1,
  title,
  status,
  workflowStage: null,
  teamId: team.id,
  updatedAt: "2026-09-01T00:00:00.000Z",
});

const runA = runOf("run-1", "첫 번째 이슈", "backlog");
const runB = runOf("run-2", "두 번째 이슈", "queued");

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

/** A card's "an agent is on this issue" subscription, which is per run. */
function ProcessingProbe({
  name,
  renders,
  runId,
}: {
  name: string;
  renders: RenderCounter;
  runId: string;
}) {
  renders.useRenderCount(name);
  useAtomValue(runIsProcessingAtom(runId));
  return null;
}

/** One kanban column: it subscribes to the ids it draws. */
function ColumnProbe({
  columnId,
  renders,
}: {
  columnId: string;
  renders: RenderCounter;
}) {
  renders.useRenderCount(`column:${columnId}`);
  const runIds = useAtomValue(
    boardColumnRunIdsAtom(boardColumnKey(team.id, columnId)),
  );
  return <output>{runIds.length}</output>;
}

/** The kanban surface, whose keyboard order is the grouping. */
function KanbanProbe({ renders }: { renders: RenderCounter }) {
  renders.useRenderCount("kanban");
  useAtomValue(boardGroupedRunIdsAtom(team.id));
  return null;
}

/** The two numbers the board chrome shows. */
function ChromeProbe({ renders }: { renders: RenderCounter }) {
  renders.useRenderCount("task-count");
  useAtomValue(boardRunCountAtom(team.id));
  return null;
}

function StatusTabsProbe({ renders }: { renders: RenderCounter }) {
  renders.useRenderCount("status-tabs");
  useAtomValue(boardStatusCountsAtom(team.id));
  return null;
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

const mount = async (registry: AtomRegistry, renders: RenderCounter) => {
  const view = createReactTestRoot({ attachToDocument: true });
  const Board = renders.track("board", HuntDashboardWithTeam);

  function AppShell() {
    // Stands in for App.tsx: it owns the board's navigation callbacks and
    // subscribes to none of the atoms the board renders from.
    renders.useRenderCount("shell");
    return (
      <>
        <Board {...boardProps} projects={[team]} />
        <RunRow name="row-a" renders={renders} runId={runA.id} />
        <RunRow name="row-b" renders={renders} runId={runB.id} />
        <ProcessingProbe name="processing-a" renders={renders} runId={runA.id} />
        <ProcessingProbe name="processing-b" renders={renders} runId={runB.id} />
        <ColumnProbe columnId="status:backlog" renders={renders} />
        <ColumnProbe columnId="status:queued" renders={renders} />
        <ColumnProbe columnId="status:blocked" renders={renders} />
        <ColumnProbe columnId="status:completed" renders={renders} />
        <KanbanProbe renders={renders} />
        <ChromeProbe renders={renders} />
        <StatusTabsProbe renders={renders} />
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
  return view;
};

/** The card the board drew for `run`, so the DOM can be checked directly. */
const cardTitle = (container: ParentNode, runId: string) =>
  container.querySelector(`.kanban-card[data-run-id="${runId}"] .kanban-card-copy strong`)
    ?.textContent ?? null;

const columnCount = (container: ParentNode, columnId: string) =>
  container.querySelector(
    `[data-kanban-column-id="${columnId}"] .kanban-column-header-actions strong`,
  )?.textContent ?? null;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

describe("HuntDashboardWithTeam", () => {
  it("renders nothing again for a delta tick that changed nothing", async () => {
    const registry = harness();
    const renders = createRenderCounter();
    const view = await mount(registry, renders);

    expect(cardTitle(view.container, runA.id)).toBe("첫 번째 이슈");
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

  it("reaches only the changed run's row, never the board or the shell", async () => {
    const registry = harness();
    const renders = createRenderCounter();
    const view = await mount(registry, renders);
    renders.reset();

    await act(async () => {
      applySyncEvent(registry, {
        kind: "run-changed",
        run: { ...runB, title: "고친 이슈", updatedAt: "2026-09-01T00:02:00.000Z" },
        teamId: team.id,
      });
    });

    /*
      The row of the run that changed rendered once. Nothing else did: not the
      other row, not a column, not the kanban that holds the keyboard order, not
      the two counts, not the board and not the shell above it.
    */
    renders.expectRenderCounts({ "row-b": 1 });
    expect(cardTitle(view.container, runB.id)).toBe("고친 이슈");
    expect(cardTitle(view.container, runA.id)).toBe("첫 번째 이슈");

    await view.cleanup();
  });

  it("reaches the two columns a status change moves the run between", async () => {
    const registry = harness();
    const renders = createRenderCounter();
    const view = await mount(registry, renders);

    expect(columnCount(view.container, "status:queued")).toBe("1");
    expect(columnCount(view.container, "status:blocked")).toBe("0");
    renders.reset();

    await act(async () => {
      applySyncEvent(registry, {
        kind: "run-changed",
        run: { ...runB, status: "blocked", updatedAt: "2026-09-01T00:02:00.000Z" },
        teamId: team.id,
      });
    });

    /*
      The run's own card, the id lists of the column it left and the one it
      joined, the grouping the kanban's keyboard order is built from, and the
      status tab totals. The column the run never touched did not render, and
      neither did the "N tasks" count — the run still passes the filters — nor
      the board or the shell.
    */
    renders.expectRenderCounts({
      "column:status:blocked": 1,
      "column:status:queued": 1,
      kanban: 1,
      "row-b": 1,
      "status-tabs": 1,
    });
    expect(columnCount(view.container, "status:queued")).toBe("0");
    expect(columnCount(view.container, "status:blocked")).toBe("1");

    await view.cleanup();
  });

  it("reaches only the card an agent session started on", async () => {
    const registry = harness();
    const renders = createRenderCounter();
    const view = await mount(registry, renders);
    renders.reset();

    await act(async () => {
      applySyncEvent(registry, {
        kind: "agent-sessions-changed",
        sessions: [
          testAgentSession("session-1", {
            projectId: team.id,
            issues: [
              {
                runId: runB.id,
                runNumber: 2,
                sourceKey: runB.id,
                title: runB.title,
                outcome: "pending",
                summary: null,
              },
            ],
          }),
        ],
      });
    });

    /*
      The set of processing runs was a prop threaded through the card context,
      so a session starting anywhere gave every card a new context object. Each
      card asks about its own run now: the card of the issue the session took
      re-renders, and nothing else on the board does — not the other card, not a
      column, not the counts, not the board, not the shell.
    */
    renders.expectRenderCounts({ "processing-b": 1 });

    await view.cleanup();
  });
});
