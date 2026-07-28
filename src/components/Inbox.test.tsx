/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InboxMessageWithReadState } from "../hooks/useInbox";
import { I18nProvider } from "../i18n";
import { Inbox } from "./Inbox";

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

  it("shows prioritized sections and keeps routine activity collapsed", async () => {
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
            onOpen={vi.fn()}
            unreadCount={3}
          />
        </I18nProvider>,
      ),
    );

    expect(container.textContent).toContain("긴급1");
    expect(container.textContent).toContain("확인 필요1");
    expect(container.textContent).toContain("중요 변경1");
    expect(container.textContent).toContain("최근 활동1");
    expect(container.textContent).toContain("Production is blocked");
    expect(container.textContent).toContain("다음 행동: Choose the release scope.");
    expect(container.textContent).not.toContain("Routine dependency update");

    const activityToggle = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("최근 활동"),
    );
    await act(async () => activityToggle?.click());

    expect(container.textContent).toContain("Routine dependency update");
    expect(activityToggle?.getAttribute("aria-expanded")).toBe("true");
  });
});
