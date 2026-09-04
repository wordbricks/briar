/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { act, Suspense } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { ToastProvider } from "../ui/toast";
import { TooltipProvider } from "../ui/tooltip";
import { demoDashboard } from "../../lib/demo-data";
import { runTask } from "../../state/actions";
import { updateIssueAction } from "../../state/issues/atoms";
import { createTestRegistry, type AtomRegistry } from "../../state/registry";
import { tokenAtom, userAtom } from "../../state/session/atoms";
import { applySyncEvent } from "../../state/sync/apply";
import { activeTeamIdAtom, teamsAtom } from "../../state/team/atoms";
import { createReactTestRoot, settle } from "../../test/react";
import { createRenderCounter } from "../../test/render-count";
import type {
  DashboardPayload,
  HuntRun,
  Project,
  SessionUser,
} from "../../types";
import { RunPageWithRun } from "./RunPageWithRun";

/*
  The issue detail page takes a run id and reads the run itself.

  `App.tsx` used to find the run in the dashboard it rendered and pass it down
  with twenty five callbacks bound to it, so every polling tick rebuilt the
  whole block. The page now reads `runAtom(runId)`, which is what lets an edit
  to the run reach the page without the shell rendering at all.
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
  runNumber: id === "run-a" ? 1 : 2,
  title,
  teamId: team.id,
  updatedAt: "2026-09-01T00:00:00.000Z",
});

const runA = runOf("run-a", "열린 이슈");
const runB = runOf("run-b", "다른 이슈");

const snapshot: DashboardPayload = {
  ...demoDashboard,
  team,
  runs: [runA, runB],
  cursor: 1,
  generatedAt: "2026-09-01T00:00:00.000Z",
};

/** A promise this test settles by hand. */
const deferred = <A,>() => {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
};

const pageProps = {
  isSidebarOpen: true,
  onBack: () => undefined,
  onSendIssueMessage: async () => {
    throw new Error("not implemented in this test");
  },
};

/** The page renders the issue title into an editable field, not into text. */
const renderedText = (container: HTMLElement) =>
  [
    container.textContent ?? "",
    ...[...container.querySelectorAll("input, textarea")].map(
      (field) => (field as HTMLInputElement | HTMLTextAreaElement).value,
    ),
  ].join(" ");

const harness = (payload: DashboardPayload | null = snapshot): AtomRegistry => {
  const registry = createTestRegistry([
    [userAtom, user],
    [tokenAtom, "token-1"],
    [teamsAtom, [team]],
    [activeTeamIdAtom, team.id],
  ]);
  if (payload) {
    applySyncEvent(registry, {
      kind: "team-snapshot",
      teamId: team.id,
      payload,
    });
  }
  return registry;
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

describe("RunPageWithRun", () => {
  it("renders nothing while the store does not hold the run", async () => {
    const registry = harness(null);
    const view = createReactTestRoot();

    await view.render(
      <RegistryContext.Provider value={registry}>
        <Suspense fallback={null}>
          <RunPageWithRun {...pageProps} runId="run-a" />
        </Suspense>
      </RegistryContext.Provider>,
    );

    expect(view.container.textContent).toBe("");

    await view.cleanup();
  });

  it("follows its own run without re-rendering the shell", async () => {
    const registry = harness();
    const renders = createRenderCounter();
    const view = createReactTestRoot({ attachToDocument: true });

    function AppShell() {
      // Stands in for App.tsx: it owns the navigation callbacks and reads
      // nothing the page renders from.
      renders.useRenderCount("shell");
      return (
        <Suspense fallback={null}>
          <RunPageWithRun {...pageProps} runId={runA.id} />
        </Suspense>
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
    await settle(
      () => renderedText(view.container).includes("열린 이슈"),
      { description: "the run page to come out of its lazy boundary" },
    );
    renders.reset();

    await act(async () => {
      applySyncEvent(registry, {
        kind: "run-changed",
        run: { ...runA, title: "고친 이슈", updatedAt: "2026-09-01T00:02:00.000Z" },
        teamId: team.id,
      });
    });

    expect(renderedText(view.container)).toContain("고친 이슈");
    renders.expectRenderCounts({});

    await view.cleanup();
  });

  it("watches its own run's edit flag, not the one being edited", async () => {
    const registry = harness();
    const renders = createRenderCounter();
    const view = createReactTestRoot({ attachToDocument: true });

    await view.render(
      <RegistryContext.Provider value={registry}>
        <ToastProvider>
          <TooltipProvider>
            {renders.profile(
              "page",
              <Suspense fallback={null}>
                <RunPageWithRun {...pageProps} runId={runA.id} />
              </Suspense>,
            )}
          </TooltipProvider>
        </ToastProvider>
      </RegistryContext.Provider>,
    );
    await settle(() => renderedText(view.container).includes("열린 이슈"), {
      description: "the run page to come out of its lazy boundary",
    });

    const other = deferred<void>();
    renders.reset();
    await act(async () => {
      void runTask(registry, updateIssueAction, runB.id, () => other.promise);
    });
    // Another run's edit is not this page's business.
    renders.expectRenderCounts({});

    const own = deferred<void>();
    await act(async () => {
      void runTask(registry, updateIssueAction, runA.id, () => own.promise);
    });
    expect(renders.count("page")).toBeGreaterThan(0);

    await act(async () => {
      own.resolve();
      other.resolve();
    });
    await view.cleanup();
  });
});
