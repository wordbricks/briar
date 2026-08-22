/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InboxMessageWithReadState } from "../hooks/useInbox";
import { I18nProvider } from "../i18n";
import type { Project } from "../types";
import {
  Inbox,
  INBOX_PAGE_SIZE,
  nextInboxVisibleCount,
  pageInboxMessages,
} from "./Inbox";

const projects: Project[] = [
  {
    id: "project-1",
    name: "Briar",
    icon: "data:image/webp;base64,briar-icon",
    createdAt: "2026-07-01T00:00:00.000Z",
  },
  {
    id: "project-2",
    name: "Sprout",
    icon: "data:image/webp;base64,sprout-icon",
    createdAt: "2026-07-02T00:00:00.000Z",
  },
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







  it("renders the first 50 filtered messages and loads more on scroll", async () => {
    const messages = Array.from({ length: 120 }, (_, index) =>
      issue(`urgent-${index}`, `Urgent issue ${index}`, {
        status: "failed",
        priority: 1,
        occurredAt: new Date(Date.UTC(2026, 6, 28, 8, index)).toISOString(),
      }),
    );

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
            unreadCount={120}
          />
        </I18nProvider>,
      ),
    );

    const scroll = container.querySelector<HTMLDivElement>(".inbox-scroll");
    expect(scroll).not.toBeNull();
    expect(scroll?.getAttribute("data-visible-count")).toBe("50");
    expect(scroll?.getAttribute("data-has-more")).toBe("true");
    expect(container.querySelectorAll(".inbox-message")).toHaveLength(50);
    expect(container.textContent).toContain("Urgent issue 0");
    expect(container.textContent).toContain("Urgent issue 49");
    expect(container.textContent).not.toContain("Urgent issue 50");
    expect(
      container.querySelector('[data-testid="inbox-load-more-sentinel"]'),
    ).not.toBeNull();

    Object.defineProperty(scroll!, "scrollHeight", {
      configurable: true,
      value: 4_000,
    });
    Object.defineProperty(scroll!, "clientHeight", {
      configurable: true,
      value: 600,
    });
    Object.defineProperty(scroll!, "scrollTop", {
      configurable: true,
      value: 3_500,
      writable: true,
    });

    await act(async () => {
      scroll!.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    expect(scroll?.getAttribute("data-visible-count")).toBe("100");
    expect(container.querySelectorAll(".inbox-message")).toHaveLength(100);
    expect(container.textContent).toContain("Urgent issue 99");
    expect(container.textContent).not.toContain("Urgent issue 100");

    Object.defineProperty(scroll!, "scrollTop", {
      configurable: true,
      value: 3_500,
      writable: true,
    });
    await act(async () => {
      scroll!.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    expect(scroll?.getAttribute("data-visible-count")).toBe("120");
    expect(scroll?.getAttribute("data-has-more")).toBe("false");
    expect(container.querySelectorAll(".inbox-message")).toHaveLength(120);
    expect(
      container.querySelector('[data-testid="inbox-load-more-sentinel"]'),
    ).toBeNull();
  });

  it("resets the visible page when filters change", async () => {
    const messages = [
      ...Array.from({ length: 60 }, (_, index) =>
        issue(`urgent-${index}`, `Urgent issue ${index}`, {
          status: "failed",
          priority: 1,
        }),
      ),
      ...Array.from({ length: 60 }, (_, index) =>
        issue(`important-${index}`, `Important issue ${index}`, {
          priority: 2,
          structuredResult: {
            summary: "Important update.",
            outcome: "completed",
            importance: "important",
            urgency: "normal",
            impact: "project",
            humanActionRequired: false,
            nextAction: null,
            dueAt: null,
          },
        }),
      ),
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
            unreadCount={120}
          />
        </I18nProvider>,
      ),
    );

    const scroll = container.querySelector<HTMLDivElement>(".inbox-scroll");
    Object.defineProperty(scroll!, "scrollHeight", {
      configurable: true,
      value: 4_000,
    });
    Object.defineProperty(scroll!, "clientHeight", {
      configurable: true,
      value: 600,
    });
    Object.defineProperty(scroll!, "scrollTop", {
      configurable: true,
      value: 3_500,
      writable: true,
    });
    await act(async () => {
      scroll!.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(scroll?.getAttribute("data-visible-count")).toBe("100");

    const urgentFilter = container.querySelector<HTMLButtonElement>(
      ".inbox-filter.urgent",
    );
    await act(async () => urgentFilter?.click());

    expect(scroll?.getAttribute("data-visible-count")).toBe("50");
    expect(container.querySelectorAll(".inbox-message")).toHaveLength(50);
    expect(container.textContent).toContain("Important issue 0");
    expect(container.textContent).not.toContain("Urgent issue 0");
  });
});
