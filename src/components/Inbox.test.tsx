/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InboxMessageWithReadState } from "../hooks/useInbox";
import { I18nProvider } from "../i18n";
import type { Project } from "../types";
import { Inbox } from "./Inbox";

const projects: Project[] = [
  { id: "project-1", name: "Briar", createdAt: "2026-07-01T00:00:00.000Z" },
  { id: "project-2", name: "Sprout", createdAt: "2026-07-02T00:00:00.000Z" },
];

const issue = (
  id: string,
  title: string,
  overrides: Partial<InboxMessageWithReadState> = {},
): InboxMessageWithReadState => ({
  id,
  kind: "issue",
  projectId: "project-1",
  projectName: "Briar",
  targetId: id,
  title,
  occurredAt: "2026-07-28T07:47:00.000Z",
  version: `${id}:1`,
  runNumber: 1,
  status: "completed",
  workflowStage: null,
  priority: 3,
  structuredResult: null,
  isUnread: true,
  ...overrides,
}) as InboxMessageWithReadState;

describe("Inbox", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.setItem("briar.locale.v1", "ko");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    localStorage.removeItem("briar.locale.v1");
    vi.restoreAllMocks();
  });

  it("shows one list with attention filters selected by default", async () => {
    const messages = [
      issue("urgent", "Production is blocked", {
        status: "failed",
        priority: 1,
      }),
      issue("action", "Release scope decision", {
        structuredResult: {
          summary: "A release decision is required.",
          outcome: "partial",
          importance: "important",
          urgency: "time_sensitive",
          impact: "project",
          humanActionRequired: true,
          nextAction: "Choose the release scope.",
          dueAt: null,
        },
      }),
      issue("important", "Milestone shipped", {
        structuredResult: {
          summary: "The project milestone shipped.",
          outcome: "completed",
          importance: "important",
          urgency: "normal",
          impact: "project",
          humanActionRequired: false,
          nextAction: null,
          dueAt: null,
        },
      }),
      issue("activity", "Routine dependency update", {
        structuredResult: {
          summary: "Routine maintenance completed.",
          outcome: "completed",
          importance: "routine",
          urgency: "normal",
          impact: "issue",
          humanActionRequired: false,
          nextAction: null,
          dueAt: null,
        },
      }),
    ];

    await act(async () =>
      root.render(
        <I18nProvider>
          <Inbox
            isSidebarOpen
            messages={messages}
            onMarkAllRead={vi.fn()}
            onMarkRead={vi.fn()}
            onOpen={vi.fn()}
            projects={projects}
            unreadCount={3}
          />
        </I18nProvider>,
      ),
    );

    const filters = [...container.querySelectorAll(".inbox-filter")];
    expect(filters).toHaveLength(4);
    expect(
      filters.map((filter) => filter.getAttribute("aria-pressed")),
    ).toEqual(["true", "true", "true", "false"]);
    expect(container.textContent).toContain("Production is blocked");
    expect(container.textContent).toContain("다음 행동: Choose the release scope.");
    expect(container.textContent).not.toContain("Routine dependency update");
    expect(container.querySelectorAll(".inbox-list")).toHaveLength(1);
    expect(container.querySelectorAll(".inbox-message")).toHaveLength(3);
    expect(container.querySelector(".inbox-section")).toBeNull();

    const activityFilter = filters.find((button) =>
      button.textContent?.includes("최근 활동"),
    );
    await act(async () =>
      (activityFilter as HTMLButtonElement | undefined)?.click(),
    );

    expect(container.textContent).toContain("Routine dependency update");
    expect(activityFilter?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelectorAll(".inbox-message")).toHaveLength(4);
  });

  it("renders compact rows with title and detail content only", async () => {
    const message = issue("action", "Release scope decision", {
      structuredResult: {
        summary: "A release decision is required.",
        outcome: "partial",
        importance: "important",
        urgency: "time_sensitive",
        impact: "project",
        humanActionRequired: true,
        nextAction: "Choose the release scope.",
        dueAt: null,
      },
    });

    await act(async () =>
      root.render(
        <I18nProvider>
          <Inbox
            isSidebarOpen
            messages={[message]}
            onMarkAllRead={vi.fn()}
            onMarkRead={vi.fn()}
            onOpen={vi.fn()}
            projects={projects}
            unreadCount={1}
          />
        </I18nProvider>,
      ),
    );

    const row = container.querySelector(".inbox-message");
    expect(row?.querySelector(".inbox-message-copy > strong")?.textContent).toBe(
      "Release scope decision",
    );
    expect(row?.querySelector(".inbox-message-detail")?.textContent).toContain(
      "Briar·다음 행동: Choose the release scope.",
    );
    expect(row?.querySelector(".inbox-message-time")).not.toBeNull();
    expect(row?.querySelector(".inbox-next-action")).toBeNull();
  });

  it("filters messages and category counts by project", async () => {
    const messages = [
      issue("briar-urgent", "Briar deployment failed", {
        status: "failed",
        priority: 1,
      }),
      issue("sprout-urgent", "Sprout deployment failed", {
        projectId: "project-2",
        projectName: "Sprout",
        status: "failed",
        priority: 1,
      }),
      issue("sprout-important", "Sprout milestone shipped", {
        projectId: "project-2",
        projectName: "Sprout",
        priority: 2,
      }),
    ];

    await act(async () =>
      root.render(
        <I18nProvider>
          <Inbox
            isSidebarOpen
            messages={messages}
            onMarkAllRead={vi.fn()}
            onMarkRead={vi.fn()}
            onOpen={vi.fn()}
            projects={projects}
            unreadCount={3}
          />
        </I18nProvider>,
      ),
    );

    const projectFilter = container.querySelector<HTMLButtonElement>(
      '[aria-label="프로젝트 필터"]',
    );
    expect(projectFilter?.textContent).toContain("모든 프로젝트");

    await act(async () => projectFilter?.click());
    const sproutOption = document.querySelector<HTMLButtonElement>(
      '[role="option"][data-value="project-2"]',
    );
    await act(async () => sproutOption?.click());

    expect(projectFilter?.textContent).toContain("Sprout");
    expect(container.textContent).not.toContain("Briar deployment failed");
    expect(container.textContent).toContain("Sprout deployment failed");
    expect(container.textContent).toContain("Sprout milestone shipped");
    expect(
      container.querySelector(".inbox-filter.urgent .inbox-filter-count")
        ?.textContent,
    ).toBe("1");
    expect(
      container.querySelector(".inbox-filter.important .inbox-filter-count")
        ?.textContent,
    ).toBe("1");
  });

  it("marks one message as read without opening its destination", async () => {
    const message = issue("unread", "Review this update", {
      priority: 1,
      status: "failed",
    });
    const onMarkRead = vi.fn();
    const onOpen = vi.fn();

    await act(async () =>
      root.render(
        <I18nProvider>
          <Inbox
            isSidebarOpen
            messages={[message]}
            onMarkAllRead={vi.fn()}
            onMarkRead={onMarkRead}
            onOpen={onOpen}
            projects={projects}
            unreadCount={1}
          />
        </I18nProvider>,
      ),
    );

    const markRead = container.querySelector<HTMLButtonElement>(
      ".inbox-mark-read",
    );
    expect(markRead?.getAttribute("aria-label")).toBe("읽음으로 표시");

    await act(async () => markRead?.click());

    expect(onMarkRead).toHaveBeenCalledOnce();
    expect(onMarkRead).toHaveBeenCalledWith(message.id);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("shows mention and thread-reply context in conversation rows", async () => {
    const messages: InboxMessageWithReadState[] = [
      {
        id: "conversation:mention",
        kind: "conversation",
        projectId: "project-1",
        projectName: "Briar",
        targetId: "run-1",
        rootMessageId: "message-1",
        title: "Review login behavior",
        occurredAt: "2026-07-28T07:47:00.000Z",
        version: "mention",
        body: "@owner 확인해 주세요.",
        authorName: "Member",
        reason: "mention",
        isUnread: true,
      },
      {
        id: "conversation:reply",
        kind: "conversation",
        projectId: "project-1",
        projectName: "Briar",
        targetId: "run-1",
        rootMessageId: "message-root",
        title: "Review login behavior",
        occurredAt: "2026-07-28T07:48:00.000Z",
        version: "reply",
        body: "재현 절차를 추가했습니다.",
        authorName: "Member",
        reason: "thread_reply",
        isUnread: true,
      },
    ];

    await act(async () =>
      root.render(
        <I18nProvider>
          <Inbox
            isSidebarOpen
            messages={messages}
            onMarkAllRead={vi.fn()}
            onMarkRead={vi.fn()}
            onOpen={vi.fn()}
            projects={projects}
            unreadCount={2}
          />
        </I18nProvider>,
      ),
    );

    expect(container.textContent).toContain("Member님이 회원님을 멘션했습니다.");
    expect(container.textContent).toContain(
      "Member님이 회원님의 스레드에 답글을 남겼습니다.",
    );
    expect(container.textContent).toContain("@owner 확인해 주세요.");
    expect(container.textContent).toContain("재현 절차를 추가했습니다.");
  });
});
