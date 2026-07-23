/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";
import { I18nProvider } from "../i18n";

const sidebarProps = {
  activePage: "issues" as const,
  activeOrganizationId: "organization-1",
  activeProjectId: "project-1",
  isOpen: true,
  onAddProject: () => undefined,
  onAutoHuntOpen: () => undefined,
  onInboxOpen: () => undefined,
  onIssuesOpen: () => undefined,
  onLogout: () => undefined,
  onOrganizationChange: () => undefined,
  onOrganizationSettings: () => undefined,
  onProjectChange: () => undefined,
  onProjectSettings: () => undefined,
  onToggle: () => undefined,
  organizations: [
    {
      id: "organization-1",
      name: "Briar",
      role: "owner" as const,
      createdAt: "2026-07-22T00:00:00Z",
    },
  ],
  projects: [
    {
      id: "project-1",
      name: "Briar",
      organizationId: "organization-1",
      organizationName: "Briar",
      role: "owner" as const,
      createdAt: "2026-07-22T00:00:00Z",
    },
  ],
  unreadInboxCount: 0,
  user: { id: "user-1", name: "Jay", email: "jay@example.com" },
};

describe("Sidebar", () => {
  it("shows projects as a native-style hierarchy", () => {
    const markup = renderToStaticMarkup(
      <Sidebar
        {...sidebarProps}
      />,
    );

    expect(markup).toContain('aria-label="프로젝트 추가"');
    expect(markup).toContain("프로젝트");
    expect(markup).toContain("Briar");
    expect(markup).toContain('aria-label="현재 프로젝트"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('aria-label="왼쪽 패널 닫기"');
    expect(markup).toContain('aria-label="조직 전환"');
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).toContain('aria-label="계정 메뉴"');
    expect(markup).toContain("이슈");
    expect(markup).toContain("받은 편지함");
    expect(markup).toContain("자동사냥");
    expect(markup).not.toContain("도움말");
    expect(markup).not.toContain('href="#help"');
    expect(markup).toContain('aria-label="Briar 프로젝트 메뉴"');
    expect(markup).not.toContain("<jelly-select");
  });

  it("switches organizations from the brand control", async () => {
    const onOrganizationChange = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Sidebar
          {...sidebarProps}
          onOrganizationChange={onOrganizationChange}
          organizations={[
            ...sidebarProps.organizations,
            {
              id: "organization-2",
              name: "Wordbricks",
              role: "member",
              createdAt: "2026-07-23T00:00:00Z",
            },
          ]}
          projects={[
            ...sidebarProps.projects,
            {
              id: "project-2",
              name: "Console",
              organizationId: "organization-2",
              organizationName: "Wordbricks",
              role: "member",
              createdAt: "2026-07-23T00:00:00Z",
            },
          ]}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="조직 전환"]',
    );
    await act(async () => trigger?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[aria-label="조직 선택"]')?.textContent).toContain(
      "Wordbricks",
    );
    expect(container.textContent).not.toContain("Console");

    await act(async () => {
      Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          '[aria-label="조직 선택"] button',
        ),
      )
        .find((button) => button.textContent?.includes("Wordbricks"))
        ?.click();
    });
    expect(onOrganizationChange).toHaveBeenCalledWith("organization-2");
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");

    await act(async () => root.unmount());
    container.remove();
  });

  it("shows an unread dot for Inbox messages", () => {
    const markup = renderToStaticMarkup(
      <Sidebar {...sidebarProps} unreadInboxCount={2} />,
    );

    expect(markup).toContain("sidebar-unread-dot");
    expect(markup).toContain('aria-label="읽지 않은 메시지 2개"');
  });

  it("opens project settings from the project menu", async () => {
    const onProjectSettings = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Sidebar {...sidebarProps} onProjectSettings={onProjectSettings} />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="Briar 프로젝트 메뉴"]',
    );
    await act(async () => trigger?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[role="menu"]')?.textContent).toContain(
      "프로젝트 설정",
    );

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[role="menuitem"]')?.click();
    });
    expect(onProjectSettings).toHaveBeenCalledWith("project-1");
    expect(container.querySelector('[role="menu"]')).toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it("switches and persists the language from the account submenu", async () => {
    window.localStorage.setItem("briar.locale.v1", "ko");
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<I18nProvider><Sidebar {...sidebarProps} /></I18nProvider>);
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="계정 메뉴"]')?.click();
    });
    expect(container.querySelector(".account-popover")?.textContent).toContain("언어");
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>(".account-popover button"))
        .find((button) => button.textContent?.includes("언어"))
        ?.click();
    });
    expect(container.querySelector(".language-popover")?.textContent).toContain("English");
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>(".language-popover button"))
        .find((button) => button.textContent === "English")
        ?.click();
    });

    expect(container.textContent).toContain("Issues");
    expect(container.textContent).toContain("Auto Hunt");
    expect(window.localStorage.getItem("briar.locale.v1")).toBe("en");
    expect(document.documentElement.lang).toBe("en-US");

    await act(async () => {
      Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          ".account-popover button",
        ),
      )
        .find((button) => button.textContent?.includes("Language"))
        ?.click();
    });
    await act(async () => {
      Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          ".language-popover button",
        ),
      )
        .find((button) => button.textContent === "中文")
        ?.click();
    });

    expect(container.textContent).toContain("问题");
    expect(container.textContent).toContain("自动狩猎");
    expect(window.localStorage.getItem("briar.locale.v1")).toBe("zh");
    expect(document.documentElement.lang).toBe("zh-CN");
    await act(async () => root.unmount());
    container.remove();
  });
});
