/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { demoDashboard } from "../lib/demo-data";
import type { IssueMessage } from "../types";
import {
  CreateIssueDialog,
  EditIssueDialog,
  HuntDashboard,
  RunPage,
} from "./HuntDashboard";

const dashboardProps = {
  error: null,
  isCreatingIssue: false,
  deletingIssueId: null,
  updatingIssueId: null,
  recoveringRunId: null,
  recoveryError: null,
  isSidebarOpen: true,
  onCreateIssue: async () => undefined,
  onDeleteIssue: async () => undefined,
  onUpdateIssue: async () => undefined,
  onLoadAttachment: async () => new Blob(),
  onLoadIssueMessages: async () => [],
  onMoveRun: async () => undefined,
  onRetryRun: async () => undefined,
  onCancelRun: async () => undefined,
  onSendIssueMessage: async () => {
    throw new Error("not implemented in this test");
  },
};

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("HuntDashboard", () => {
  it("offers issue creation from the work queue", () => {
    const markup = renderToStaticMarkup(
      <HuntDashboard
        {...dashboardProps}
        dashboard={null}
      />,
    );

    expect(markup).toContain("이슈 만들기");
  });

  it("shows a safe projectless state after onboarding is deferred", () => {
    const markup = renderToStaticMarkup(
      <HuntDashboard
        {...dashboardProps}
        dashboard={null}
        noProject
        onAddProject={() => undefined}
      />,
    );

    expect(markup).toContain("아직 프로젝트가 없습니다.");
    expect(markup).toContain("프로젝트 만들기");
    expect(markup).not.toContain("이슈 만들기");
    expect(markup).not.toContain("자동사냥 칸반 보드");
  });

  it("uses the kanban as the full dashboard surface", () => {
    const markup = renderToStaticMarkup(
      <HuntDashboard
        {...dashboardProps}
        dashboard={demoDashboard}
      />,
    );

    expect(markup).not.toContain("queue-panel");
    expect(markup).toContain('class="dashboard-scroll"><div class="queue-header"');
    expect(markup).toContain('class="kanban-board"');
    expect(markup).not.toContain('class="page-heading"');
    expect(markup).not.toContain('class="metric-grid"');
  });

  it("switches between kanban and list views while preserving issue navigation", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        dashboard={demoDashboard}
      />,
    ));

    const listButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="리스트 보기"]',
    );
    expect(listButton?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => listButton?.click());

    expect(container.querySelector(".kanban-board")).toBeNull();
    expect(container.querySelector(".issue-list")).not.toBeNull();
    expect(container.querySelectorAll(".issue-list-row")).toHaveLength(
      demoDashboard.runs.length,
    );
    expect(listButton?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector(".issue-list")?.textContent).toContain(
      demoDashboard.runs[0].title,
    );

    await act(async () => {
      container.querySelector<HTMLElement>(".issue-list-row")?.click();
    });
    expect(container.querySelector(".run-page")).not.toBeNull();
    expect(container.querySelector(".run-page-actions-trigger")).not.toBeNull();
    expect(container.querySelector(".issue-list")).toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".run-page-titlebar-back")?.click();
    });
    expect(container.querySelector(".issue-list")).not.toBeNull();
    expect(container.querySelector(".kanban-board")).toBeNull();
    await act(async () => root.unmount());
  });

  it("shows edit and delete in the title actions menu and confirms deletion", async () => {
    const onDeleteIssue = vi.fn(async () => undefined);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        dashboard={demoDashboard}
        onDeleteIssue={onDeleteIssue}
      />,
    ));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".kanban-card")?.click();
    });

    const title = container.querySelector(".run-page-window-title");
    const trigger = container.querySelector<HTMLButtonElement>(
      ".run-page-actions-trigger",
    );
    expect(title?.nextElementSibling).toBe(trigger);
    expect(container.querySelector(".run-page-edit")).toBeNull();

    await act(async () => {
      trigger?.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });
    const menu = document.body.querySelector('[role="menu"]');
    expect(menu?.textContent).toContain("수정");
    expect(menu?.textContent).toContain("삭제");

    const deleteItem = Array.from(
      menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    ).find((item) => item.textContent?.includes("삭제"));
    await act(async () => deleteItem?.click());
    expect(document.body.textContent).toContain(
      "활동 기록, 대화, 첨부 파일이 영구적으로 삭제됩니다",
    );

    const confirmButton = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.trim() === "삭제");
    await act(async () => confirmButton?.click());
    expect(onDeleteIssue).toHaveBeenCalledWith(demoDashboard.runs[0].id);
    expect(container.querySelector(".run-page")).toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it("renders the companion queue directly in its parent", () => {
    const markup = renderToStaticMarkup(
      <HuntDashboard
        {...dashboardProps}
        companionMode
        dashboard={demoDashboard}
      />,
    );

    expect(markup).not.toContain("queue-panel");
    expect(markup).toContain('aria-label="이슈 만들기"');
    expect(markup).toContain("companion-bottom-nav");
    expect(markup).toContain("companion-fab");
    expect(markup).toContain("검색");
    expect(markup).toMatch(/<strong[^>]*>Inbox<\/strong>/);
    expect(markup).not.toContain('class="search-box"');
    expect(markup).toContain('aria-label="필터"');
    expect(markup).not.toContain('class="source-filter"');
    expect(markup).not.toContain('class="companion-search-trigger"');
    expect(markup).not.toContain('class="status-tabs"');
  });

  it("opens the companion source filter from the queue heading", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        companionMode
        dashboard={demoDashboard}
      />,
    ));

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="필터"]',
    );
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");

    await act(async () => trigger?.click());

    const menu = container.querySelector('[role="menu"]');
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(menu?.querySelectorAll('[role="menuitemradio"]')).toHaveLength(4);
    expect(menu?.textContent).toContain("전체");
    expect(menu?.textContent).toContain("피드백");

    const feedback = Array.from(
      menu?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [],
    ).find((button) => button.textContent?.includes("피드백"));
    await act(async () => feedback?.click());

    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(trigger?.className).toContain("active");
    await act(async () => root.unmount());
  });

  it("renders task search on the companion Search page", () => {
    const markup = renderToStaticMarkup(
      <HuntDashboard
        {...dashboardProps}
        companionMode
        companionSearchMode
        dashboard={demoDashboard}
      />,
    );

    expect(markup).toMatch(/<h2[^>]*>검색<\/h2>/);
    expect(markup).toContain('class="search-box"');
    expect(markup).toContain('placeholder="작업 검색"');
    expect(markup).toMatch(
      /aria-current="page"[^>]*class="[^"]*active[^"]*"/,
    );
  });

  it("renders the issue editor metadata and accepts image or video files", () => {
    const markup = renderToStaticMarkup(
      <CreateIssueDialog
        isSubmitting={false}
        onClose={() => undefined}
        onCreate={async () => undefined}
        projectName="GG"
      />,
    );

    expect(markup).toContain("새 이슈");
    expect(markup).toContain(">GG<");
    expect(markup).toContain("대기");
    expect(markup).toContain("담당자");
    expect(markup).toContain("프로젝트");
    expect(markup).toContain("라벨");
    expect(markup).toContain('aria-haspopup="listbox" aria-label="상태"');
    expect(markup).toContain("native-select issue-status-select");
    expect(markup).toContain('aria-haspopup="listbox" aria-label="우선순위"');
    expect(markup).toContain("native-select issue-priority-select");
    expect(markup).toContain('type="file"');
    expect(markup).toContain('aria-label="이미지 또는 영상 첨부"');
    expect(markup).toContain("video/quicktime");
    expect(markup).toContain("Enter로 등록");
  });

  it("edits an issue title, description, and priority", async () => {
    let updated:
      | {
          title: string;
          description: string | null;
          priority: number | null;
        }
      | undefined;
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <EditIssueDialog
          isSubmitting={false}
          onClose={() => undefined}
          onUpdate={async (input) => {
            updated = input;
          }}
          run={{ ...demoDashboard.runs[0], priority: 3 }}
        />,
      );
    });

    const title = container.querySelector<HTMLInputElement>(
      ".issue-title-input",
    );
    const description = container.querySelector<HTMLTextAreaElement>(
      ".issue-description-input",
    );
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(title, "수정된 이슈");
      title?.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(description, "수정된 설명");
      description?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector("form")?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    expect(updated).toEqual({
      title: "수정된 이슈",
      description: "수정된 설명",
      priority: 3,
    });
    await act(async () => root.unmount());
  });

  it("shows an active queue claim", () => {
    const claimedDashboard = {
      ...demoDashboard,
      runs: [
        {
          ...demoDashboard.runs[0],
          status: "queued" as const,
          workflowStage: null,
          claimedBy: "briar-workflow",
          claimedAt: new Date().toISOString(),
          leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
          claimAttempts: 1,
        },
      ],
    };
    const markup = renderToStaticMarkup(
      <HuntDashboard
        {...dashboardProps}
        dashboard={claimedDashboard}
      />,
    );

    expect(markup).toContain("briar-workflow 할당");
  });

  it("renders workflow stages as kanban columns", () => {
    const customWorkflow = {
      version: 1 as const,
      stages: [
        { id: "analyzing", label: "Analyze", required: true },
        { id: "security_review", label: "Security review", required: true },
      ],
      completion: { requiredStages: ["analyzing", "security_review"] },
      release: { enabled: false },
    };
    const customDashboard = {
      ...demoDashboard,
      settings: { ...demoDashboard.settings, workflow: customWorkflow },
      runs: [{
        ...demoDashboard.runs[0],
        status: "running" as const,
        workflowStage: "security_review",
        workflow: customWorkflow,
      }],
    };
    const markup = renderToStaticMarkup(
      <HuntDashboard
        {...dashboardProps}
        dashboard={customDashboard}
      />,
    );

    expect(markup).toContain('aria-label="자동사냥 칸반 보드"');
    expect(markup).toContain("분석");
    expect(markup).toContain("Security review");
    expect(markup).toContain('class="kanban-card');
    expect(markup).toContain('class="kanban-card-copy"');
    expect(markup).toContain('draggable="true"');
    expect(markup).toContain('aria-label="백로그"');
    expect(markup).toContain('aria-label="차단"');
    expect(markup).toContain('aria-label="실패"');
    expect(markup).toContain('aria-label="취소"');
  });

  it("opens issue details as a page and returns to the kanban", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        dashboard={demoDashboard}
      />,
    ));

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".kanban-card")?.click();
    });

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector(".dialog-backdrop")).toBeNull();
    expect(container.querySelector(".run-page")).not.toBeNull();
    expect(container.querySelector(".kanban-board")).toBeNull();
    expect(container.querySelector(".window-controls")).toBeNull();
    const titlebarBack = container.querySelector(".run-page-titlebar-back");
    expect(titlebarBack?.getAttribute("aria-label")).toBe("돌아가기");
    expect(container.querySelector(".run-page-window-number")?.textContent).toBe(
      `AH-${demoDashboard.runs[0].runNumber}`,
    );
    const windowTitle = container.querySelector(".run-page-window-title");
    expect(windowTitle?.textContent).toBe(demoDashboard.runs[0].title);
    expect(windowTitle?.getAttribute("title")).toBe(demoDashboard.runs[0].title);
    expect(
      container
        .querySelector(".run-page-shell > .topbar")
        ?.getAttribute("data-tauri-drag-region"),
    ).toBe("deep");
    expect(container.querySelector(".run-page-heading")).toBeNull();
    expect(container.querySelector(".run-page-back")).toBeNull();
    expect(container.querySelector(".run-page-title-row")).toBeNull();
    expect(container.querySelector(".run-page-summary .run-page-description")).toBeNull();
    expect(container.querySelector(".run-page-summary > .issue-activity")).not.toBeNull();
    expect(container.querySelector(".run-page-content > h1")).toBeNull();
    expect(container.querySelector(".run-page-content > .eyebrow")).toBeNull();
    expect(container.querySelector(".run-page-content > .run-detail")).toBeNull();
    expect(container.querySelector(".run-page-content > .run-issue-description")).toBeNull();
    expect(container.querySelector(".run-page-content > .issue-activity")).toBeNull();
    const properties = container.querySelector(".run-properties");
    expect(properties).not.toBeNull();
    expect(properties?.textContent).toContain("속성");
    expect(properties?.textContent).toContain("우선순위");
    expect(properties?.textContent).toContain("저장소");
    expect(properties?.querySelector(".run-status-control")).not.toBeNull();
    expect(properties?.textContent).not.toContain("전체 진행률");
    expect(properties?.querySelector(".run-property.progress")).toBeNull();
    expect(container.textContent).not.toContain("로컬 저장소 열기");
    expect(container.textContent).not.toContain(
      "Auto Hunt 실행 증거를 실시간으로 표시합니다.",
    );
    const activityTrigger = container.querySelector<HTMLButtonElement>(
      ".issue-activity-trigger",
    );
    expect(activityTrigger?.getAttribute("aria-label")).toBe("상태 히스토리 열기");
    expect(activityTrigger?.querySelector("strong")?.textContent).toBe(
      demoDashboard.runs[0].events[0].detail,
    );
    expect(activityTrigger?.textContent).toContain("시도 1");
    expect(activityTrigger?.textContent).not.toContain("기록 3개");
    expect(container.querySelectorAll(".issue-activity .timeline-event")).toHaveLength(0);

    await act(async () => activityTrigger?.click());
    const activityDialog = container.querySelector(".issue-activity-dialog");
    expect(activityDialog?.getAttribute("role")).toBe("dialog");
    expect(activityDialog?.textContent).toContain("상태 히스토리");
    expect(activityDialog?.textContent).toContain("기록 3개");
    expect(
      activityDialog?.querySelectorAll(".timeline-event"),
    ).toHaveLength(demoDashboard.runs[0].events.length);
    expect(document.activeElement).toBe(
      activityDialog?.querySelector('button[aria-label="닫기"]'),
    );

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(container.querySelector(".issue-activity-dialog")).toBeNull();
    expect(document.activeElement).toBe(activityTrigger);
    const descriptionPane = container.querySelector(".issue-description-pane");
    expect(descriptionPane).not.toBeNull();
    expect(descriptionPane?.querySelector(":scope > header")).toBeNull();
    expect(descriptionPane?.querySelector(".issue-description-markdown")).toBeNull();
    expect(descriptionPane?.querySelector(".issue-description-empty")).not.toBeNull();
    expect(descriptionPane?.textContent).not.toContain(demoDashboard.runs[0].detail);
    const content = container.querySelector<HTMLElement>(".run-page-content");
    const contentDivider = container.querySelector<HTMLElement>(
      ".issue-content-divider",
    );
    expect(content?.style.gridTemplateRows).toContain("50fr");
    expect(contentDivider?.getAttribute("role")).toBe("separator");
    expect(contentDivider?.getAttribute("aria-orientation")).toBe("horizontal");
    expect(contentDivider?.getAttribute("aria-valuenow")).toBe("50");
    await act(async () => {
      contentDivider?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
      );
    });
    expect(contentDivider?.getAttribute("aria-valuenow")).toBe("55");
    expect(content?.style.gridTemplateRows).toContain("55fr");
    expect(content?.style.gridTemplateRows).toContain("45fr");
    const conversation = container.querySelector(".issue-conversation");
    expect(conversation).not.toBeNull();
    expect(descriptionPane?.nextElementSibling).toBe(contentDivider);
    expect(contentDivider?.nextElementSibling).toBe(conversation);
    expect(
      conversation?.querySelector(".issue-message-list + .issue-message-composer"),
    ).not.toBeNull();
    expect(container.querySelector(".run-page-composer-dock")).toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".run-page-titlebar-back")?.click();
    });

    expect(container.querySelector(".run-page")).toBeNull();
    expect(container.querySelector(".kanban-board")).not.toBeNull();
    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps in-page issue navigation in companion mode", () => {
    const markup = renderToStaticMarkup(
      <RunPage
        companionMode
        isSidebarOpen
        error={null}
        isRecovering={false}
        onBack={() => undefined}
        onCancel={async () => undefined}
        onDelete={async () => undefined}
        onLoadAttachment={async () => new Blob()}
        onLoadIssueMessages={async () => []}
        onMove={async () => undefined}
        onRetry={async () => undefined}
        onSendIssueMessage={async () => {
          throw new Error("not implemented in this test");
        }}
        onUpdateIssue={async () => undefined}
        run={demoDashboard.runs[0]}
      />,
    );

    expect(markup).not.toContain("run-page-titlebar-back");
    expect(markup).toContain("run-page-back");
    expect(markup).toContain(`AH-${demoDashboard.runs[0].runNumber}`);
    expect(markup).toContain(`<h1 id="run-page-title">${demoDashboard.runs[0].title}</h1>`);
    expect(markup).toContain('class="run-page-actions-trigger"');
  });

  it("renders the issue description as Markdown above the conversation", () => {
    const markup = renderToStaticMarkup(
      <RunPage
        isSidebarOpen
        error={null}
        isRecovering={false}
        onBack={() => undefined}
        onCancel={async () => undefined}
        onLoadAttachment={async () => new Blob()}
        onLoadIssueMessages={async () => []}
        onMove={async () => undefined}
        onRetry={async () => undefined}
        onSendIssueMessage={async () => {
          throw new Error("not implemented in this test");
        }}
        run={{
          ...demoDashboard.runs[0],
          issueDescription: [
            "# 목표",
            "",
            "- 상세 내용을 표시합니다.",
            "- 대화 위에 배치합니다.",
            "",
            "~~일반 텍스트~~ **마크다운**",
          ].join("\n"),
        }}
      />,
    );

    expect(markup).toContain('<div class="issue-description-markdown">');
    expect(markup).toContain("<h1>목표</h1>");
    expect(markup).toContain("<li>상세 내용을 표시합니다.</li>");
    expect(markup).toContain("<del>일반 텍스트</del>");
    expect(markup.indexOf("issue-description-pane")).toBeLessThan(
      markup.indexOf("issue-conversation"),
    );
  });

  it("scrolls the conversation to the bottom after loading and sending", async () => {
    const createdAt = new Date().toISOString();
    const loadedMessage: IssueMessage = {
      id: "message-loaded",
      runId: demoDashboard.runs[0].id,
      parentMessageId: null,
      body: "기존 메시지",
      author: { id: "jay", name: "Jay", image: null, provider: null },
      replyCount: 0,
      createdAt,
      updatedAt: createdAt,
    };
    const sentMessage: IssueMessage = {
      ...loadedMessage,
      id: "message-sent",
      body: "새 메시지",
    };
    let resolveLoadedMessages: (messages: IssueMessage[]) => void =
      () => undefined;
    const loadedMessages = new Promise<IssueMessage[]>((resolve) => {
      resolveLoadedMessages = resolve;
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <RunPage
          isSidebarOpen
          error={null}
          isRecovering={false}
          onBack={() => undefined}
          onCancel={async () => undefined}
          onLoadAttachment={async () => new Blob()}
          onLoadIssueMessages={() => loadedMessages}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async () => ({
            message: sentMessage,
            agentReply: null,
          })}
          run={demoDashboard.runs[0]}
        />,
      );
    });

    const messageList = container.querySelector<HTMLElement>(
      ".issue-message-list",
    );
    expect(messageList).not.toBeNull();
    if (!messageList) throw new Error("message list was not rendered");
    Object.defineProperty(messageList, "scrollHeight", {
      configurable: true,
      value: 640,
    });
    messageList.scrollTop = 0;
    await act(async () => {
      resolveLoadedMessages([loadedMessage]);
      await loadedMessages;
      await Promise.resolve();
    });
    expect(messageList?.scrollTop).toBe(640);

    const textarea = container.querySelector<HTMLTextAreaElement>(
      ".issue-message-composer textarea",
    );
    await act(async () => {
      if (!textarea) return;
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(textarea, sentMessage.body);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    messageList.scrollTop = 0;
    await act(async () => {
      textarea?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
        }),
      );
      await Promise.resolve();
    });
    expect(messageList?.scrollTop).toBe(640);

    await act(async () => root.unmount());
    container.remove();
  });

  it("opens a message thread in the right drawer and closes it with Escape", async () => {
    const rootMessage: IssueMessage = {
      id: "message-root",
      runId: demoDashboard.runs[0].id,
      parentMessageId: null,
      body: "원문 메시지",
      author: { id: "jay", name: "Jay", image: null, provider: null },
      replyCount: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const reply: IssueMessage = {
      ...rootMessage,
      id: "message-reply",
      parentMessageId: rootMessage.id,
      body: "스레드 답장",
      replyCount: 0,
    };
    const sentReply: IssueMessage = {
      ...reply,
      id: "message-new-reply",
      body: "새 스레드 답장",
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <RunPage
          isSidebarOpen
          error={null}
          isRecovering={false}
          onBack={() => undefined}
          onCancel={async () => undefined}
          onLoadAttachment={async () => new Blob()}
          onLoadIssueMessages={async () => [rootMessage, reply]}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async () => ({
            message: sentReply,
            agentReply: null,
          })}
          run={demoDashboard.runs[0]}
        />,
      );
    });

    const threadSummary = container.querySelector<HTMLButtonElement>(
      ".issue-thread-summary",
    );
    expect(threadSummary?.getAttribute("title")).toBe("스레드에서 답장하기");
    expect(threadSummary?.textContent).toContain("답장 1개");
    expect(threadSummary?.textContent).toContain("스레드 보기");
    expect(
      threadSummary?.querySelector('.issue-thread-participant[title="Jay"]'),
    ).not.toBeNull();
    expect(container.querySelector(".issue-message-actions")).toBeNull();
    const threadContent = container.querySelector<HTMLElement>(
      ".issue-thread-content",
    );
    expect(threadContent).not.toBeNull();
    if (!threadContent) throw new Error("thread content was not rendered");
    Object.defineProperty(threadContent, "scrollHeight", {
      configurable: true,
      value: 480,
    });
    threadContent.scrollTop = 0;
    await act(async () => threadSummary?.click());
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector(".issue-thread-content")?.textContent).toContain(
      "스레드 답장",
    );
    expect(threadContent?.scrollTop).toBe(480);

    const threadTextarea = container.querySelector<HTMLTextAreaElement>(
      ".issue-thread-drawer .issue-message-composer textarea",
    );
    await act(async () => {
      if (!threadTextarea) return;
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(threadTextarea, sentReply.body);
      threadTextarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    threadContent.scrollTop = 0;
    await act(async () => {
      threadTextarea?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
        }),
      );
      await Promise.resolve();
    });
    expect(threadContent?.scrollTop).toBe(480);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(threadSummary);
    await act(async () => root.unmount());
    container.remove();
  });

  it("inserts @briar and places the provider reply in its thread", async () => {
    const createdAt = new Date().toISOString();
    const userMessage: IssueMessage = {
      id: "message-user",
      runId: demoDashboard.runs[0].id,
      parentMessageId: null,
      body: "@briar 변경 내용을 설명해 줘",
      author: { id: "jay", name: "Jay", image: null, provider: null },
      replyCount: 0,
      createdAt,
      updatedAt: createdAt,
    };
    const agentMessage: IssueMessage = {
      ...userMessage,
      id: "message-agent",
      parentMessageId: userMessage.id,
      body: "Codex가 처리한 변경 내용을 설명합니다.",
      author: {
        id: null,
        name: "Briar · Codex",
        image: null,
        provider: "codex",
      },
    };
    let sentBody = "";
    let resolveAgentReply: (message: IssueMessage) => void = () => undefined;
    const pendingAgentReply = new Promise<IssueMessage>((resolve) => {
      resolveAgentReply = resolve;
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <RunPage
          isSidebarOpen
          error={null}
          isRecovering={false}
          onBack={() => undefined}
          onCancel={async () => undefined}
          onLoadAttachment={async () => new Blob()}
          onLoadIssueMessages={async () => []}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async (input) => {
            sentBody = input.body;
            return {
              message: userMessage,
              agentReply: pendingAgentReply,
            };
          }}
          run={demoDashboard.runs[0]}
        />,
      );
    });

    const mentionButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="멘션"]',
    );
    const textarea = container.querySelector<HTMLTextAreaElement>(
      ".issue-message-composer textarea",
    );
    await act(async () => mentionButton?.click());
    expect(textarea?.value).toBe("@briar ");

    await act(async () => {
      if (!textarea) return;
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(textarea, "@briar 변경 내용을 설명해 줘");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      textarea?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
          shiftKey: true,
        }),
      );
    });
    expect(sentBody).toBe("");
    expect(textarea?.value).toBe("@briar 변경 내용을 설명해 줘");

    await act(async () => {
      textarea?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
        }),
      );
      await Promise.resolve();
    });

    expect(sentBody).toBe("@briar 변경 내용을 설명해 줘");
    expect(textarea?.value).toBe("");
    expect(container.textContent).toContain(userMessage.body);
    expect(container.textContent).toContain("Briar가 답변을 작성하고 있습니다");
    await act(async () => {
      resolveAgentReply(agentMessage);
      await pendingAgentReply;
    });
    expect(
      container.querySelector(".issue-message-list")?.textContent,
    ).not.toContain(agentMessage.body);
    const threadSummary = container.querySelector<HTMLButtonElement>(
      ".issue-thread-summary",
    );
    expect(threadSummary?.textContent).toContain("답장 1개");
    expect(threadSummary?.textContent).toContain("스레드 보기");
    expect(
      threadSummary?.querySelector(
        '.issue-thread-participant.agent[title="Briar · Codex"]',
      ),
    ).not.toBeNull();
    await act(async () => threadSummary?.click());
    expect(container.querySelector(".issue-thread-content")?.textContent)
      .toContain(agentMessage.body);
    expect(
      container.querySelector('.issue-message-avatar.agent[aria-label="Briar · Codex"]'),
    ).not.toBeNull();
    await act(async () => root.unmount());
    container.remove();
  });

  it("suggests and completes @briar when typing a mention", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <RunPage
          isSidebarOpen
          error={null}
          isRecovering={false}
          onBack={() => undefined}
          onCancel={async () => undefined}
          onLoadAttachment={async () => new Blob()}
          onLoadIssueMessages={async () => []}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async () => {
            throw new Error("message should not be sent");
          }}
          run={demoDashboard.runs[0]}
        />,
      );
    });

    const textarea = container.querySelector<HTMLTextAreaElement>(
      ".issue-message-composer textarea",
    );
    await act(async () => {
      textarea?.focus();
      if (!textarea) return;
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(textarea, "@");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const suggestion = container.querySelector<HTMLButtonElement>(
      '[role="option"]',
    );
    expect(suggestion?.textContent).toContain("@briar");
    expect(textarea?.getAttribute("aria-expanded")).toBe("true");

    await act(async () => {
      textarea?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
    });
    expect(textarea?.value).toBe("@briar ");
    expect(container.querySelector('[role="option"]')).toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps a drag topbar without embedding Auto Hunt health", () => {
    const markup = renderToStaticMarkup(
      <HuntDashboard
        {...dashboardProps}
        dashboard={null}
      />,
    );

    expect(markup).toContain("topbar");
    expect(markup).not.toContain("health-trigger");
    expect(markup).not.toContain("Auto Hunt 연결 상태");
    expect(markup).not.toContain("Briar CLI");
  });

  it("shows attempt-aware recovery actions for failed runs", () => {
    const failedRun = {
      ...demoDashboard.runs[0],
      status: "failed" as const,
      currentAttempt: 2,
      detail: "Worker deployment timed out",
      events: [
        {
          ...demoDashboard.runs[0].events[0],
          status: "failed" as const,
          attempt: 2,
          detail: "Worker deployment timed out",
        },
        ...demoDashboard.runs[0].events,
      ],
    };
    const markup = renderToStaticMarkup(
      <RunPage
        isSidebarOpen
        error={null}
        isRecovering={false}
        onBack={() => undefined}
        onCancel={async () => undefined}
        onLoadAttachment={async () => new Blob()}
        onLoadIssueMessages={async () => []}
        onMove={async () => undefined}
        onRetry={async () => undefined}
        onSendIssueMessage={async () => {
          throw new Error("not implemented in this test");
        }}
        run={failedRun}
      />,
    );

    expect(markup).toContain("실행이 실패했습니다");
    expect(markup).toContain("3번 시도로 새 작업이 시작됩니다");
    expect(markup).toContain("재시도");
    expect(markup).toContain("작업 취소");
    expect(markup).toContain("시도 2");
    expect(markup).toContain('<label class="run-property run-status-control">');
    expect(markup).toContain('aria-haspopup="listbox" aria-label="상태"');
    expect(markup).toContain('<span class="select-menu-value">실패</span>');
  });
});
