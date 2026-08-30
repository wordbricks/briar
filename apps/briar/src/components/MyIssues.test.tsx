/** @vitest-environment jsdom */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppKeyboardCommandProvider } from "../hooks/appKeyboardCommands";
import { I18nProvider } from "../i18n";
import { demoDashboard } from "../lib/demo-data";
import type { DashboardPayload, Project } from "../types";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { MyIssues } from "./MyIssues";

const projectOne: Project = {
  ...demoDashboard.project,
  id: "project-one",
  name: "Briar web",
  issueKeyPrefix: "WEB",
  icon: "data:image/png;base64,project-one",
};
const projectTwo: Project = {
  ...demoDashboard.project,
  id: "project-two",
  name: "Briar mobile",
  issueKeyPrefix: "MOB",
  icon: "data:image/png;base64,project-two",
};

const dashboardFor = (project: Project, runs: DashboardPayload["runs"]): DashboardPayload => ({
  ...demoDashboard,
  project,
  runs,
});

const myCreatedIssue = {
  ...demoDashboard.runs[0]!,
  id: "my-created",
  runNumber: 101,
  title: "Created issue",
  createdByUserId: "user-1",
  assigneeUserId: null,
  source: "issue" as const,
};
const myAssignedIssue = {
  ...demoDashboard.runs[1]!,
  id: "my-assigned",
  runNumber: 202,
  title: "Assigned issue",
  createdByUserId: "someone-else",
  assigneeUserId: "user-1",
  source: "feedback" as const,
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

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    window.localStorage.setItem("briar.locale.v1", "en");
    ({ cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    }));
  });

  afterEach(async () => {
    await cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  async function renderPage(
    onOpenIssue = vi.fn(),
    dashboards: Record<string, DashboardPayload> = {
      [projectOne.id]: dashboardFor(projectOne, [myCreatedIssue, unrelatedIssue]),
      [projectTwo.id]: dashboardFor(projectTwo, [myAssignedIssue]),
    },
  ) {
    const loadProjectDashboard = vi.fn(async (projectId: string) => dashboards[projectId] ?? null);
    await renderReactTestRoot(
      root,
      <I18nProvider>
        <AppKeyboardCommandProvider>
          <MyIssues
            currentUserId="user-1"
            isSidebarOpen
            loadProjectDashboard={loadProjectDashboard}
            onOpenIssue={onOpenIssue}
            organizationId="demo-organization"
            organizationName="Briar"
            projects={[projectOne, projectTwo]}
          />
        </AppKeyboardCommandProvider>
      </I18nProvider>,
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
      renderReactTestRoot(
        root,
        <I18nProvider>
          <AppKeyboardCommandProvider>
            <MyIssues
              currentUserId="user-1"
              isSidebarOpen
              loadProjectDashboard={loadProjectDashboard}
              onOpenIssue={vi.fn()}
              organizationId="demo-organization"
              organizationName="Briar"
              projects={projects}
            />
          </AppKeyboardCommandProvider>
        </I18nProvider>,
      );

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
    const render = (projects: Project[]) => renderReactTestRoot(
      root,
      <I18nProvider>
        <AppKeyboardCommandProvider>
          <MyIssues
            currentUserId="user-1"
            isSidebarOpen
            loadProjectDashboard={loadProjectDashboard}
            onOpenIssue={vi.fn()}
            organizationId="demo-organization"
            organizationName="Briar"
            projects={projects}
          />
        </AppKeyboardCommandProvider>
      </I18nProvider>,
    );

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
      <I18nProvider>
        <AppKeyboardCommandProvider>
          <MyIssues
            currentUserId="user-1"
            isSidebarOpen
            loadProjectDashboard={loadProjectDashboard}
            onOpenIssue={vi.fn()}
            organizationId="demo-organization"
            organizationName="Briar"
            projects={[projectOne, projectTwo]}
          />
        </AppKeyboardCommandProvider>
      </I18nProvider>,
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
});
