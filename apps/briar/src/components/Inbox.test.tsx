/** @vitest-environment jsdom */

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InboxMessageWithReadState } from "../hooks/useInbox";
import { I18nProvider } from "../i18n";
import { installKeyboardListNavigation } from "../lib/keyboard-list-navigation";
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
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
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
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

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

    const stopKeyboardNavigation = installKeyboardListNavigation();
    const firstMessage = container.querySelector<HTMLElement>(
      ".inbox-message-open",
    );
    firstMessage!.scrollIntoView = vi.fn();
    const navigationEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "KeyJ",
      key: "j",
    });
    projectFilter?.dispatchEvent(navigationEvent);
    expect(navigationEvent.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(firstMessage);
    stopKeyboardNavigation();
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
    expect(document.activeElement).toBe(
      container.querySelector(".inbox-message-open"),
    );
  });

  it("keeps keyboard navigation and the selected detail message in sync", async () => {
    const messages = [
      issue("first", "First issue", { priority: 1, status: "failed" }),
      issue("second", "Second issue", { priority: 1, status: "failed" }),
      issue("third", "Third issue", { priority: 1, status: "failed" }),
    ];
    const onOpen = vi.fn();

    function Harness() {
      const [selectedMessageId, setSelectedMessageId] = useState<string | null>(
        null,
      );
      return (
        <I18nProvider>
          <Inbox
            isSidebarOpen
            messages={messages}
            onMarkAllRead={vi.fn()}
            onMarkRead={vi.fn()}
            onOpen={(message) => {
              onOpen(message);
              setSelectedMessageId(message.id);
            }}
            projects={projects}
            selectedMessageId={selectedMessageId}
            unreadCount={messages.length}
          />
        </I18nProvider>
      );
    }

    await act(async () => root.render(<Harness />));
    const projectFilter = container.querySelector<HTMLButtonElement>(
      '[aria-label="프로젝트 필터"]',
    )!;
    const messageButtons = [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".inbox-message-open",
      ),
    ];
    for (const messageButton of messageButtons) {
      messageButton.scrollIntoView = vi.fn();
    }
    expect(
      container
        .querySelector("[data-keyboard-list]")
        ?.hasAttribute("data-keyboard-list-activate-on-navigation"),
    ).toBe(true);

    const stopKeyboardNavigation = installKeyboardListNavigation();
    const navigate = async (
      key: "j" | "k",
      { repeat = false }: { repeat?: boolean } = {},
    ) => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        code: key === "j" ? "KeyJ" : "KeyK",
        key,
        repeat,
      });
      await act(async () => projectFilter.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(true);
    };

    projectFilter.focus();
    await navigate("j");
    expect(onOpen).toHaveBeenLastCalledWith(messages[0]);
    expect(document.activeElement).toBe(messageButtons[0]);
    expect(messageButtons[0]?.getAttribute("aria-current")).toBe("true");

    projectFilter.focus();
    await navigate("j");
    expect(onOpen).toHaveBeenLastCalledWith(messages[1]);
    expect(document.activeElement).toBe(messageButtons[1]);
    expect(messageButtons[1]?.hasAttribute("data-keyboard-list-current")).toBe(
      true,
    );

    projectFilter.focus();
    await navigate("j", { repeat: true });
    expect(onOpen).toHaveBeenLastCalledWith(messages[2]);
    expect(document.activeElement).toBe(messageButtons[2]);

    projectFilter.focus();
    await navigate("k");
    expect(onOpen).toHaveBeenLastCalledWith(messages[1]);
    expect(document.activeElement).toBe(messageButtons[1]);
    stopKeyboardNavigation();
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

    const scroll = container.querySelector<HTMLDivElement>(".inbox-list");
    expect(scroll).not.toBeNull();
    expect(scroll?.getAttribute("data-visible-count")).toBe("50");
    expect(scroll?.getAttribute("data-has-more")).toBe("true");
    expect(container.querySelector(".inbox-list[data-keyboard-list]")).not.toBeNull();
    expect(container.querySelectorAll(".inbox-message")).toHaveLength(50);
    expect(
      container.querySelectorAll(
        ".inbox-message-open[data-keyboard-list-item]",
      ),
    ).toHaveLength(50);
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

    const scroll = container.querySelector<HTMLDivElement>(".inbox-list");
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
