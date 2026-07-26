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
  connectedProjectIds: ["project-1"],
  isOpen: true,
  onAddProject: () => undefined,
  onAgentsOpen: () => undefined,
  onAutoHuntOpen: () => undefined,
  onInboxOpen: () => undefined,
  onIssuesOpen: () => undefined,
  onAddOrganization: () => undefined,
  onLogout: () => undefined,
  onOrganizationChange: () => undefined,
  onOrganizationSettings: () => undefined,
  onProjectChange: () => undefined,
  onProjectReadinessOpen: () => undefined,
  onProjectSettings: () => undefined,
  onSettings: () => undefined,
  organizations: [
    {
      id: "organization-1",
      name: "Briar",
      handle: "briar",
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
  projectReadiness: {},
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
    expect(markup).toContain('aria-label="조직 메뉴 열기"');
    expect(markup).not.toContain("sidebar-organization-heading");
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).toContain('aria-label="계정 메뉴"');
    expect(markup).toContain("이슈");
    expect(markup).toContain("에이전트");
    expect(markup).toContain("받은 편지함");
    expect(markup).toContain("자동사냥");
    expect(markup).not.toContain("도움말");
    expect(markup).not.toContain('href="#help"');
    expect(markup).toContain('aria-label="Briar 프로젝트 메뉴"');
    expect(markup).not.toContain("<select");
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
              handle: "wordbricks",
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
      '[aria-label="조직 메뉴 열기"]',
    );
    await act(async () => trigger?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[aria-label="조직 메뉴"]')?.textContent).toContain(
      "멤버 초대 및 관리",
    );
    expect(container.querySelector('[aria-label="조직 메뉴"]')?.textContent).not.toContain(
      "Wordbricks",
    );
    expect(container.textContent).not.toContain("Console");

    await act(async () => {
      Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          '[aria-label="조직 메뉴"] button',
        ),
      )
        .find((button) => button.textContent?.includes("조직 전환"))
        ?.click();
    });
    expect(container.querySelector('[aria-label="조직 선택"]')?.textContent).toContain(
      "Wordbricks",
    );

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

  it("opens the organization creation page from the bottom of the switcher", async () => {
    const onAddOrganization = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Sidebar
          {...sidebarProps}
          onAddOrganization={onAddOrganization}
        />,
      );
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="조직 메뉴 열기"]')
        ?.click();
    });
    await act(async () => {
      Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          '[aria-label="조직 메뉴"] button',
        ),
      )
        .find((button) => button.textContent?.includes("조직 전환"))
        ?.click();
    });
    const items = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        '[aria-label="조직 메뉴"] button',
      ),
    );
    expect(items.at(-1)?.textContent).toContain("조직 추가");

    await act(async () => items.at(-1)?.click());
    expect(onAddOrganization).toHaveBeenCalledOnce();
    expect(container.querySelector('[aria-label="조직 메뉴"]')).toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it("opens organization actions and logs out from the organization menu", async () => {
    const onOrganizationSettings = vi.fn();
    const onLogout = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Sidebar
          {...sidebarProps}
          onLogout={onLogout}
          onOrganizationSettings={onOrganizationSettings}
        />,
      );
    });

    const openMenu = async () => {
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>('[aria-label="조직 메뉴 열기"]')
          ?.click();
      });
    };
    const clickMenuItem = async (label: string) => {
      await act(async () => {
        Array.from(
          container.querySelectorAll<HTMLButtonElement>(
            '[aria-label="조직 메뉴"] button',
          ),
        )
          .find((button) => button.textContent?.includes(label))
          ?.click();
      });
    };

    await openMenu();
    await clickMenuItem("조직 설정");
    expect(onOrganizationSettings).toHaveBeenLastCalledWith(
      "organization-1",
    );

    await openMenu();
    await clickMenuItem("멤버 초대 및 관리");
    expect(onOrganizationSettings).toHaveBeenLastCalledWith(
      "organization-1",
      "members",
    );

    await openMenu();
    await clickMenuItem("로그아웃");
    expect(onLogout).toHaveBeenCalledOnce();

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

  it("opens application settings from the account menu", async () => {
    const onSettings = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<Sidebar {...sidebarProps} onSettings={onSettings} />);
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="계정 메뉴"]')
        ?.click();
    });
    await act(async () => {
      Array.from(
        container.querySelectorAll<HTMLAnchorElement>(
          ".account-popover a",
        ),
      )
        .find((anchor) => anchor.textContent?.includes("설정"))
        ?.click();
    });

    expect(onSettings).toHaveBeenCalledOnce();
    expect(container.querySelector(".account-popover")).toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it("opens PR readiness from the warning beside a project", async () => {
    const onProjectReadinessOpen = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Sidebar
          {...sidebarProps}
          onProjectReadinessOpen={onProjectReadinessOpen}
          projectReadiness={{
            "project-1": {
              repositoryPath: "/Users/jay/git/briar",
              gitInstalled: true,
              gitVersion: "git version 2.50.1",
              repositoryHealthy: true,
              remote: "git@github.com:wordbricks/briar.git",
              remoteReachable: true,
              pushAccess: true,
              requiresGithub: true,
              githubRepository: "wordbricks/briar",
              ghInstalled: false,
              ghVersion: null,
              ghAuthenticated: false,
              ghAccount: null,
              githubWriteAccess: false,
              gitReady: true,
              prReady: false,
              issues: ["GitHub CLI가 설치되지 않았습니다."],
            },
          }}
        />,
      );
    });

    const warning = container.querySelector<HTMLButtonElement>(
      '[data-project-readiness="project-1"]',
    );
    expect(warning?.textContent).toBe("!");
    await act(async () => warning?.click());
    expect(onProjectReadinessOpen).toHaveBeenCalledWith("project-1");

    await act(async () => root.unmount());
    container.remove();
  });

  it("flags projects that are not connected on this computer", () => {
    const markup = renderToStaticMarkup(
      <Sidebar {...sidebarProps} connectedProjectIds={[]} />,
    );

    expect(markup).toContain("sidebar-project-disconnected");
    expect(markup).toContain(
      "Briar: 이 컴퓨터에 저장소가 연결되지 않았습니다",
    );
  });

  it("keeps connected projects unflagged", () => {
    const markup = renderToStaticMarkup(<Sidebar {...sidebarProps} />);

    expect(markup).not.toContain("sidebar-project-disconnected");
  });

  it("leaves projects unflagged when the local state is unknown", () => {
    const markup = renderToStaticMarkup(
      <Sidebar {...sidebarProps} connectedProjectIds={null} />,
    );

    expect(markup).not.toContain("sidebar-project-disconnected");
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
