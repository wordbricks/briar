/** @vitest-environment jsdom */

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import type { PlanningProject } from "../types";
import { Projects } from "./Projects";

const project = (input: Partial<PlanningProject> = {}): PlanningProject => ({
  id: "planning-1",
  workspaceId: "organization-1",
  workspaceName: "Briar",
  teamId: "team-1",
  teamName: "Desktop",
  name: "Project navigation",
  description: "Expose the project list",
  status: "active",
  leadUserId: "user-1",
  leadName: "Jay",
  startDate: null,
  targetDate: "2026-09-30",
  icon: null,
  color: "#7c3aed",
  sortOrder: 1,
  isDefault: false,
  role: "owner",
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  ...input,
});

describe("Projects", () => {
  it("renders only the selected Team's projects and opens rows and settings", async () => {
    const onCreate = vi.fn();
    const onOpen = vi.fn();
    const onSettings = vi.fn();
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <I18nProvider>
        <Projects
          isSidebarOpen
          onCreate={onCreate}
          onOpen={onOpen}
          onSettings={onSettings}
          projects={[
            project(),
            project({
              id: "planning-2",
              name: "Later project",
              status: "planned",
            }),
            project({
              id: "planning-3",
              name: "Another Team project",
              teamId: "team-2",
              teamName: "Mobile",
            }),
          ]}
          teamId="team-1"
          teamName="Desktop"
        />
      </I18nProvider>,
    );

    expect(container.textContent).toContain("Project navigation");
    expect(container.textContent).toContain("Later project");
    expect(container.textContent).not.toContain("Another Team project");
    expect(container.textContent).toContain(
      "View every project in Desktop in one place.",
    );
    const rows = container.querySelectorAll<HTMLButtonElement>(
      'section .group > button:first-child',
    );
    expect(rows).toHaveLength(2);

    await act(async () => rows[0]?.click());
    expect(onOpen).toHaveBeenCalledWith("planning-1", "team-1");

    const settings = rows[0]?.parentElement?.querySelector<HTMLButtonElement>(
      'button:last-child',
    );
    await act(async () => settings?.click());
    expect(onSettings).toHaveBeenCalledWith("planning-1");
    expect(onOpen).toHaveBeenCalledTimes(1);

    const create = container.querySelector<HTMLButtonElement>(
      ".app-page-header button",
    );
    await act(async () => create?.click());
    expect(onCreate).toHaveBeenCalledOnce();

    await cleanup();
  });
});
