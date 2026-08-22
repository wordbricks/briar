/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { demoDashboard } from "../lib/demo-data";
import { projectIconFromFile } from "../lib/project-icon";
import { ProjectSettings } from "./ProjectSettings";

vi.mock("../lib/project-icon", () => ({
  projectIconAccept: "image/jpeg,image/png,image/webp,image/svg+xml,image/x-icon,.ico",
  projectIconFromFile: vi.fn(),
}));

describe("ProjectSettings", () => {

  it("asks for confirmation once before deleting the project", async () => {
    const onDelete = vi.fn(async () => undefined);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ProjectSettings
          dashboard={demoDashboard}
          githubRepository="wordbricks/briar"
          isDeleting={false}
          isSidebarOpen
          onBack={() => undefined}
          onAnalyzeWorkflowRequirements={async () => undefined}
          onDelete={onDelete}
          onRegenerateWorkflow={async () => undefined}
          onReviseWorkflow={async () => undefined}
          onUpdateVelenOrg={async (org) => org}
          onConnectLinearImport={async () => ({
            viewer: { name: "Demo", email: null, organizationName: "Demo" },
            teams: [],
          })}
          onLoadLinearImportStates={async () => ({ states: [] })}
          onImportLinearIssues={async () => ({
            imported: 0,
            skipped: 0,
            failed: 0,
            total: 0,
            truncated: false,
          })}
          onIconChange={async () => undefined}
          onIssueKeyPrefixChange={async () => undefined}
          onScheduleTabChange={async () => undefined}
          onRefreshVelen={async () => null}
          project={{
            id: "project-1",
            name: "Briar",
            createdAt: "2026-07-22T00:00:00Z",
          }}
          repositoryConnected
          velen={null}
        />,
      );
    });

    const deleteButton = container.querySelector<HTMLButtonElement>(
      '.project-settings-danger [data-slot="status-panel-action"] > button',
    );
    await act(async () => deleteButton?.click());
    expect(onDelete).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Briar 프로젝트를 삭제할까요?",
    );

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(".delete-project-confirm")
        ?.click();
    });
    expect(onDelete).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    container.remove();
  });
});
