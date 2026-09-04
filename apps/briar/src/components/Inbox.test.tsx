/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { act, useState, type ReactNode } from "react";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppKeyboardCommandProvider } from "../hooks/appKeyboardCommands";
import {
  visibleInboxMessageSummariesAtom,
  type InboxMessageSummary,
} from "../state/inbox/atoms";
import {
  classifyInboxMessage,
  type InboxMessage,
  type InboxMessageWithReadState,
} from "../state/inbox/model";
import { activeOrganizationIdAtom } from "../state/organization/atoms";
import { createTestRegistry, type AtomRegistry } from "../state/registry";
import { tokenAtom, userAtom } from "../state/session/atoms";
import { teamsAtom } from "../state/team/atoms";
import { seedInboxMessages } from "../test/inbox";
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
    iconName: null,
    iconColor: null,
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
    iconName: null,
    iconColor: null,
    organizationId: "organization-1",
    organizationName: "Briar",
    role: "developer",
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

/*
  The list is fed summaries and the rows read the store, so every case puts its
  messages in a registry and hands the list the four facts it filters on. The
  fixtures stay whole rows because that is what a case is about — an unread
  urgent failure, a read update — and `seed` splits them into the two halves the
  store keeps: the messages, and the versions that have been read.
*/

let registry: AtomRegistry;

const summaryOf = (
  message: InboxMessageWithReadState,
): InboxMessageSummary => ({
  id: message.id,
  projectId: message.projectId,
  category: classifyInboxMessage(message),
  isUnread: message.isUnread,
});

const seed = (
  rows: readonly InboxMessageWithReadState[],
): InboxMessageSummary[] => {
  seedInboxMessages(
    registry,
    rows.map(({ isUnread: _isUnread, ...message }) => message as InboxMessage),
    {
      readVersions: Object.fromEntries(
        rows.filter((row) => !row.isUnread).map((row) => [row.id, row.version]),
      ),
    },
  );
  return rows.map(summaryOf);
};

function TestProviders({ children }: { children: ReactNode }) {
  return (
    <RegistryContext.Provider value={registry}>
      <AppKeyboardCommandProvider>
        <I18nProvider>{children}</I18nProvider>
      </AppKeyboardCommandProvider>
    </RegistryContext.Provider>
  );
}

describe("Inbox", () => {
  let cleanup: () => Promise<void>;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createReactTestRoot>["root"];

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.setItem("briar.locale.v1", "ko");
    localStorage.removeItem("briar.inbox.v1:user-1");
    registry = createTestRegistry([
      [userAtom, { id: "user-1", name: "Tester", email: "tester@briar.local" }],
      [tokenAtom, "token-1"],
      [teamsAtom, projects],
      [activeOrganizationIdAtom, "organization-1"],
    ]);
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
          messages={seed(messages)}
          onMarkAllRead={vi.fn()}
          onMarkRead={vi.fn()}
          onOpen={onOpen}
          projects={projects}
          unreadCount={3}
        />
      </TestProviders>,
    );

    const projectFilter = container.querySelector<HTMLButtonElement>(
      '[aria-label="팀 필터"]',
    )!;
    expect(projectFilter?.textContent).toContain("모든 팀");

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
    expect(onOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: messages[0]!.id }),
    );

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
    expect(onOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: messages[1]!.id }),
    );
    expect(click).not.toHaveBeenCalled();
  });

  it("shows only unread messages within the selected project and categories", async () => {
    const messages = [
      issue("briar-unread", "Unread Briar failure", {
        status: "failed",
        priority: 1,
      }),
      issue("briar-read", "Read Briar failure", {
        isUnread: false,
        status: "failed",
        priority: 1,
      }),
      issue("briar-activity", "Unread Briar activity", {
        priority: 4,
      }),
      issue("sprout-unread", "Unread Sprout failure", {
        projectId: "project-2",
        projectName: "Sprout",
        status: "failed",
        priority: 1,
      }),
    ];

    await renderReactTestRoot(
      root,
      <TestProviders>
        <Inbox
          isSidebarOpen
          messages={seed(messages)}
          onMarkAllRead={vi.fn()}
          onMarkRead={vi.fn()}
          onOpen={vi.fn()}
          projects={projects}
          unreadCount={3}
        />
      </TestProviders>,
    );

    const unreadOnlyFilter = container.querySelector<HTMLButtonElement>(
      ".inbox-filter.unread-only",
    );
    expect(unreadOnlyFilter?.getAttribute("aria-label")).toBe(
      "읽지 않은 메시지만 보기",
    );
    expect(unreadOnlyFilter?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => unreadOnlyFilter?.click());

    expect(unreadOnlyFilter?.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("Unread Briar failure");
    expect(container.textContent).not.toContain("Read Briar failure");
    expect(container.textContent).not.toContain("Unread Briar activity");
    expect(container.textContent).toContain("Unread Sprout failure");
    expect(container.textContent).toContain("2개 표시");

    const projectFilter = container.querySelector<HTMLButtonElement>(
      '[aria-label="팀 필터"]',
    );
    await act(async () => projectFilter?.click());
    const briarOption = document.querySelector<HTMLButtonElement>(
      '[role="option"][data-value="project-1"]',
    );
    await act(async () => briarOption?.click());

    expect(container.textContent).toContain("Unread Briar failure");
    expect(container.textContent).not.toContain("Unread Sprout failure");
    expect(container.textContent).toContain("1개 표시");

    await act(async () => unreadOnlyFilter?.click());

    expect(container.textContent).toContain("Unread Briar failure");
    expect(container.textContent).toContain("Read Briar failure");
    expect(container.textContent).not.toContain("Unread Briar activity");
    expect(container.textContent).toContain("2개 표시");
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
          messages={seed([message])}
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

  it("shows one unread-count badge for a collapsed thread", async () => {
    // The collapse is the store's, so this case seeds the three replies and
    // reads back the one row they became.
    const replies = [1, 2, 3].map((reply) =>
      issue(`conversation:reply-${reply}`, "Grouped thread", {
        kind: "conversation",
        targetId: "run-1",
        messageId: `reply-${reply}`,
        rootMessageId: "root-1",
        body: `Reply ${reply}`,
        authorName: "Member",
        reason: "thread_reply",
        occurredAt: `2026-07-28T07:4${reply}:00.000Z`,
        version: `reply-${reply}`,
      })
    );
    seed(replies);

    await renderReactTestRoot(
      root,
      <TestProviders>
        <Inbox
          isSidebarOpen
          messages={registry.get(visibleInboxMessageSummariesAtom)}
          onMarkAllRead={vi.fn()}
          onMarkRead={vi.fn()}
          onOpen={vi.fn()}
          projects={projects}
          unreadCount={1}
        />
      </TestProviders>,
    );

    const badge = container.querySelector(
      '[aria-label="읽지 않은 메시지 3개"]',
    );
    expect(badge?.textContent).toBe("3");
    expect(container.querySelectorAll(".inbox-message")).toHaveLength(1);
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
          messages={seed([message])}
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
            messages={seed(messages)}
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
    expect(onOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: messages[1]!.id }),
    );
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
    expect(onOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: messages[0]!.id }),
    );
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
    expect(onOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: messages[2]!.id }),
    );
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
          messages={seed([issue("message", "Companion message")])}
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
            messages={seed(messages)}
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
    expect(onOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: messages[0]!.id }),
    );
    expect(document.activeElement).toBe(messageButtons[0]);
    expect(messageButtons[0]?.getAttribute("aria-current")).toBe("true");

    outside.focus();
    await navigate("j");
    expect(onOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: messages[1]!.id }),
    );
    expect(document.activeElement).toBe(messageButtons[1]);
    expect(messageButtons[1]?.hasAttribute("data-keyboard-list-current")).toBe(
      true,
    );

    outside.focus();
    await navigate("j", { repeat: true });
    expect(onOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: messages[2]!.id }),
    );
    expect(document.activeElement).toBe(messageButtons[2]);

    const openCountAtBoundary = onOpen.mock.calls.length;
    outside.focus();
    await navigate("j", { repeat: true });
    expect(onOpen).toHaveBeenCalledTimes(openCountAtBoundary);
    expect(document.activeElement).toBe(messageButtons[2]);

    outside.focus();
    await navigate("k");
    expect(onOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: messages[1]!.id }),
    );
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
          messages={seed(messages)}
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
          messages={seed(messages)}
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
