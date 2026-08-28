/** @vitest-environment jsdom */

import { act } from "react";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
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
    issueKeyPrefix: "BR",
    scheduleTabEnabled: true,
    icon: null,
    organizationId: organization.id,
    organizationName: organization.name,
    role: "owner",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "project-2",
    name: "Velen",
    issueKeyPrefix: "VE",
    scheduleTabEnabled: true,
    icon: null,
    organizationId: organization.id,
    organizationName: organization.name,
    role: "member",
    createdAt: "2026-01-02T00:00:00.000Z",
  },
];

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("UnifiedSettingsSidebar", () => {
  it("groups settings and reveals nested project sections from the project name", async () => {
    window.localStorage.setItem("briar.locale.v1", "en");
    const onNavigate = vi.fn();
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
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

    expect(container.textContent).toContain("Application settings");
    expect(container.textContent).toContain("My account");
    expect(container.textContent).toContain("Appearance");
    expect(container.textContent).toContain("Browser");
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
          '[data-settings-section="appearance"]',
        )
        ?.click();
    });
    expect(onNavigate).toHaveBeenLastCalledWith({
      scope: "application",
      section: "appearance",
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-settings-section="browser"]',
        )
        ?.click();
    });
    expect(onNavigate).toHaveBeenLastCalledWith({
      scope: "application",
      section: "browser",
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-settings-section="account"]',
        )
        ?.click();
    });
    expect(onNavigate).toHaveBeenLastCalledWith({
      scope: "application",
      section: "account",
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

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-organization-settings-section="agents"]',
        )
        ?.click();
    });
    expect(onNavigate).toHaveBeenLastCalledWith({
      scope: "organization",
      organizationId: "organization-1",
      section: "agents",
    });

    await cleanup();
  });

  it("keeps a deep-linked project and section expanded and selected", async () => {
    window.localStorage.setItem("briar.locale.v1", "en");
    const onNavigate = vi.fn();
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
      <I18nProvider>
        <UnifiedSettingsSidebar
          activeTarget={{
            scope: "project",
            projectId: "project-2",
            section: "agent-configuration",
          }}
          isOpen
          onBack={() => undefined}
          onNavigate={onNavigate}
          organizations={[organization]}
          projects={projects}
        />
      </I18nProvider>,
    );

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

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-project-settings="project-2"]',
        )
        ?.click();
    });
    expect(
      container
        .querySelector('[data-project-settings="project-2"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
    expect(onNavigate).not.toHaveBeenCalled();

    await cleanup();
  });

  it("filters and force-expands the matching scope without mixing its routes", async () => {
    window.localStorage.setItem("briar.locale.v1", "en");
    const onNavigate = vi.fn();
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
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

    const search = container.querySelector<HTMLInputElement>(
      'input[type="search"]',
    )!;
    await act(async () => setInputValue(search, "Members"));

    expect(
      container
        .querySelector('[data-organization-settings="organization-1"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      container.querySelectorAll(
        '[data-organization-settings-section="members"]',
      ),
    ).toHaveLength(1);
    expect(
      container.querySelector('[data-project-settings="project-1"]'),
    ).toBeNull();

    await act(async () => setInputValue(search, "Workflow"));

    expect(
      container.querySelector('[data-organization-settings="organization-1"]'),
    ).toBeNull();
    expect(
      Array.from(
        container.querySelectorAll('[data-project-settings]'),
      ).map((node) => node.getAttribute("aria-expanded")),
    ).toEqual(["true", "true"]);
    expect(
      container.querySelectorAll('[data-project-settings-section="workflow"]'),
    ).toHaveLength(2);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-project-settings="project-2"]')
        ?.click();
    });
    expect(onNavigate).toHaveBeenLastCalledWith({
      scope: "project",
      projectId: "project-2",
      section: "general",
    });

    await cleanup();
  });
});
