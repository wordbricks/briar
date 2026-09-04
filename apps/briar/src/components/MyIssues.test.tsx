/** @vitest-environment jsdom */

import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppKeyboardCommandProvider } from "../hooks/appKeyboardCommands";
import { I18nProvider } from "../i18n";
import { demoDashboard } from "../lib/demo-data";
import { runAtom } from "../state/entities/runs";
import { pinnedTeamIdsAtom } from "../state/entities/retention";
import {
  myIssuesCountAtom,
  myIssuesGroupedRunIdsAtom,
} from "../state/my-issues/atoms";
import { createTestRegistry, type AtomRegistry } from "../state/registry";
import { userAtom } from "../state/session/atoms";
import { applySyncEvent } from "../state/sync/apply";
import type { DashboardPayload, Project, SessionUser } from "../types";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { createRenderCounter, type RenderCounter } from "../test/render-count";
import { MyIssues } from "./MyIssues";

const user: SessionUser = {
  id: "user-1",
  name: "Tester",
  email: "tester@briar.local",
};

const projectOne: Project = {
  ...demoDashboard.team,
  id: "project-one",
  name: "Briar web",
  issueKeyPrefix: "WEB",
  icon: "data:image/png;base64,project-one",
};
const projectTwo: Project = {
  ...demoDashboard.team,
  id: "project-two",
  name: "Briar mobile",
  issueKeyPrefix: "MOB",
  icon: "data:image/png;base64,project-two",
};

const dashboardFor = (project: Project, runs: DashboardPayload["runs"]): DashboardPayload => ({
  ...demoDashboard,
  team: project,
  runs,
  cursor: 1,
  generatedAt: "2026-09-01T00:00:00.000Z",
});

const myCreatedIssue = {
  ...demoDashboard.runs[0]!,
  id: "my-created",
  runNumber: 101,
  title: "Created issue",
  createdByUserId: "user-1",
  assigneeUserId: null,
  source: "issue" as const,
  updatedAt: "2026-09-01T00:00:00.000Z",
};
const myAssignedIssue = {
  ...demoDashboard.runs[1]!,
  id: "my-assigned",
  runNumber: 202,
  title: "Assigned issue",
  createdByUserId: "someone-else",
  assigneeUserId: "user-1",
  source: "feedback" as const,
  updatedAt: "2026-09-01T00:00:00.000Z",
};
const unrelatedIssue = {
  ...demoDashboard.runs[2]!,
  id: "not-mine",
  runNumber: 303,
  title: "Unrelated issue",
  createdByUserId: "someone-else",
  assigneeUserId: null,
};

describe("MyIssues", () => {
  let cleanup: () => Promise<void>;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createReactTestRoot>["root"];
  let registry: AtomRegistry;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    window.localStorage.setItem("briar.locale.v1", "en");
    registry = createTestRegistry([[userAtom, user]]);
    ({ cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    }));
  });

  afterEach(async () => {
    await cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  const page = (
    loadProjectDashboard: (
      projectId: string,
      signal: AbortSignal,
    ) => Promise<DashboardPayload | null>,
    projects: Project[],
    onOpenIssue: (projectId: string, runId: string) => void,
    extra?: React.ReactNode,
  ) => (
    <RegistryContext.Provider value={registry}>
      <I18nProvider>
        <AppKeyboardCommandProvider>
          <MyIssues
            isSidebarOpen
            loadProjectDashboard={loadProjectDashboard}
            onOpenIssue={onOpenIssue}
            organizationId="demo-organization"
            organizationName="Briar"
            projects={projects}
          />
          {extra}
        </AppKeyboardCommandProvider>
      </I18nProvider>
    </RegistryContext.Provider>
  );

  async function renderPage(
    onOpenIssue = vi.fn(),
    dashboards: Record<string, DashboardPayload> = {
      [projectOne.id]: dashboardFor(projectOne, [myCreatedIssue, unrelatedIssue]),
      [projectTwo.id]: dashboardFor(projectTwo, [myAssignedIssue]),
    },
    extra?: React.ReactNode,
  ) {
    const loadProjectDashboard = vi.fn(async (projectId: string) => dashboards[projectId] ?? null);
    await renderReactTestRoot(
      root,
      page(loadProjectDashboard, [projectOne, projectTwo], onOpenIssue, extra),
    );
    return { loadProjectDashboard, onOpenIssue };
  }

  it("combines project dashboards and keeps only created or assigned issues", async () => {
    const { loadProjectDashboard } = await renderPage();

    expect(loadProjectDashboard).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Created issue");
    expect(container.textContent).toContain("Assigned issue");
    expect(container.textContent).not.toContain("Unrelated issue");
    expect(container.querySelectorAll(".issue-list-project-icon")).toHaveLength(2);
    expect(container.querySelector('img[src="data:image/png;base64,project-one"]')).not.toBeNull();
    expect(container.querySelector('img[src="data:image/png;base64,project-two"]')).not.toBeNull();
  });

  it("puts the loaded boards in the entity store and pins them against the LRU", async () => {
    await renderPage();

    // The rows are entities now, not a record this page keeps for itself.
    expect(registry.get(runAtom("my-created"))?.title).toBe("Created issue");
    expect(registry.get(runAtom("my-assigned"))?.title).toBe("Assigned issue");
    expect(registry.get(pinnedTeamIdsAtom).sort()).toEqual([
      "project-one",
      "project-two",
    ]);

    await cleanup();
    // The pin is the page's, and it ends with the page.
    expect(registry.get(pinnedTeamIdsAtom)).toEqual([]);
  });

  it("supports selecting one project from the multi-select project menu", async () => {
    await renderPage();
    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="Select projects for My issues"]',
    )!;

    await act(async () => {
      trigger.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          button: 0,
        }),
      );
    });
    const mobileOption = document.body.querySelector<HTMLElement>(
      '[data-project-id="project-two"]',
    )!;
    await act(async () => mobileOption.click());

    expect(container.textContent).not.toContain("Created issue");
    expect(container.textContent).toContain("Assigned issue");
  });

  it("opens the issue with its owning project context", async () => {
    const onOpenIssue = vi.fn();
    await renderPage(onOpenIssue);
    const row = container.querySelector<HTMLElement>(
      '.issue-list-row[data-run-id="my-assigned"]',
    )!;

    await act(async () => row.click());

    expect(onOpenIssue).toHaveBeenCalledWith("project-two", "my-assigned");
  });

  it("does not reload when the same projects arrive in a new array", async () => {
    const dashboards = {
      [projectOne.id]: dashboardFor(projectOne, [myCreatedIssue]),
      [projectTwo.id]: dashboardFor(projectTwo, [myAssignedIssue]),
    };
    const firstLoader = vi.fn(async (projectId: string) => dashboards[projectId] ?? null);
    const replacementLoader = vi.fn(async (projectId: string) => dashboards[projectId] ?? null);
    const render = (projects: Project[], loadProjectDashboard = firstLoader) =>
      renderReactTestRoot(root, page(loadProjectDashboard, projects, vi.fn()));

    await render([projectOne, projectTwo]);
    await render([{ ...projectOne }, { ...projectTwo }], replacementLoader);
    await render([projectOne, projectTwo], replacementLoader);

    expect(firstLoader).toHaveBeenCalledTimes(2);
    expect(replacementLoader).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Created issue");
    expect(container.textContent).toContain("Assigned issue");

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Retry"]')?.click();
    });
    expect(replacementLoader).toHaveBeenCalledTimes(2);
  });

  it("reloads when the project ID composition changes", async () => {
    const dashboards = {
      [projectOne.id]: dashboardFor(projectOne, [myCreatedIssue]),
      [projectTwo.id]: dashboardFor(projectTwo, [myAssignedIssue]),
    };
    const loadProjectDashboard = vi.fn(async (projectId: string) => dashboards[projectId] ?? null);
    const render = (projects: Project[]) =>
      renderReactTestRoot(root, page(loadProjectDashboard, projects, vi.fn()));

    await render([projectOne]);
    expect(loadProjectDashboard).toHaveBeenCalledTimes(1);
    await render([projectOne, projectTwo]);

    expect(loadProjectDashboard).toHaveBeenCalledTimes(3);
    expect(container.textContent).toContain("Created issue");
    expect(container.textContent).toContain("Assigned issue");
  });

  it("keeps existing issues visible during a manual background refresh", async () => {
    const dashboards = {
      [projectOne.id]: dashboardFor(projectOne, [myCreatedIssue]),
      [projectTwo.id]: dashboardFor(projectTwo, [myAssignedIssue]),
    };
    const pendingResolvers: Array<() => void> = [];
    const loadProjectDashboard = vi.fn((projectId: string) => {
      if (loadProjectDashboard.mock.calls.length <= 2) {
        return Promise.resolve(dashboards[projectId] ?? null);
      }
      return new Promise<DashboardPayload | null>((resolve) => {
        pendingResolvers.push(() => resolve(dashboards[projectId] ?? null));
      });
    });
    await renderReactTestRoot(
      root,
      page(loadProjectDashboard, [projectOne, projectTwo], vi.fn()),
    );

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Retry"]')?.click();
    });
    expect(loadProjectDashboard).toHaveBeenCalledTimes(4);
    expect(container.textContent).toContain("Created issue");
    expect(container.textContent).toContain("Assigned issue");
    expect(container.querySelector(".issues-loading-overlay")).toBeNull();

    await act(async () => pendingResolvers.forEach((resolve) => resolve()));
  });

  it("uses the shared filters and shows project metadata in list and kanban", async () => {
    await renderPage();
    const search = container.querySelector<HTMLInputElement>('[aria-label="Search my issues"]')!;
    const setInputValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setInputValue?.call(search, "Assigned");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelectorAll(".issue-list-row")).toHaveLength(1);
    expect(container.textContent).toContain("1 issue");

    await act(async () => {
      setInputValue?.call(search, "");
      search.dispatchEvent(new Event("input", { bubbles: true }));
      container.querySelector<HTMLButtonElement>('[aria-label="Kanban view"]')?.click();
    });
    expect(container.querySelectorAll(".kanban-card")).toHaveLength(2);
    expect(container.querySelectorAll(".kanban-card-project-icon")).toHaveLength(2);
    expect(container.textContent).toContain("WEB-101");
    expect(container.textContent).toContain("MOB-202");
  });

  it("places each project issue in a column from its owning workflow", async () => {
    const mobileWorkflow = {
      ...demoDashboard.settings.workflow,
      stages: [{ id: "mobile_qa", label: "Mobile QA", required: true }],
      completion: { requiredStages: ["mobile_qa"] },
    };
    const mobileRun = {
      ...myAssignedIssue,
      status: "running" as const,
      workflowStage: "mobile_qa",
    };
    await renderPage(vi.fn(), {
      [projectOne.id]: dashboardFor(projectOne, [myCreatedIssue]),
      [projectTwo.id]: {
        ...dashboardFor(projectTwo, [mobileRun]),
        settings: { ...demoDashboard.settings, workflow: mobileWorkflow },
      },
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Kanban view"]')?.click();
    });

    const mobileColumn = container.querySelector(
      '[data-kanban-column-id="stage:project-two:mobile_qa"]',
    );
    expect(mobileColumn?.textContent).toContain("Assigned issue");
    expect(mobileColumn?.querySelector('img[src="data:image/png;base64,project-two"]')).not.toBeNull();
  });

  /*
    The promise the entity store makes this page, counted rather than argued.
    Each probe subscribes to the very atom the component it stands for reads —
    `runAtom` for a row, the grouped ids for the list, the count for the header
    — so a probe renders exactly when that component does.
  */
  it("reaches only the changed run's row on a realtime edit", async () => {
    const renders = createRenderCounter();

    function RunRow({ name, runId }: { name: string; runId: string }) {
      renders.useRenderCount(name);
      const run = useAtomValue(runAtom(runId));
      return <output>{run?.title ?? ""}</output>;
    }
    function ListProbe() {
      renders.useRenderCount("list");
      useAtomValue(myIssuesGroupedRunIdsAtom);
      return null;
    }
    function CountProbe() {
      renders.useRenderCount("count");
      useAtomValue(myIssuesCountAtom);
      return null;
    }

    await renderPage(vi.fn(), undefined, (
      <>
        <RunRow name="row-created" runId="my-created" />
        <RunRow name="row-assigned" runId="my-assigned" />
        <ListProbe />
        <CountProbe />
      </>
    ));
    expect(container.textContent).toContain("Assigned issue");
    renders.reset();

    await act(async () => {
      applySyncEvent(registry, {
        kind: "run-changed",
        run: { ...myAssignedIssue, title: "고친 이슈" },
        teamId: projectTwo.id,
      });
    });

    // The edited run's row and nothing else: not the other row, not the
    // grouped list the sections are drawn from, not the header count.
    renders.expectRenderCounts({ "row-assigned": 1 });
    expect(
      container.querySelector('.issue-list-row[data-run-id="my-assigned"] strong')
        ?.textContent,
    ).toBe("고친 이슈");
  });
});
