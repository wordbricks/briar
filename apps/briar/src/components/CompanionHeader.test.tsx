/** @vitest-environment jsdom */

import { act } from "react";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
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
    role: "developer" as const,
    createdAt: "2026-07-24",
  },
];

const projects = [
  {
    id: "project-1",
    name: "Briar",
    issueKeyPrefix: "BR",
    scheduleTabEnabled: true,
    organizationId: "organization-1",
    organizationName: "Wordbricks",
    role: "owner" as const,
    icon: "data:image/png;base64,AA==",
    createdAt: "2026-07-23",
  },
];

const user = {
  id: "user-1",
  name: "Jay",
  email: "jay@example.com",
};

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("CompanionHeader", () => {
  it("opens account actions without logging out and switches organizations", async () => {
    const { cleanup, container, root } = createReactTestRoot();
    const onLogout = vi.fn();
    const onOrganizationChange = vi.fn();
    const onSettings = vi.fn();

    await renderReactTestRoot(
      root,
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
    );

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
    await cleanup();
  });

  it("places the mobile inbox read action in the header", async () => {
    const { cleanup, container, root } = createReactTestRoot();
    const onMarkAllRead = vi.fn();

    await renderReactTestRoot(
      root,
      <CompanionHeader
        activeOrganizationId="organization-1"
        activeProjectId="project-1"
        loading={false}
        onLogout={() => undefined}
        onMarkAllRead={onMarkAllRead}
        onOrganizationChange={() => undefined}
        onProjectChange={() => undefined}
        onRefresh={() => undefined}
        onSettings={() => undefined}
        organizations={organizations}
        pageTitle="Inbox"
        projects={projects}
        user={user}
      />,
    );

    const markAllRead = container.querySelector<HTMLButtonElement>(
      'button[aria-label="모두 읽음"]',
    );
    await act(async () => markAllRead?.click());

    expect(onMarkAllRead).toHaveBeenCalledOnce();
    await cleanup();
  });
});
