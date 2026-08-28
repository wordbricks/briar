/** @vitest-environment jsdom */

import { act, useState, type ReactNode } from "react";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppKeyboardCommandProvider } from "../hooks/appKeyboardCommands";
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
    issueKeyPrefix: "BR",
    scheduleTabEnabled: true,
    icon: "data:image/webp;base64,briar-icon",
    organizationId: "organization-1",
    organizationName: "Briar",
    role: "owner",
    createdAt: "2026-07-01T00:00:00.000Z",
  },
  {
    id: "project-2",
    name: "Sprout",
    issueKeyPrefix: "SP",
    scheduleTabEnabled: true,
    icon: "data:image/webp;base64,sprout-icon",
    organizationId: "organization-1",
    organizationName: "Briar",
    role: "member",
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

function TestProviders({ children }: { children: ReactNode }) {
  return (
    <AppKeyboardCommandProvider>
      <I18nProvider>{children}</I18nProvider>
    </AppKeyboardCommandProvider>
  );
}

describe("Inbox", () => {
  let cleanup: () => Promise<void>;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createReactTestRoot>["root"];

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.setItem("briar.locale.v1", "ko");
    ({ cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    }));
  });

  afterEach(async () => {
    await cleanup();
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
    const onOpen = vi.fn();

    await renderReactTestRoot(
      root,
      <TestProviders>
        <Inbox
          isSidebarOpen
          messages={messages}
          onMarkAllRead={vi.fn()}
          onMarkRead={vi.fn()}
          onOpen={onOpen}
          projects={projects}
          unreadCount={3}
        />
      </TestProviders>,
    );

    const projectFilter = container.querySelector<HTMLButtonElement>(
      '[aria-label="프로젝트 필터"]',
    )!;
    expect(projectFilter?.textContent).toContain("모든 프로젝트");

    const initialFirstMessage = container.querySelector<HTMLButtonElement>(
      ".inbox-message-open",
    )!;
    initialFirstMessage.scrollIntoView = vi.fn();
    const initialNavigationEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "KeyJ",
      key: "j",
    });
    await act(async () => projectFilter.dispatchEvent(initialNavigationEvent));
    expect(initialNavigationEvent.defaultPrevented).toBe(true);
    expect(onOpen).toHaveBeenLastCalledWith(messages[0]);

    await act(async () => projectFilter.click());
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

    const firstMessage = container.querySelector<HTMLButtonElement>(
      ".inbox-message-open",
    )!;
    firstMessage.scrollIntoView = vi.fn();
    const click = vi.spyOn(firstMessage, "click");
    const navigationEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "KeyJ",
      key: "j",
    });
    await act(async () => projectFilter.dispatchEvent(navigationEvent));
    expect(navigationEvent.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(firstMessage);
    expect(onOpen).toHaveBeenLastCalledWith(messages[1]);
    expect(click).not.toHaveBeenCalled();
  });

  it("marks one message as read without opening its destination", async () => {
    const message = issue("unread", "Review this update", {
      priority: 1,
      status: "failed",
    });
    const onMarkRead = vi.fn();
    const onOpen = vi.fn();

    await renderReactTestRoot(
      root,
      <TestProviders>
        <Inbox
          isSidebarOpen
          messages={[message]}
          onMarkAllRead={vi.fn()}
          onMarkRead={onMarkRead}
          onOpen={onOpen}
          projects={projects}
          unreadCount={1}
        />
      </TestProviders>,
    );

    const markRead = container.querySelector<HTMLButtonElement>(
      ".inbox-mark-read",
    );
    expect(markRead?.getAttribute("aria-label")).toBe("읽음으로 표시");

    await act(async () => markRead?.click());

    expect(onMarkRead).toHaveBeenCalledOnce();
    expect(onMarkRead).toHaveBeenCalledWith(message.id);
    expect(onOpen).not.toHaveBeenCalled();
    const openButton = container.querySelector(".inbox-message-open");
    expect(document.activeElement).toBe(openButton);
    expect(openButton?.hasAttribute("data-keyboard-list-current")).toBe(true);
  });

  it("marks one read message as unread without opening its destination", async () => {
    const message = issue("read", "Revisit this update", {
      isUnread: false,
      priority: 1,
      status: "failed",
    });
    const onMarkUnread = vi.fn();
    const onOpen = vi.fn();

    await renderReactTestRoot(
      root,
      <TestProviders>
        <Inbox
          isSidebarOpen
          messages={[message]}
          onMarkAllRead={vi.fn()}
          onMarkRead={vi.fn()}
          onMarkUnread={onMarkUnread}
          onOpen={onOpen}
          projects={projects}
          unreadCount={0}
        />
      </TestProviders>,
    );

    const markUnread = container.querySelector<HTMLButtonElement>(
      ".inbox-mark-unread",
    );
    expect(markUnread?.getAttribute("aria-label")).toBe("읽지 않음으로 표시");

    await act(async () => markUnread?.click());

    expect(onMarkUnread).toHaveBeenCalledWith(message.id);
    expect(onOpen).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(
      container.querySelector(".inbox-message-open"),
    );
  });

  it("preserves pointer, Enter, and Space activation on native buttons", async () => {
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
        <TestProviders>
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
        </TestProviders>
      );
    }

    await renderReactTestRoot(root, <Harness />);
    const buttons = [
      ...container.querySelectorAll<HTMLButtonElement>(".inbox-message-open"),
    ];
    expect(buttons.every((button) => button.type === "button")).toBe(true);

    await act(async () => buttons[1]?.focus());
    expect(onOpen).not.toHaveBeenCalled();
    expect(buttons[1]?.hasAttribute("data-keyboard-list-current")).toBe(true);

    await act(async () => {
      buttons[1]?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, detail: 1 }),
      );
    });
    expect(onOpen).toHaveBeenLastCalledWith(messages[1]);
    expect(buttons[1]?.hasAttribute("data-keyboard-list-current")).toBe(true);

    const enter = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "Enter",
      key: "Enter",
    });
    await act(async () => {
      buttons[0]?.dispatchEvent(enter);
      buttons[0]?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, detail: 0 }),
      );
    });
    expect(enter.defaultPrevented).toBe(false);
    expect(onOpen).toHaveBeenLastCalledWith(messages[0]);
    expect(buttons[0]?.getAttribute("aria-current")).toBe("true");

    const space = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "Space",
      key: " ",
    });
    await act(async () => {
      buttons[2]?.dispatchEvent(space);
      buttons[2]?.dispatchEvent(
        new KeyboardEvent("keyup", {
          bubbles: true,
          cancelable: true,
          code: "Space",
          key: " ",
        }),
      );
      buttons[2]?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, detail: 0 }),
      );
    });
    expect(space.defaultPrevented).toBe(false);
    expect(onOpen).toHaveBeenLastCalledWith(messages[2]);
    expect(buttons[2]?.hasAttribute("data-keyboard-list-current")).toBe(true);
  });

  it("does not claim list navigation commands in companion mode", async () => {
    const onOpen = vi.fn();
    await renderReactTestRoot(
      root,
      <TestProviders>
        <button data-testid="companion-outside" type="button">
          Outside
        </button>
        <Inbox
          companionMode
          isSidebarOpen
          messages={[issue("message", "Companion message")]}
          onMarkAllRead={vi.fn()}
          onMarkRead={vi.fn()}
          onOpen={onOpen}
          projects={projects}
          unreadCount={1}
        />
      </TestProviders>,
    );
    const outside = container.querySelector<HTMLButtonElement>(
      '[data-testid="companion-outside"]',
    )!;
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "KeyJ",
      key: "j",
    });

    outside.focus();
    await act(async () => outside.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(outside);
    expect(onOpen).not.toHaveBeenCalled();
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
        <TestProviders>
          <button data-testid="outside-inbox" type="button">Outside</button>
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
        </TestProviders>
      );
    }

    await renderReactTestRoot(root, <Harness />);
    const outside = container.querySelector<HTMLButtonElement>(
      '[data-testid="outside-inbox"]',
    )!;
    const messageButtons = [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".inbox-message-open",
      ),
    ];
    for (const messageButton of messageButtons) {
      messageButton.scrollIntoView = vi.fn();
    }
    const clickSpies = messageButtons.map((messageButton) =>
      vi.spyOn(messageButton, "click")
    );
    expect(
      container
        .querySelector("[data-keyboard-list]")
        ?.hasAttribute("data-keyboard-list-activate-on-navigation"),
    ).toBe(false);

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
      await act(async () => outside.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(true);
    };

    outside.focus();
    await navigate("j");
    expect(onOpen).toHaveBeenLastCalledWith(messages[0]);
    expect(document.activeElement).toBe(messageButtons[0]);
    expect(messageButtons[0]?.getAttribute("aria-current")).toBe("true");

    outside.focus();
    await navigate("j");
    expect(onOpen).toHaveBeenLastCalledWith(messages[1]);
    expect(document.activeElement).toBe(messageButtons[1]);
    expect(messageButtons[1]?.hasAttribute("data-keyboard-list-current")).toBe(
      true,
    );

    outside.focus();
    await navigate("j", { repeat: true });
    expect(onOpen).toHaveBeenLastCalledWith(messages[2]);
    expect(document.activeElement).toBe(messageButtons[2]);

    const openCountAtBoundary = onOpen.mock.calls.length;
    outside.focus();
    await navigate("j", { repeat: true });
    expect(onOpen).toHaveBeenCalledTimes(openCountAtBoundary);
    expect(document.activeElement).toBe(messageButtons[2]);

    outside.focus();
    await navigate("k");
    expect(onOpen).toHaveBeenLastCalledWith(messages[1]);
    expect(document.activeElement).toBe(messageButtons[1]);
    for (const clickSpy of clickSpies) expect(clickSpy).not.toHaveBeenCalled();
  });







  it("renders the first 50 filtered messages and loads more on scroll", async () => {
    const messages = Array.from({ length: 120 }, (_, index) =>
      issue(`urgent-${index}`, `Urgent issue ${index}`, {
        status: "failed",
        priority: 1,
        occurredAt: new Date(Date.UTC(2026, 6, 28, 8, index)).toISOString(),
      }),
    );

    await renderReactTestRoot(
      root,
      <TestProviders>
        <Inbox
          isSidebarOpen
          messages={messages}
          onMarkAllRead={vi.fn()}
          onMarkRead={vi.fn()}
          onOpen={vi.fn()}
          projects={projects}
          unreadCount={120}
        />
      </TestProviders>,
    );

    const scroll = container.querySelector<HTMLDivElement>(".inbox-list");
    expect(scroll).not.toBeNull();
    expect(scroll?.getAttribute("data-visible-count")).toBe("50");
    expect(scroll?.getAttribute("data-has-more")).toBe("true");
    expect(
      container.querySelector(".inbox-list[data-keyboard-list]"),
    ).not.toBeNull();
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

    await renderReactTestRoot(
      root,
      <TestProviders>
        <Inbox
          isSidebarOpen
          messages={messages}
          onMarkAllRead={vi.fn()}
          onMarkRead={vi.fn()}
          onOpen={vi.fn()}
          projects={projects}
          unreadCount={120}
        />
      </TestProviders>,
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

  it("renders the project select with fixed width utility and responsive filtered count", async () => {
    await renderReactTestRoot(
      root,
      <TestProviders>
        <Inbox
          isSidebarOpen
          messages={[]}
          onMarkAllRead={vi.fn()}
          onMarkRead={vi.fn()}
          onOpen={vi.fn()}
          projects={projects}
          unreadCount={0}
        />
      </TestProviders>,
    );

    const filterBar = container.querySelector(".inbox-filter-bar");
    const projectFilter = filterBar?.querySelector(".inbox-project-filter");
    expect(projectFilter?.classList.contains("!w-[176px]")).toBe(true);
    expect(projectFilter?.classList.contains("!shrink-0")).toBe(true);
    expect(projectFilter?.classList.contains("max-[760px]:!w-full")).toBe(true);
    expect(projectFilter?.classList.contains("max-[760px]:!flex-auto")).toBe(true);

    const count = filterBar?.querySelector(".font-mono");
    expect(count?.classList.contains("max-[760px]:hidden")).toBe(true);
  });
});
