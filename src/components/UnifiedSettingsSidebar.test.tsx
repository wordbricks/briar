/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n";
import type { Organization, Project } from "../types";
import { UnifiedSettingsSidebar } from "./UnifiedSettingsSidebar";

const organization: Organization = {
  id: "organization-1",
  name: "Wordbricks",
  handle: "wordbricks",
  logo: null,
  role: "owner",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const projects: Project[] = [
  {
    id: "project-1",
    name: "Briar",
    organizationId: organization.id,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "project-2",
    name: "Velen",
    organizationId: organization.id,
    createdAt: "2026-01-02T00:00:00.000Z",
  },
];

describe("UnifiedSettingsSidebar", () => {
  it("groups settings and reveals nested project sections from the project name", async () => {
    window.localStorage.setItem("briar.locale.v1", "en");
    const onNavigate = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nProvider>
          <UnifiedSettingsSidebar
            activeTarget={{ scope: "application", section: "general" }}
            isOpen
            onBack={() => undefined}
            onNavigate={onNavigate}
            organizations={[organization]}
            projects={projects}
          />
        </I18nProvider>,
      );
    });

    expect(container.textContent).toContain("Application settings");
    expect(container.textContent).toContain("Organization settings");
    expect(container.textContent).toContain("Project settings");
    expect(
      container.querySelector('[data-project-settings-section="workflow"]'),
    ).toBeNull();

    const projectButton = container.querySelector<HTMLButtonElement>(
      '[data-project-settings="project-1"]',
    );
    await act(async () => projectButton?.click());

    expect(projectButton?.getAttribute("aria-expanded")).toBe("true");
    expect(
      container.querySelector('[data-project-settings-section="workflow"]'),
    ).not.toBeNull();
    expect(onNavigate).toHaveBeenLastCalledWith({
      scope: "project",
      projectId: "project-1",
      section: "general",
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-project-settings-section="workflow"]',
        )
        ?.click();
    });
    expect(onNavigate).toHaveBeenLastCalledWith({
      scope: "project",
      projectId: "project-1",
      section: "workflow",
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-organization-settings="organization-1"]',
        )
        ?.click();
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-organization-settings-section="members"]',
        )
        ?.click();
    });
    expect(onNavigate).toHaveBeenLastCalledWith({
      scope: "organization",
      organizationId: "organization-1",
      section: "members",
    });

    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps a deep-linked project and section expanded and selected", async () => {
    window.localStorage.setItem("briar.locale.v1", "en");
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nProvider>
          <UnifiedSettingsSidebar
            activeTarget={{
              scope: "project",
              projectId: "project-2",
              section: "agent-configuration",
            }}
            isOpen
            onBack={() => undefined}
            onNavigate={() => undefined}
            organizations={[organization]}
            projects={projects}
          />
        </I18nProvider>,
      );
    });

    expect(
      container
        .querySelector('[data-project-settings="project-2"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      container
        .querySelector('[data-project-settings-section="agent-configuration"]')
        ?.getAttribute("aria-current"),
    ).toBe("page");

    await act(async () => root.unmount());
    container.remove();
  });
});
