/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AutoHuntSession } from "../hooks/useAutoHuntSessions";
import { Sidebar } from "./Sidebar";
import { I18nProvider } from "../i18n";

const sidebarProps = {
  activePage: "issues" as const,
  activeOrganizationId: "organization-1",
  activeProjectId: "project-1",
  agents: [],
  connectedProjectIds: ["project-1"],
  isOpen: true,
  onAddProject: () => undefined,
  onAgentSessionOpen: () => undefined,
  onAgentsOpen: () => undefined,
  onLobbyOpen: () => undefined,
  onScheduleOpen: () => undefined,
  onInboxOpen: () => undefined,
  onIssuesOpen: () => undefined,
  onCreateIssue: () => undefined,
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
      logo: null,
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
  sessions: [],
  token: null,
  unreadInboxCount: 0,
  user: { id: "user-1", name: "Jay", email: "jay@example.com" },
};

describe("Sidebar", () => {
  it("shows channels as an accordion and creates one from its context menu", async () => {
    const onChannelOpen = vi.fn();
    const onChannelCreate = vi.fn().mockResolvedValue(undefined);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Sidebar
          {...sidebarProps}
          activeChannelId="channel-1"
          activePage="channels"
          channels={[
            {
              id: "channel-1",
              organizationId: "organization-1",
              slug: "general",
              name: "General",
              topic: null,
              visibility: "public",
              defaultProjectId: null,
              archivedAt: null,
              memberCount: 1,
              agentCount: 0,
              createdAt: "2026-08-01T00:00:00Z",
              updatedAt: "2026-08-01T00:00:00Z",
            },
          ]}
          onChannelCreate={onChannelCreate}
          onChannelOpen={onChannelOpen}
        />,
      );
    });

    const toggle = container.querySelector<HTMLButtonElement>(
      ".sidebar-channels-toggle",
    )!;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".sidebar-channel-list")?.textContent).toContain(
      "General",
    );

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".sidebar-channel-list button")
        ?.click();
    });
    expect(onChannelOpen).toHaveBeenCalledWith("channel-1");

    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".sidebar-channel-list")).toBeNull();
    await act(async () => toggle.click());

    await act(async () => {
      toggle.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          button: 2,
          cancelable: true,
          clientX: 120,
          clientY: 90,
        }),
      );
    });
    const addItem = document.body.querySelector<HTMLElement>(
      ".sidebar-channel-context-menu-item",
    );
    expect(addItem?.textContent).toContain("채널 추가");
    await act(async () => addItem?.click());

    const dialog = document.body.querySelector<HTMLElement>(
      ".channel-create-dialog",
    );
    expect(dialog?.textContent).toContain("새 채널");
    const input = dialog?.querySelector<HTMLInputElement>("input")!;
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    valueSetter.call(input, "제품 피드백");
    await act(async () => {
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      dialog
        ?.querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(onChannelCreate).toHaveBeenCalledWith("제품 피드백");
    await act(async () => root.unmount());
    container.remove();
  });

  it("bolds unread channel names and restores the regular weight when read", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const unreadChannel = {
      id: "channel-1",
      organizationId: "organization-1",
      slug: "general",
      name: "General",
      topic: null,
      visibility: "public" as const,
      defaultProjectId: null,
      archivedAt: null,
      memberCount: 1,
      agentCount: 0,
      createdAt: "2026-08-01T00:00:00Z",
      updatedAt: "2026-08-01T00:00:00Z",
      hasUnread: true,
    };
    await act(async () => {
      root.render(
        <Sidebar
          {...sidebarProps}
          activePage="issues"
          channels={[unreadChannel]}
          onChannelOpen={() => undefined}
        />,
      );
    });
    expect(
      container.querySelector(".sidebar-channel-list button")?.className,
    ).toContain("unread");

    await act(async () => {
      root.render(
        <Sidebar
          {...sidebarProps}
          activePage="issues"
          channels={[{ ...unreadChannel, hasUnread: false }]}
          onChannelOpen={() => undefined}
        />,
      );
    });
    expect(
      container.querySelector(".sidebar-channel-list button")?.className,
    ).not.toContain("unread");

    await act(async () => root.unmount());
    container.remove();
  });

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
    expect(markup).toContain("홈");
    expect(markup).toContain('href="#project-lobby"');
    expect(markup).toContain('class="sidebar-issue-add"');
    expect(markup).toContain('aria-label="이슈 만들기"');
    expect(markup).toContain("에이전트");
    expect(markup).not.toContain("아이디어");
    expect(markup).toContain("스케줄");
    expect(markup).toContain("받은 편지함");
    expect(markup).not.toContain('href="#auto-hunt"');
    expect(markup).not.toContain("도움말");
    expect(markup).not.toContain('href="#help"');
    expect(markup).toContain('aria-label="Briar 프로젝트 메뉴"');
    expect(markup).toContain('aria-label="Briar 프로젝트 접기"');
    expect(markup).toContain('class="sidebar-project-toggle"');
    expect(markup).toContain('id="project-views-project-1"');
    expect(markup).not.toContain("<select");
  });

  it("shows a saved project icon in the project hierarchy", () => {
    const markup = renderToStaticMarkup(
      <Sidebar
        {...sidebarProps}
        projects={[
          {
            ...sidebarProps.projects[0],
            icon: "data:image/webp;base64,aWNvbg==",
          },
        ]}
      />,
    );

    expect(markup).toContain('src="data:image/webp;base64,aWNvbg=="');
    expect(markup).toContain('class="shrink-0 rounded-sm object-contain size-4"');
  });

  it("opens projects by default and lets each project collapse independently", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Sidebar
          {...sidebarProps}
          projects={[
            ...sidebarProps.projects,
            {
              id: "project-2",
              name: "Console",
              organizationId: "organization-1",
              organizationName: "Briar",
              role: "member",
              createdAt: "2026-07-23T00:00:00Z",
            },
          ]}
        />,
      );
    });

    expect(container.querySelector("#project-views-project-1")).not.toBeNull();
    expect(container.querySelector("#project-views-project-2")).not.toBeNull();
    expect(
      container.querySelectorAll(".sidebar-project-view").length,
    ).toBeGreaterThanOrEqual(8);

    const collapseBriar = container.querySelector<HTMLButtonElement>(
      '[aria-label="Briar 프로젝트 접기"]',
    );
    await act(async () => collapseBriar?.click());

    expect(container.querySelector("#project-views-project-1")).toBeNull();
    expect(container.querySelector("#project-views-project-2")).not.toBeNull();
    expect(
      container.querySelector('[aria-label="Briar 프로젝트 펼치기"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[aria-label="Console 프로젝트 접기"]'),
    ).not.toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it("selects a project and keeps it expanded when opening a child view", async () => {
    const onProjectChange = vi.fn();
    const onIssuesOpen = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Sidebar
          {...sidebarProps}
          activeProjectId="project-1"
          onIssuesOpen={onIssuesOpen}
          onProjectChange={onProjectChange}
          projects={[
            ...sidebarProps.projects,
            {
              id: "project-2",
              name: "Console",
              organizationId: "organization-1",
              organizationName: "Briar",
              role: "member",
              createdAt: "2026-07-23T00:00:00Z",
            },
          ]}
        />,
      );
    });

    const consoleIssues = Array.from(
      container.querySelectorAll<HTMLAnchorElement>(".sidebar-project-view"),
    ).find(
      (link) =>
        link.getAttribute("href") === "#issues" &&
        link.closest(".sidebar-project-group")?.textContent?.includes("Console"),
    );
    await act(async () => consoleIssues?.click());

    expect(onProjectChange).toHaveBeenCalledWith("project-2");
    expect(onIssuesOpen).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    container.remove();
  });

  it("opens issue creation from the Issues row action", async () => {
    const onCreateIssue = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Sidebar {...sidebarProps} onCreateIssue={onCreateIssue} />,
      );
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".sidebar-issue-add")
        ?.click();
    });

    expect(onCreateIssue).toHaveBeenCalledOnce();
    expect(onCreateIssue).toHaveBeenCalledWith("project-1");

    await act(async () => root.unmount());
    container.remove();
  });

  it("opens issue creation for the clicked project when another is active", async () => {
    const onProjectChange = vi.fn();
    const onCreateIssue = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Sidebar
          {...sidebarProps}
          activeProjectId="project-1"
          onCreateIssue={onCreateIssue}
          onProjectChange={onProjectChange}
          projects={[
            ...sidebarProps.projects,
            {
              id: "project-2",
              name: "Console",
              organizationId: "organization-1",
              organizationName: "Briar",
              role: "owner" as const,
              createdAt: "2026-07-23T00:00:00Z",
            },
          ]}
        />,
      );
    });

    const consoleAdd = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".sidebar-issue-add"),
    ).find((button) =>
      button.closest(".sidebar-project-group")?.textContent?.includes("Console"),
    );
    expect(consoleAdd).toBeDefined();
    await act(async () => {
      consoleAdd?.click();
    });

    expect(onProjectChange).toHaveBeenCalledWith("project-2");
    expect(onCreateIssue).toHaveBeenCalledWith("project-2");

    await act(async () => root.unmount());
    container.remove();
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
              logo: null,
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

  it("shows running sessions beneath Agents and opens their details", async () => {
    const onAgentSessionOpen = vi.fn();
    const runningSession: AutoHuntSession = {
      id: "session-running",
      dispatchGroupId: "session-running",
      projectId: "project-1",
      agentId: "agent-1",
      sessionType: "task",
      request: "Inspect briar design system",
      status: "running",
      issues: [],
      startedAt: "2026-07-29T00:00:00.000Z",
      completedAt: null,
      conversationId: null,
      workspaceRoot: null,
      summary: null,
      error: null,
      events: [],
      dispatchEvents: [],
      workers: [],
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Sidebar
          {...sidebarProps}
          agents={[
            {
              id: "agent-1",
              projectId: "project-1",
              name: "Design agent",
              avatar: "data:image/png;base64,avatar",
              codexPet: null,
              provider: "codex",
              model: null,
              effort: null,
              responsibility: "Inspect the design system",
              skill: "# Agent",
              skills: [],
              calendarColor: "#3275d5",
              createdAt: "2026-07-28T00:00:00.000Z",
              updatedAt: "2026-07-28T00:00:00.000Z",
            },
          ]}
          onAgentSessionOpen={onAgentSessionOpen}
          sessions={[
            runningSession,
            {
              ...runningSession,
              id: "session-completed",
              dispatchGroupId: "session-completed",
              request: "Already finished",
              status: "completed",
              completedAt: "2026-07-29T00:10:00.000Z",
            },
          ]}
        />,
      );
    });

    const sessionButton = container.querySelector<HTMLButtonElement>(
      ".sidebar-agent-session",
    );
    expect(sessionButton?.textContent).toContain(
      "Inspect briar design system",
    );
    expect(sessionButton?.textContent).toContain("Design agent");
    expect(
      sessionButton?.querySelector(".project-agent-avatar img"),
    ).not.toBeNull();
    expect(container.textContent).not.toContain("Already finished");

    await act(async () => sessionButton?.click());
    expect(onAgentSessionOpen).toHaveBeenCalledWith("session-running");

    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps a running session visible when another project is active", async () => {
    const onAgentSessionOpen = vi.fn();
    const onProjectChange = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Sidebar
          {...sidebarProps}
          activeProjectId="project-2"
          connectedProjectIds={["project-1", "project-2"]}
          onAgentSessionOpen={onAgentSessionOpen}
          onProjectChange={onProjectChange}
          projects={[
            ...sidebarProps.projects,
            {
              ...sidebarProps.projects[0],
              id: "project-2",
              name: "Other project",
            },
          ]}
          sessions={[{
            id: "session-running",
            dispatchGroupId: "session-running",
            projectId: "project-1",
            agentId: "agent-from-project-1",
            sessionType: "task",
            request: "Keep this session visible",
            status: "running",
            issues: [],
            startedAt: "2026-07-29T00:00:00.000Z",
            completedAt: null,
            conversationId: null,
            workspaceRoot: null,
            summary: null,
            error: null,
            events: [],
            dispatchEvents: [],
            workers: [],
          }]}
        />,
      );
    });

    const sessionButton = container.querySelector<HTMLButtonElement>(
      ".sidebar-agent-session",
    );
    expect(sessionButton?.textContent).toContain("Keep this session visible");
    expect(sessionButton?.querySelector(".project-agent-avatar svg"))
      .not.toBeNull();

    await act(async () => sessionButton?.click());
    expect(onProjectChange).toHaveBeenCalledWith("project-1");
    expect(onAgentSessionOpen).toHaveBeenCalledWith("session-running");

    await act(async () => root.unmount());
    container.remove();
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

  it("does not show a repository connection warning beside projects", () => {
    const markup = renderToStaticMarkup(
      <Sidebar {...sidebarProps} connectedProjectIds={[]} />,
    );

    expect(markup).not.toContain("sidebar-project-disconnected");
    expect(markup).not.toContain(
      "Briar: 이 컴퓨터에 저장소가 연결되지 않았습니다",
    );
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
    expect(container.textContent).not.toContain("Auto Hunt");
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
    expect(container.textContent).not.toContain("自动狩猎");
    expect(window.localStorage.getItem("briar.locale.v1")).toBe("zh");
    expect(document.documentElement.lang).toBe("zh-CN");
    await act(async () => root.unmount());
    container.remove();
  });
});
