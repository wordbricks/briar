/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CompanionHeader } from "./CompanionHeader";

const organizations = [
  {
    id: "organization-1",
    name: "Wordbricks",
    handle: "wordbricks",
    logo: null,
    role: "owner" as const,
    createdAt: "2026-07-23",
  },
  {
    id: "organization-2",
    name: "Acme",
    handle: "acme",
    logo: null,
    role: "member" as const,
    createdAt: "2026-07-24",
  },
];

const projects = [
  {
    id: "project-1",
    name: "Briar",
    organizationId: "organization-1",
    createdAt: "2026-07-23",
  },
];

const user = {
  id: "user-1",
  name: "Jay",
  email: "jay@example.com",
};

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("CompanionHeader", () => {
  it("renders a compact workspace header with project and account controls", () => {
    const markup = renderToStaticMarkup(
      <CompanionHeader
        activeOrganizationId="organization-1"
        activeProjectId="project-1"
        loading={false}
        onLogout={() => undefined}
        onOrganizationChange={() => undefined}
        onProjectChange={() => undefined}
        onRefresh={() => undefined}
        onSettings={() => undefined}
        organizations={organizations}
        pageTitle="Tasks"
        projects={projects}
        user={user}
      />,
    );

    expect(markup).toContain('class="companion-workspace"');
    expect(markup).not.toContain("companion-workspace-mark");
    expect(markup).toContain('aria-label="현재 프로젝트"');
    expect(markup).toContain('<span class="select-menu-value">Briar</span>');
    expect(markup).toContain('class="companion-header-trailing"');
    expect(markup).toContain('class="companion-page-title"');
    expect(markup).toContain(">Tasks</h1>");
    expect(markup).toContain('class="companion-header-actions"');
    expect(markup).toContain('class="companion-account-button"');
    expect(markup).toContain('aria-label="계정 메뉴"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain(">J</span>");
  });

  it("opens account actions without logging out and switches organizations", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const onLogout = vi.fn();
    const onOrganizationChange = vi.fn();
    const onSettings = vi.fn();

    await act(async () => root.render(
      <CompanionHeader
        activeOrganizationId="organization-1"
        activeProjectId="project-1"
        loading={false}
        onLogout={onLogout}
        onOrganizationChange={onOrganizationChange}
        onProjectChange={() => undefined}
        onRefresh={() => undefined}
        onSettings={onSettings}
        organizations={organizations}
        projects={projects}
        user={user}
      />,
    ));

    const accountButton = container.querySelector<HTMLButtonElement>(
      ".companion-account-button",
    );
    await act(async () => accountButton?.click());

    const menu = container.querySelector('[role="menu"]');
    expect(onLogout).not.toHaveBeenCalled();
    expect(accountButton?.getAttribute("aria-expanded")).toBe("true");
    expect(menu?.textContent).toContain("설정");
    expect(menu?.textContent).toContain("조직 전환");
    expect(menu?.textContent).toContain("Wordbricks");
    expect(menu?.textContent).toContain("Acme");
    expect(menu?.textContent).toContain("로그아웃");
    expect(menu?.querySelectorAll('[role="menuitemradio"]')).toHaveLength(2);

    const acmeButton = Array.from(
      menu?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [],
    ).find((button) => button.textContent?.includes("Acme"));
    await act(async () => acmeButton?.click());

    expect(onOrganizationChange).toHaveBeenCalledWith("organization-2");
    expect(container.querySelector('[role="menu"]')).toBeNull();

    await act(async () => accountButton?.click());
    const settingsButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ).find((button) => button.textContent?.includes("설정"));
    await act(async () => settingsButton?.click());

    expect(onSettings).toHaveBeenCalledOnce();
    expect(onLogout).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});
