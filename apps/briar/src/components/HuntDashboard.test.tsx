/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AutoHuntSession } from "../hooks/useAutoHuntSessions";
import { demoDashboard, demoRunEvents } from "../lib/demo-data";
import * as api from "../lib/api";
import * as channelRealtime from "../lib/channel-realtime";
import * as issueActivityHook from "../hooks/use-issue-agent-activity";
import type {
  ExecutionWorker,
  HuntRun,
  IssueMessage,
  IssueMessageSendResult,
  ProjectAgent,
  RunEvidence,
  UpdateIssueInput,
} from "../types";
import {
  CreateIssueDialog,
  EditIssueDialog,
  HuntDashboard,
  IssueAgentActivityPanel,
  RunPage,
} from "./HuntDashboard";
import { ToastProvider } from "./ui/toast";
import { TooltipProvider } from "./ui/tooltip";

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
  onLoadRunEvents: async (runId: string) => demoRunEvents[runId] ?? [],
  onLoadRunEvidence: async () => [],
  onMoveRun: async () => undefined,
  onRetryRun: async () => undefined,
  onCancelRun: async () => undefined,
  onSendIssueMessage: async () => {
    throw new Error("not implemented in this test");
  },
};

const dashboardAgent: ProjectAgent = {
  id: "agent-1",
  projectId: demoDashboard.project.id,
  name: "Briar Agent",
  avatar: "data:image/png;base64,avatar",
  codexPet: null,
  provider: "codex",
  model: null,
  effort: null,
  responsibility: "Process issues",
  skill: "# Agent",
  skills: [],
  calendarColor: "#3275d5",
  createdAt: "2026-07-29T00:00:00.000Z",
  updatedAt: "2026-07-29T00:00:00.000Z",
};

const issueMentionAgent: ProjectAgent = {
  ...dashboardAgent,
  id: "agent-mention-1",
  name: "Developer",
};

const dashboardWorker: ExecutionWorker = {
  id: "worker-1",
  deviceId: "device-1",
  ownerUserId: "user-1",
  label: "Lemon Worker",
  icon: { type: "emoji", value: "🍋" },
  agentProvider: "codex",
  providers: ["codex"],
  versions: { briar: "1.2.25" },
  state: "online",
  readiness: "busy",
  acceptingWork: true,
  readinessDetail: null,
  capabilities: {},
  maxConcurrentSessions: 1,
  activeSessions: 1,
  availableSessions: 0,
  lastHeartbeatAt: "2026-07-29T00:00:00.000Z",
  createdAt: "2026-07-29T00:00:00.000Z",
};

function dashboardAgentSession(
  run: HuntRun,
  status: AutoHuntSession["status"] = "running",
): AutoHuntSession {
  return {
    id: "session-1",
    dispatchGroupId: "dispatch-1",
    projectId: demoDashboard.project.id,
    agentId: dashboardAgent.id,
    sessionType: "dispatch",
    status,
    issues: [{
      runId: run.id,
      runNumber: run.runNumber,
      sourceKey: run.sourceKey,
      title: run.title,
      outcome: status === "running" ? "pending" : "completed",
      summary: null,
    }],
    startedAt: "2026-07-29T00:00:00.000Z",
    completedAt:
      status === "running" ? null : "2026-07-29T00:10:00.000Z",
    conversationId: null,
    workspaceRoot: null,
    summary: null,
    error: null,
    events: [],
    dispatchEvents: [],
    workers: [],
  };
}

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function pendingAgentReplyState(scope: ParentNode | null | undefined) {
  return scope?.querySelector<HTMLElement>(":scope > .issue-agent-reply-state");
}

function expectPendingAgentReplyLoader(scope: ParentNode | null | undefined) {
  const pending = pendingAgentReplyState(scope);
  const loader = pending?.querySelector<HTMLElement>(
    "[data-testid='loading-state']",
  );
  expect(loader).not.toBeNull();
  expect(loader?.dataset.variant).toBe("Drive");
  expect(loader?.dataset.size).toBe("compact");
  expect(pending?.textContent).toContain("에이전트가 답변을 작성하고 있습니다");
  expect(pending?.textContent).toContain("0.0s");
  expect(pending?.querySelector(".spin")).toBeNull();
  return pending;
}

describe("HuntDashboard", () => {






  it("opens issue creation with Command-N", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        dashboard={demoDashboard}
      />,
    ));

    expect(
      container.querySelector('[aria-keyshortcuts="Meta+N"]'),
    ).not.toBeNull();
    const shortcut = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "KeyN",
      key: "n",
      metaKey: true,
    });
    await act(async () => {
      window.dispatchEvent(shortcut);
    });

    expect(shortcut.defaultPrevented).toBe(true);
    expect(
      container.querySelector('[aria-label="새 이슈"]'),
    ).not.toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });













  it.each(["completed", "cancelled", "blocked", "failed"] as const)(
    "hides the assigned worker icon when an issue is %s",
    (status) => {
      const run = {
        ...demoDashboard.runs[0],
        status,
        workflowStage: null,
        workerId: dashboardWorker.id,
      };
      const markup = renderToStaticMarkup(
        <HuntDashboard
          {...dashboardProps}
          dashboard={{
            ...demoDashboard,
            runs: [run],
            workers: [dashboardWorker],
          }}
        />,
      );

      expect(markup).not.toContain("kanban-card-worker-badge");
      expect(markup).not.toContain("has-assignees");
    },
  );










  it("starts the selected queued issue directly from its context menu", async () => {
    const onProcessIssueNow = vi.fn();
    const queuedRun = {
      ...demoDashboard.runs[0],
      status: "queued" as const,
      workflowStage: null,
      progress: 0,
      claimedBy: null,
      claimedAt: null,
      leaseExpiresAt: null,
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        dashboard={{ ...demoDashboard, runs: [queuedRun] }}
        onProcessIssueNow={onProcessIssueNow}
      />,
    ));

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".kanban-card")?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          button: 2,
          cancelable: true,
        }),
      );
    });
    const processItem = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.includes("바로 처리하기"));

    expect(processItem?.hasAttribute("data-disabled")).toBe(false);
    await act(async () => processItem?.click());
    expect(onProcessIssueNow).toHaveBeenCalledWith(queuedRun);

    await act(async () => root.unmount());
    container.remove();
  });

  it("collapses and expands a kanban stage column per user and project", async () => {
    window.localStorage.clear();
    const userId = "user-collapse-1";
    const projectId = demoDashboard.project.id;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        currentUserId={userId}
        dashboard={demoDashboard}
      />,
    ));

    const collapseButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="분석 열 접기"]',
    );
    expect(collapseButton).not.toBeNull();
    expect(
      container.querySelector(
        '[data-kanban-column-id="stage:analyzing"][data-kanban-column-collapsed="false"]',
      ),
    ).not.toBeNull();

    await act(async () => collapseButton?.click());

    const collapsedColumn = container.querySelector(
      '[data-kanban-column-id="stage:analyzing"]',
    );
    expect(collapsedColumn?.getAttribute("data-kanban-column-collapsed")).toBe(
      "true",
    );
    expect(
      collapsedColumn?.closest(".kanban-column-shell")?.classList.contains(
        "is-collapsed",
      ),
    ).toBe(true);
    expect(collapsedColumn?.querySelector(".kanban-card")).toBeNull();
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="분석 열 펼치기"]',
      )?.getAttribute("aria-expanded"),
    ).toBe("false");
    expect(
      JSON.parse(
        window.localStorage.getItem(
          `briar.settings.kanbanColumnCollapse.v1:${encodeURIComponent(userId)}:${encodeURIComponent(projectId)}`,
        )!,
      ),
    ).toEqual(["stage:analyzing"]);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="분석 열 펼치기"]')
        ?.click();
    });
    expect(
      container
        .querySelector('[data-kanban-column-id="stage:analyzing"]')
        ?.getAttribute("data-kanban-column-collapsed"),
    ).toBe("false");

    await act(async () => root.unmount());
    container.remove();
  });


  it("hides a kanban column into the hidden list and can show it again", async () => {
    window.localStorage.clear();
    const userId = "user-hide-1";
    const projectId = demoDashboard.project.id;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        currentUserId={userId}
        dashboard={demoDashboard}
      />,
    ));

    const hideTrigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="분석 열 메뉴"]',
    );
    expect(hideTrigger).not.toBeNull();
    expect(
      container.querySelector('[data-kanban-column-id="stage:analyzing"]'),
    ).not.toBeNull();
    expect(container.querySelector("[data-kanban-hidden-columns]")).toBeNull();

    await act(async () => {
      hideTrigger?.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });
    const hideItem = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.includes("열 숨기기"));
    expect(hideItem).not.toBeUndefined();
    await act(async () => hideItem?.click());

    expect(
      container.querySelector('[data-kanban-column-id="stage:analyzing"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-kanban-hidden-column-id="stage:analyzing"]'),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-kanban-hidden-columns]")?.textContent,
    ).toContain("숨긴 열");
    expect(
      JSON.parse(
        window.localStorage.getItem(
          `briar.settings.kanbanColumnHide.v1:${encodeURIComponent(userId)}:${encodeURIComponent(projectId)}`,
        )!,
      ),
    ).toEqual(["stage:analyzing"]);

    const showTrigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="분석 숨긴 열 메뉴"]',
    );
    await act(async () => {
      showTrigger?.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });
    const showItem = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.includes("열 표시"));
    expect(showItem).not.toBeUndefined();
    await act(async () => showItem?.click());

    expect(
      container.querySelector('[data-kanban-column-id="stage:analyzing"]'),
    ).not.toBeNull();
    expect(container.querySelector("[data-kanban-hidden-columns]")).toBeNull();

    await act(async () => root.unmount());
    container.remove();
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
    expect(container.querySelector(".kanban-progress")).toBeNull();
    expect(container.querySelector(".kanban-card")?.textContent).not.toContain(
      `${demoDashboard.runs[0].progress}%`,
    );

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
    expect(container.querySelector(".issue-list")?.textContent).not.toContain(
      "진행률",
    );
    expect(container.querySelector(".issue-list-progress")).toBeNull();
    expect(container.querySelector(".issue-list")?.textContent).not.toContain(
      `${demoDashboard.runs[0].progress}%`,
    );
    expect(
      container.querySelectorAll(".issue-list-header [role='columnheader']"),
    ).toHaveLength(4);
    expect(
      container.querySelectorAll(".issue-list-row:first-child [role='cell']"),
    ).toHaveLength(4);

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


  it("debounces inline title and description changes and reports the save state", async () => {
    vi.useFakeTimers();
    const onUpdateIssue = vi.fn(async () => undefined);
    const run = { ...demoDashboard.runs[0], workerId: null };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => root.render(
        <RunPage
          isSidebarOpen
          error={null}
          isRecovering={false}
          onBack={() => undefined}
          onCancel={async () => undefined}
          onLoadAttachment={async () => new Blob()}
          onLoadIssueMessages={async () => []}
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async () => {
            throw new Error("not implemented in this test");
          }}
          onUpdateIssue={onUpdateIssue}
          run={run}
        />,
      ));

      const title = container.querySelector<HTMLInputElement>(
        ".run-page-inline-title",
      );
      const description = container.querySelector<HTMLTextAreaElement>(
        ".issue-description-inline-editor .issue-description-input",
      );
      expect(title?.value).toBe(run.title);
      expect(description?.value).toBe(run.issueDescription ?? "");
      expect(
        container.querySelector(".run-page-save-status")?.getAttribute("aria-label"),
      ).toBe("저장됨");
      expect(
        container.querySelector(".run-page-save-status")?.classList.contains("saved"),
      ).toBe(true);

      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set?.call(title, " 인라인 제목 ");
        title?.dispatchEvent(new Event("input", { bubbles: true }));
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set?.call(description, " 인라인 본문 ");
        description?.dispatchEvent(new Event("input", { bubbles: true }));
      });

      expect(container.querySelector(".run-page-save-status")?.textContent)
        .toContain("저장 중");
      expect(container.querySelector(".run-page-save-status .spin")).not.toBeNull();
      expect(onUpdateIssue).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      expect(onUpdateIssue).toHaveBeenCalledTimes(1);
      expect(onUpdateIssue).toHaveBeenCalledWith({
        title: "인라인 제목",
        description: "인라인 본문",
        priority: run.priority,
        attachments: [],
      });
      expect(
        container.querySelector(".run-page-save-status")?.getAttribute("aria-label"),
      ).toBe("저장됨");
      expect(
        container.querySelector(".run-page-save-status")?.classList.contains("saved"),
      ).toBe(true);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.useRealTimers();
    }
  });



  it("keeps referenced images inline while the issue body remains editable", async () => {
    vi.useFakeTimers();
    const createObjectUrl = vi.fn((blob: Blob) =>
      `blob:issue-inline-editor-${blob.size}`
    );
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl,
      writable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrl,
      writable: true,
    });
    const inlineAttachment = {
      id: "attachment-inline",
      filename: "inline.png",
      contentType: "image/png",
      byteSize: 6,
      url: "/attachments/attachment-inline",
    };
    const galleryAttachment = {
      id: "attachment-gallery",
      filename: "gallery.png",
      contentType: "image/png",
      byteSize: 7,
      url: "/attachments/attachment-gallery",
    };
    const run = {
      ...demoDashboard.runs[0],
      issueDescription:
        "before\n\n![inline](briar-attachment://attachment-inline)\n\nafter",
      attachments: [inlineAttachment, galleryAttachment],
      workerId: null,
    };
    const onUpdateIssue = vi.fn(async () => undefined);
    const onLoadAttachment = vi.fn(
      async (attachment: typeof inlineAttachment) =>
        new Blob([attachment.filename], { type: attachment.contentType }),
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => root.render(
        <RunPage
          isSidebarOpen
          error={null}
          isRecovering={false}
          onBack={() => undefined}
          onCancel={async () => undefined}
          onLoadAttachment={onLoadAttachment}
          onLoadIssueMessages={async () => []}
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async () => {
            throw new Error("not implemented in this test");
          }}
          onUpdateIssue={onUpdateIssue}
          run={run}
        />,
      ));

      const editor = container.querySelector(".issue-description-inline-editor");
      expect(editor?.tagName).toBe("DIV");
      expect(
        Array.from(
          editor?.querySelectorAll<HTMLTextAreaElement>(
            ".issue-description-input",
          ) ?? [],
        ).map((textarea) => textarea.value),
      ).toEqual(["before\n\n", "\n\nafter"]);
      expect(
        editor?.querySelector<HTMLImageElement>(
          '.issue-inline-attachment img[alt="inline.png"]',
        ),
      ).not.toBeNull();
      expect(container.querySelector(".run-attachments")?.textContent)
        .toContain("gallery.png");
      expect(container.querySelector(".run-attachments")?.textContent)
        .not.toContain("inline.png");

      await act(async () => {
        editor
          ?.querySelector<HTMLButtonElement>(".issue-inline-attachment button")
          ?.click();
      });
      expect(container.querySelector(".issue-inline-attachment")).toBeNull();
      expect(container.querySelector(".run-attachments")?.textContent)
        .not.toContain("inline.png");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      expect(onUpdateIssue).toHaveBeenCalledWith({
        title: run.title,
        description: "before\n\nafter",
        priority: run.priority,
        attachments: [],
        keptAttachmentIds: ["attachment-gallery"],
      });
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.useRealTimers();
    }
  });

  it("serializes inline saves when the draft changes during a request", async () => {
    vi.useFakeTimers();
    let resolveFirstSave: () => void = () => undefined;
    const firstSave = new Promise<void>((resolve) => {
      resolveFirstSave = resolve;
    });
    const onUpdateIssue = vi
      .fn<(_input: UpdateIssueInput) => Promise<void>>()
      .mockReturnValueOnce(firstSave)
      .mockResolvedValue(undefined);
    const run = { ...demoDashboard.runs[0], workerId: null };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => root.render(
        <RunPage
          isSidebarOpen
          error={null}
          isRecovering={false}
          onBack={() => undefined}
          onCancel={async () => undefined}
          onLoadAttachment={async () => new Blob()}
          onLoadIssueMessages={async () => []}
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async () => {
            throw new Error("not implemented in this test");
          }}
          onUpdateIssue={onUpdateIssue}
          run={run}
        />,
      ));
      const title = container.querySelector<HTMLInputElement>(
        ".run-page-inline-title",
      );

      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set?.call(title, "먼저 저장할 제목");
        title?.dispatchEvent(new Event("input", { bubbles: true }));
        await vi.advanceTimersByTimeAsync(600);
      });
      expect(onUpdateIssue).toHaveBeenCalledTimes(1);

      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set?.call(title, run.title);
        title?.dispatchEvent(new Event("input", { bubbles: true }));
        await vi.advanceTimersByTimeAsync(600);
      });
      expect(onUpdateIssue).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolveFirstSave();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(onUpdateIssue).toHaveBeenCalledTimes(2);
      expect(onUpdateIssue).toHaveBeenLastCalledWith({
        title: run.title,
        description: run.issueDescription,
        priority: run.priority,
        attachments: [],
      });
      expect(
        container.querySelector(".run-page-save-status")?.getAttribute("aria-label"),
      ).toBe("저장됨");
      expect(
        container.querySelector(".run-page-save-status")?.classList.contains("saved"),
      ).toBe(true);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.useRealTimers();
    }
  });

  it("starts a queued issue from the issue detail process-now button", async () => {
    const onProcessIssueNow = vi.fn();
    const queuedRun = {
      ...demoDashboard.runs[0],
      status: "queued" as const,
      workflowStage: null,
      progress: 0,
      claimedBy: null,
      claimedAt: null,
      leaseExpiresAt: null,
      workerId: null,
      requestedWorkerId: null,
      executionReadiness: "ready" as const,
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        dashboard={{ ...demoDashboard, runs: [queuedRun] }}
        onProcessIssueNow={onProcessIssueNow}
      />,
    ));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".kanban-card")?.click();
    });

    const processNow = container.querySelector<HTMLButtonElement>(
      ".run-page-titlebar-actions .run-page-process-now",
    );
    expect(processNow).not.toBeNull();
    expect(processNow?.disabled).toBe(false);
    expect(processNow?.getAttribute("aria-label")).toContain("바로 처리하기");
    await act(async () => processNow?.click());
    expect(onProcessIssueNow).toHaveBeenCalledWith(queuedRun);

    await act(async () => root.unmount());
    container.remove();
  });



  it("lets users change status and priority from compact property badges", async () => {
    const onMove = vi.fn(async () => undefined);
    const onUpdateIssue = vi.fn(async () => undefined);
    const run = {
      ...demoDashboard.runs[0],
      status: "queued" as const,
      workflowStage: null,
      priority: 4,
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <TooltipProvider>
          <RunPage
            isSidebarOpen
            error={null}
            isRecovering={false}
            onBack={() => undefined}
            onCancel={async () => undefined}
            onLoadAttachment={async () => new Blob()}
            onLoadIssueMessages={async () => []}
            onLoadRunEvidence={async () => []}
            onMove={onMove}
            onRetry={async () => undefined}
            onSendIssueMessage={async () => {
              throw new Error("not implemented in this test");
            }}
            onUpdateIssue={onUpdateIssue}
            run={run}
          />
        </TooltipProvider>,
      );
    });

    const statusTrigger = container.querySelector<HTMLButtonElement>(
      ".run-page-property-select.status .select-menu-trigger",
    );
    const priorityTrigger = container.querySelector<HTMLButtonElement>(
      ".run-page-property-select.priority .select-menu-trigger",
    );
    expect(statusTrigger?.textContent).toContain("대기");
    expect(priorityTrigger?.textContent).toContain("P4");

    await act(async () => statusTrigger?.click());
    const backlogOption = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    ).find((option) => option.textContent?.includes("백로그"));
    expect(backlogOption).not.toBeUndefined();
    await act(async () => backlogOption?.click());
    expect(onMove).toHaveBeenCalledWith({
      status: "backlog",
      workflowStage: null,
    });

    await act(async () => priorityTrigger?.click());
    const highPriority = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    ).find((option) => option.textContent?.includes("P1"));
    expect(highPriority).not.toBeUndefined();
    await act(async () => highPriority?.click());
    expect(onUpdateIssue).toHaveBeenCalledWith({
      title: run.title,
      description: run.issueDescription,
      priority: 1,
      attachments: [],
    });

    await act(async () => root.unmount());
    container.remove();
  });



  it("reveals the process dialog shortcut when a queued companion task is swiped left", async () => {
    const onProcessIssueNow = vi.fn();
    const queuedRun = {
      ...demoDashboard.runs[0],
      status: "queued" as const,
      workflowStage: null,
      claimedBy: null,
      claimedAt: null,
      leaseExpiresAt: null,
      workerId: null,
      requestedWorkerId: null,
      executionReadiness: "ready" as const,
    };
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        companionMode
        dashboard={{ ...demoDashboard, runs: [queuedRun] }}
        onProcessIssueNow={onProcessIssueNow}
      />,
    ));

    const swipeRow = container.querySelector<HTMLElement>(
      ".companion-task-swipe",
    );
    const firePointer = (
      type: string,
      clientX: number,
      clientY: number,
    ) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        button: { value: 0 },
        clientX: { value: clientX },
        clientY: { value: clientY },
        isPrimary: { value: true },
        pointerId: { value: 1 },
        pointerType: { value: "touch" },
      });
      swipeRow?.dispatchEvent(event);
    };

    await act(async () => {
      firePointer("pointerdown", 70, 20);
      firePointer("pointermove", 10, 22);
      firePointer("pointerup", 10, 22);
    });

    const action = container.querySelector<HTMLButtonElement>(
      ".companion-task-swipe-action",
    );
    expect(swipeRow?.className).toContain("open");
    expect(action?.getAttribute("aria-hidden")).toBe("false");
    expect(action?.getAttribute("aria-label")).toBe("바로 처리하기");
    expect(action?.disabled).toBe(false);

    await act(async () => action?.click());
    expect(onProcessIssueNow).toHaveBeenCalledWith(queuedRun);
    expect(container.querySelector(".run-page")).toBeNull();

    await act(async () => root.unmount());
  });





  it("edits an issue title, description, and priority", async () => {
    let updated:
      | {
          title: string;
          description: string | null;
          priority: number | null;
          assigneeUserId?: string | null;
        }
      | undefined;
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <EditIssueDialog
          isSubmitting={false}
          members={[
            {
              userId: "user-1",
              name: "Kim",
              email: "kim@example.com",
              image: null,
              role: "member",
              createdAt: "2026-07-01T00:00:00.000Z",
            },
          ]}
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
      container
        .querySelector<HTMLButtonElement>(
          ".issue-assignee-select .select-menu-trigger",
        )
        ?.click();
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[role="option"][data-value="user-1"]',
        )
        ?.click();
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
      assigneeUserId: "user-1",
      attachments: [],
      keptAttachmentIds: [],
    });
    await act(async () => root.unmount());
  });

  it("pastes an image into the edit description and submits it with kept attachments", async () => {
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
    let updated: UpdateIssueInput | undefined;
    const run: HuntRun = {
      ...demoDashboard.runs[0],
      issueDescription: "before after",
      attachments: [
        {
          id: "existing-1",
          filename: "screen.png",
          contentType: "image/png",
          byteSize: 100,
          url: "/projects/project/runs/run/attachments/existing-1",
        },
      ],
    };
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <EditIssueDialog
          isSubmitting={false}
          members={[]}
          onClose={() => undefined}
          onLoadAttachment={async () => new Blob()}
          onUpdate={async (input) => {
            updated = input;
          }}
          run={run}
        />,
      );
    });
    const textarea = container.querySelector<HTMLTextAreaElement>(
      ".issue-description-input",
    );
    await act(async () => {
      textarea?.focus();
      textarea?.setSelectionRange(6, 6);
    });
    const image = new File(["image"], "inline.png", { type: "image/png" });
    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: {
        files: [],
        items: [{ getAsFile: () => image, kind: "file", type: "image/png" }],
      },
    });
    await act(async () => {
      container.querySelector("form")?.dispatchEvent(pasteEvent);
    });
    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(
      container.querySelectorAll<HTMLImageElement>(
        ".issue-inline-attachment img",
      ),
    ).toHaveLength(1);
    await act(async () => {
      container.querySelector<HTMLFormElement>("form")?.requestSubmit();
    });
    expect(updated).toBeDefined();
    expect(updated!.attachments).toEqual([image]);
    expect(updated!.attachmentReferences).toHaveLength(1);
    expect(updated!.keptAttachmentIds).toEqual(["existing-1"]);
    expect(updated!.description).toContain(
      `briar-attachment://${updated!.attachmentReferences?.[0]}`,
    );
    await act(async () => root.unmount());
  });

  it("removes an existing inline image while editing", async () => {
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
    let updated: UpdateIssueInput | undefined;
    const run: HuntRun = {
      ...demoDashboard.runs[0],
      issueDescription: "before\n\n![screen.png](briar-attachment://existing-1)\n\nafter",
      attachments: [
        {
          id: "existing-1",
          filename: "screen.png",
          contentType: "image/png",
          byteSize: 100,
          url: "/projects/project/runs/run/attachments/existing-1",
        },
      ],
    };
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <EditIssueDialog
          isSubmitting={false}
          members={[]}
          onClose={() => undefined}
          onLoadAttachment={async () => new Blob()}
          onUpdate={async (input) => {
            updated = input;
          }}
          run={run}
        />,
      );
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".issue-inline-attachment button")
        ?.click();
    });
    expect(
      Array.from(container.querySelectorAll<HTMLTextAreaElement>("textarea"))
        .map((textarea) => textarea.value)
        .join(""),
    ).toBe("before\n\nafter");
    await act(async () => {
      container.querySelector<HTMLFormElement>("form")?.requestSubmit();
    });
    expect(updated!.description).not.toContain("briar-attachment://");
    expect(updated!.keptAttachmentIds).toEqual([]);
    await act(async () => root.unmount());
  });






  it("shows paused issues in their stage column on the attention filter", async () => {
    const pausedRun = demoDashboard.runs.find((run) => run.status === "paused");
    const blockedRun = demoDashboard.runs.find((run) => run.status === "blocked");
    expect(pausedRun).toBeTruthy();
    expect(blockedRun).toBeTruthy();

    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <HuntDashboard
          {...dashboardProps}
          dashboard={demoDashboard}
        />,
      );
    });

    const attentionTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".status-tabs button"),
    ).find((button) => button.textContent?.includes("확인 필요"));
    expect(attentionTab).toBeTruthy();
    await act(async () => {
      attentionTab?.click();
    });

    expect(
      container.querySelector('[data-kanban-column-id="status:paused"]'),
    ).toBeNull();
    const localQaColumn = container.querySelector(
      '[data-kanban-column-id="stage:local_qa"]',
    );
    expect(localQaColumn?.textContent).toContain(pausedRun!.title);
    expect(localQaColumn?.querySelector(".kanban-card-review-banner")?.textContent)
      .toContain("리뷰를 기다리고 있습니다");
    expect(
      container.querySelector('[data-kanban-column-id="stage:implementing"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-kanban-column-id="status:blocked"]')
        ?.textContent,
    ).toContain(blockedRun!.title);
    expect(
      container.querySelector('[data-kanban-column-id="status:failed"]'),
    ).not.toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it("does not start a pointer drag for paused review cards", async () => {
    const pausedRun = {
      ...demoDashboard.runs[1],
      status: "paused" as const,
      workflowStage: "local_qa",
    };
    const onMoveRun = vi.fn(async () => undefined);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <HuntDashboard
          {...dashboardProps}
          dashboard={{ ...demoDashboard, runs: [pausedRun] }}
          onMoveRun={onMoveRun}
        />,
      );
    });

    const card = container.querySelector<HTMLElement>(".kanban-card");
    const backlogColumn = container.querySelector<HTMLElement>(
      '[aria-label="백로그"]',
    );
    expect(card?.className).toContain("awaiting-review");
    expect(card?.querySelector(".kanban-card-review-banner")).not.toBeNull();

    const firePointer = (
      target: EventTarget | null,
      type: string,
      clientX: number,
      clientY: number,
    ) => {
      const event = new Event(type, {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperties(event, {
        button: { value: 0 },
        clientX: { value: clientX },
        clientY: { value: clientY },
        isPrimary: { value: true },
        pointerId: { value: 1 },
        pointerType: { value: "mouse" },
      });
      target?.dispatchEvent(event);
    };

    const originalElementFromPoint = Object.getOwnPropertyDescriptor(
      document,
      "elementFromPoint",
    );
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => backlogColumn),
    });
    await act(async () => {
      firePointer(card, "pointerdown", 120, 120);
      firePointer(card, "pointermove", 180, 120);
      firePointer(card, "pointerup", 180, 120);
    });
    if (originalElementFromPoint) {
      Object.defineProperty(
        document,
        "elementFromPoint",
        originalElementFromPoint,
      );
    } else {
      Reflect.deleteProperty(document, "elementFromPoint");
    }

    expect(card?.className).not.toContain("dragging");
    expect(document.body.querySelector(".kanban-card-drag-preview")).toBeNull();
    expect(onMoveRun).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    container.remove();
  });

  it("marks effective pause checkpoints at their kanban boundaries", () => {
    const workflow = {
      version: 2 as const,
      requirements: [],
      stages: [
        { id: "analyzing", label: "Analyze", required: true },
        { id: "security_review", label: "Security review", required: true },
      ],
      execution: { checkpoints: [] },
      completion: { requiredStages: ["analyzing", "security_review"] },
    };
    const dashboard = {
      ...demoDashboard,
      settings: {
        ...demoDashboard.settings,
        workflow,
        checkpointPolicy: {
          availableBoundaries: [],
          projectMandatory: [{
            key: "project-after-analyzing",
            stage: "analyzing",
            position: "after" as const,
          }],
          userDefaults: [{
            key: "user-before-security-review",
            stage: "security_review",
            position: "before" as const,
          }],
          effective: [
            {
              key: "project-after-analyzing",
              stage: "analyzing",
              position: "after" as const,
            },
            {
              key: "user-before-security-review",
              stage: "security_review",
              position: "before" as const,
            },
          ],
          projectRevision: 1,
          userRevision: 1,
        },
      },
      runs: [],
    };

    const markup = renderToStaticMarkup(
      <HuntDashboard {...dashboardProps} dashboard={dashboard} />,
    );

    expect(markup.match(/class="kanban-checkpoint-marker"/g)).toHaveLength(1);
    expect(markup).toContain('data-checkpoint-count="2"');
    expect(markup).toContain("분석 완료 후 확인");
    expect(markup).toContain("Security review 시작 전 확인");
  });

  it("updates kanban pause markers when checkpoint settings change", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const checkpointPolicy = {
      ...demoDashboard.settings.checkpointPolicy!,
      projectMandatory: [],
      userDefaults: [],
      effective: [],
    };
    const dashboard = {
      ...demoDashboard,
      settings: { ...demoDashboard.settings, checkpointPolicy },
    };

    await act(async () => root.render(
      <HuntDashboard {...dashboardProps} dashboard={dashboard} />,
    ));
    expect(container.querySelector(".kanban-checkpoint-marker")).toBeNull();

    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        dashboard={{
          ...dashboard,
          settings: {
            ...dashboard.settings,
            checkpointPolicy: {
              ...checkpointPolicy,
              effective: [{
                key: "user-before-implementing",
                stage: "implementing",
                position: "before",
              }],
              userDefaults: [{
                key: "user-before-implementing",
                stage: "implementing",
                position: "before",
              }],
            },
          },
        }}
      />,
    ));
    expect(
      container.querySelector(".kanban-checkpoint-marker")?.getAttribute(
        "aria-label",
      ),
    ).toContain("구현 시작 전 확인");

    await act(async () => root.unmount());
  });

  it("changes issue status when a kanban card is pointer-dragged onto another column", async () => {
    const onMoveRun = vi.fn(async () => undefined);
    const queuedRun = {
      ...demoDashboard.runs[0],
      id: "run-drag-queued",
      status: "queued" as const,
      workflowStage: null,
      progress: 0,
      claimedBy: null,
      claimedAt: null,
      leaseExpiresAt: null,
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <HuntDashboard
          {...dashboardProps}
          dashboard={{ ...demoDashboard, runs: [queuedRun] }}
          onMoveRun={onMoveRun}
        />,
      ),
    );

    const card = container.querySelector<HTMLElement>(".kanban-card");
    const backlogColumn = container.querySelector<HTMLElement>(
      '[aria-label="백로그"]',
    );
    expect(card?.getAttribute("draggable")).toBe("false");
    expect(backlogColumn).not.toBeNull();

    const firePointer = (
      target: EventTarget | null,
      type: string,
      clientX: number,
      clientY: number,
    ) => {
      const event = new Event(type, {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperties(event, {
        button: { value: 0 },
        clientX: { value: clientX },
        clientY: { value: clientY },
        isPrimary: { value: true },
        pointerId: { value: 1 },
        pointerType: { value: "mouse" },
      });
      target?.dispatchEvent(event);
      return event;
    };

    const originalElementFromPoint = Object.getOwnPropertyDescriptor(
      document,
      "elementFromPoint",
    );
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => backlogColumn),
    });
    await act(async () => {
      firePointer(card, "pointerdown", 120, 120);
      firePointer(card, "pointermove", 140, 120);
    });
    expect(card?.className).toContain("dragging");
    expect(
      document.body.querySelector(".kanban-card-drag-preview"),
    ).not.toBeNull();

    await act(async () => {
      firePointer(card, "pointermove", 160, 120);
    });
    expect(
      container.querySelector('[aria-label="백로그"]')?.className,
    ).toContain("drag-over");

    await act(async () => {
      firePointer(card, "pointerup", 160, 120);
    });
    if (originalElementFromPoint) {
      Object.defineProperty(
        document,
        "elementFromPoint",
        originalElementFromPoint,
      );
    } else {
      Reflect.deleteProperty(document, "elementFromPoint");
    }

    expect(onMoveRun).toHaveBeenCalledWith(queuedRun.id, {
      status: "backlog",
      workflowStage: null,
    });
    expect(document.body.querySelector(".kanban-card-drag-preview")).toBeNull();

    // Drop should not open the issue detail page.
    await act(async () => {
      container.querySelector<HTMLElement>(".kanban-card")?.click();
    });
    expect(container.querySelector(".run-page")).toBeNull();
    expect(container.querySelector(".kanban-board")).not.toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it("shows recovery errors from failed status moves on the board", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <ToastProvider>
          <HuntDashboard
            {...dashboardProps}
            dashboard={demoDashboard}
            recoveryError="상태 이동에 실패했습니다."
          />
        </ToastProvider>,
      ),
    );

    expect(container.querySelector(".error-banner")).toBeNull();
    expect(
      document.body.querySelector('[data-testid="app-toast"].error')?.textContent,
    ).toContain("상태 이동에 실패했습니다.");

    await act(async () => {
      container.querySelector<HTMLElement>(".kanban-card")?.click();
    });
    expect(container.querySelector(".run-page")).not.toBeNull();
    expect(
      document.body.querySelectorAll('[data-testid="app-toast"].error'),
    ).toHaveLength(1);

    await act(async () => root.unmount());
    container.remove();
  });


  it("uses the regular status and execution flows for a created channel issue", async () => {
    const channelRun: HuntRun = {
      ...demoDashboard.runs[0],
      status: "backlog",
      workflowStage: null,
      context: { origin: "briar-channel" },
    };
    const onMoveRun = vi.fn(async () => undefined);
    const onProcessIssueNow = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <HuntDashboard
          {...dashboardProps}
          dashboard={{ ...demoDashboard, runs: [channelRun] }}
          onMoveRun={onMoveRun}
          onProcessIssueNow={onProcessIssueNow}
          requestedRunId={channelRun.id}
        />,
      );
      await Promise.resolve();
    });

    const statusTrigger = container.querySelector<HTMLButtonElement>(
      ".run-page-property-select.status .select-menu-trigger",
    );
    await act(async () => statusTrigger?.click());
    const todoOption = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    ).find((option) => option.textContent?.includes("대기"));
    await act(async () => todoOption?.click());

    expect(onMoveRun).toHaveBeenCalledWith(channelRun.id, {
      status: "queued",
      workflowStage: null,
    });
    expect(onProcessIssueNow).not.toHaveBeenCalled();

    const queuedChannelRun: HuntRun = {
      ...channelRun,
      status: "queued",
    };
    await act(async () => {
      root.render(
        <HuntDashboard
          {...dashboardProps}
          dashboard={{ ...demoDashboard, runs: [queuedChannelRun] }}
          onMoveRun={onMoveRun}
          onProcessIssueNow={onProcessIssueNow}
          requestedRunId={queuedChannelRun.id}
        />,
      );
      await Promise.resolve();
    });
    const processNow = container.querySelector<HTMLButtonElement>(
      ".run-page-titlebar-actions .run-page-process-now",
    );
    expect(processNow?.disabled).toBe(false);
    await act(async () => processNow?.click());
    expect(onProcessIssueNow).toHaveBeenCalledWith(queuedChannelRun);

    await act(async () => root.unmount());
    container.remove();
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
    expect((windowTitle as HTMLInputElement | null)?.value).toBe(
      demoDashboard.runs[0].title,
    );
    expect(windowTitle?.getAttribute("title")).toBe(demoDashboard.runs[0].title);
    expect(
      container
        .querySelector(".run-page-shell > .topbar")
        ?.getAttribute("data-tauri-drag-region"),
    ).toBe("deep");
    expect(container.querySelector(".run-page-heading")).toBeNull();
    expect(container.querySelector(".run-page-back")).toBeNull();
    expect(container.querySelector(".run-page-title-row")).toBeNull();
    // Status strip (Queued + Attempt/Revision) was removed; those values live in Properties.
    expect(container.querySelector(".run-page-summary")).toBeNull();
    expect(container.querySelector(".run-page-meta")).toBeNull();
    expect(container.querySelector(".run-page > header")).toBeNull();
    expect(container.querySelector(".issue-activity-trigger")).toBeNull();
    expect(container.querySelector(".run-page-content > h1")).toBeNull();
    expect(container.querySelector(".run-page-content > .eyebrow")).toBeNull();
    expect(container.querySelector(".run-page-content > .run-detail")).toBeNull();
    expect(container.querySelector(".run-page-content > .run-issue-description")).toBeNull();
    expect(container.querySelector(".run-page-content > .issue-activity")).toBeNull();
    expect(container.querySelector(".run-properties")).toBeNull();
    const workflowProgress = container.querySelector(".issue-workflow-progress");
    expect(workflowProgress?.querySelector("ol")?.getAttribute("aria-label")).toBe(
      "전체 진행률",
    );
    const workflowStages = workflowProgress?.querySelectorAll("li") ?? [];
    expect(workflowStages).toHaveLength(demoDashboard.runs[0].workflow.stages.length);
    expect(workflowStages[0]?.getAttribute("data-state")).toBe("complete");
    expect(workflowStages[1]?.getAttribute("data-state")).toBe("active");
    expect(workflowStages[1]?.getAttribute("aria-current")).toBe("step");
    expect(workflowStages[2]?.getAttribute("data-state")).toBe("upcoming");
    expect(workflowStages[0]?.getAttribute("aria-label")).toContain("완료");
    expect(workflowStages[1]?.getAttribute("aria-label")).toContain("진행 중");
    expect(workflowStages[2]?.getAttribute("aria-label")).toContain("대기");
    expect(
      container.querySelectorAll(".run-page-property-select"),
    ).toHaveLength(2);
    expect(
      container.querySelectorAll(".run-page-property-badge"),
    ).toHaveLength(0);
    expect(
      container.querySelector(".run-page-property-select.status .select-menu-trigger"),
    ).not.toBeNull();
    expect(
      container.querySelector(".run-page-property-select.priority .select-menu-trigger"),
    ).not.toBeNull();
    const propertiesToggle = container.querySelector<HTMLButtonElement>(
      ".run-page-properties-toggle",
    );
    expect(propertiesToggle?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => propertiesToggle?.click());
    const properties = container.querySelector(".run-properties");
    expect(propertiesToggle?.getAttribute("aria-expanded")).toBe("true");
    expect(properties).not.toBeNull();
    expect(properties?.textContent).toContain("속성");
    expect(properties?.textContent).toContain("저장소");
    expect(properties?.textContent).toContain("시도");
    expect(properties?.textContent).toContain("리비전");
    expect(
      properties?.querySelector('[aria-label="등록자: Jay"]'),
    ).not.toBeNull();
    expect(
      properties?.querySelector('.run-priority-select [aria-label="우선순위"]'),
    ).not.toBeNull();
    expect(properties?.querySelectorAll(".run-property-copy small")).toHaveLength(0);
    expect(properties?.querySelector(".run-status-control")).not.toBeNull();
    expect(properties?.textContent).not.toContain("전체 진행률");
    expect(properties?.querySelector(".run-property.progress")).toBeNull();
    const propertiesLayer = container.querySelector<HTMLElement>(
      ".run-properties-layer",
    );
    await act(async () => properties?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    ));
    expect(container.querySelector(".run-properties")).not.toBeNull();
    await act(async () => propertiesLayer?.click());
    expect(container.querySelector(".run-properties")).toBeNull();
    expect(propertiesToggle?.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("로컬 저장소 열기");
    expect(container.textContent).not.toContain(
      "이슈 처리 실행 증거를 실시간으로 표시합니다.",
    );
    expect(container.querySelector(".issue-status-history-panel")).toBeNull();
    const statusHistoryTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((button) => button.textContent === "상태");
    expect(statusHistoryTab).not.toBeNull();
    await act(async () => statusHistoryTab?.click());
    const statusHistoryPanel = container.querySelector(
      ".issue-status-history-panel",
    );
    expect(statusHistoryPanel?.getAttribute("role")).toBe("tabpanel");
    expect(statusHistoryPanel?.textContent).toContain(
      demoRunEvents[demoDashboard.runs[0].id][0].detail ?? "",
    );
    expect(statusHistoryPanel?.textContent).toContain("Jay");
    expect(statusHistoryPanel?.textContent).not.toContain("briar-app:demo-user");
    expect(
      statusHistoryPanel?.querySelectorAll(".timeline-event"),
    ).toHaveLength(demoRunEvents[demoDashboard.runs[0].id].length);
    expect(container.querySelector(".issue-activity-dialog")).toBeNull();
    const descriptionTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((button) => button.textContent === "이슈");
    await act(async () => descriptionTab?.click());
    expect(container.querySelector(".issue-status-history-panel")).toBeNull();
    const descriptionPane = container.querySelector(".issue-description-pane");
    expect(descriptionPane).not.toBeNull();
    expect(descriptionPane?.querySelector(":scope > header")).toBeNull();
    expect(descriptionPane?.querySelector(".issue-description-markdown")).toBeNull();
    expect(
      descriptionPane?.querySelector(".issue-description-inline-editor"),
    ).not.toBeNull();
    expect(descriptionPane?.querySelector(".issue-description-empty")).toBeNull();
    expect(descriptionPane?.textContent).not.toContain(demoDashboard.runs[0].detail);
    expect(container.querySelector(".issue-content-divider")).toBeNull();
    const conversation = container.querySelector(".issue-conversation");
    expect(conversation).not.toBeNull();
    expect(conversation?.getAttribute("aria-label")).toBe("대화");
    expect(conversation?.querySelector(":scope > header")?.textContent).toContain(
      "대화",
    );
    const conversationResizer = container.querySelector(
      ".run-page-conversation-resizer",
    );
    expect(conversationResizer?.getAttribute("role")).toBe("separator");
    expect(conversationResizer?.getAttribute("aria-orientation")).toBe(
      "vertical",
    );
    expect(conversationResizer?.getAttribute("aria-valuemin")).toBe("30");
    expect(conversationResizer?.getAttribute("aria-valuemax")).toBe("65");
    expect(conversationResizer?.getAttribute("aria-valuenow")).toBe("38");
    expect(container.querySelector(".run-page-main")?.nextElementSibling).toBe(
      conversationResizer,
    );
    expect(conversationResizer?.nextElementSibling).toBe(conversation);
    expect(
      conversation?.querySelector(
        ".conversation-scroll-region + .issue-message-composer",
      ),
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

  it("shows subscriber avatars and toggles the current member subscription", async () => {
    const member = demoDashboard.members![0]!;
    const onUpdateIssueSubscription = vi.fn(async () => undefined);
    const run = {
      ...demoDashboard.runs[0],
      assigneeUserId: null,
      subscribers: [{
        userId: member.userId,
        subscribedAt: "2026-08-12T00:00:00.000Z",
      }],
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(
      <RunPage
        currentUserId={member.userId}
        error={null}
        isRecovering={false}
        isSidebarOpen
        mentionMembers={[member]}
        onBack={() => undefined}
        onCancel={async () => undefined}
        onLoadAttachment={async () => new Blob()}
        onLoadIssueMessages={async () => []}
        onLoadRunEvidence={async () => []}
        onMove={async () => undefined}
        onRetry={async () => undefined}
        onSendIssueMessage={async () => {
          throw new Error("not implemented in this test");
        }}
        onUpdateIssueSubscription={onUpdateIssueSubscription}
        run={run}
      />,
    ));

    expect(container.querySelectorAll(".issue-subscriber-avatar")).toHaveLength(1);
    const subscribe = container.querySelector<HTMLButtonElement>(
      ".issue-subscribe-button",
    );
    expect(subscribe?.textContent).toContain("구독 중");
    expect(subscribe?.getAttribute("aria-pressed")).toBe("true");
    await act(async () => subscribe?.click());
    expect(onUpdateIssueSubscription).toHaveBeenCalledWith(false);

    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps an assignee subscribed", async () => {
    const member = demoDashboard.members![0]!;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <RunPage
        currentUserId={member.userId}
        error={null}
        isRecovering={false}
        isSidebarOpen
        mentionMembers={[member]}
        onBack={() => undefined}
        onCancel={async () => undefined}
        onLoadAttachment={async () => new Blob()}
        onLoadIssueMessages={async () => []}
        onLoadRunEvidence={async () => []}
        onMove={async () => undefined}
        onRetry={async () => undefined}
        onSendIssueMessage={async () => {
          throw new Error("not implemented in this test");
        }}
        onUpdateIssueSubscription={async () => undefined}
        run={{ ...demoDashboard.runs[0], assigneeUserId: member.userId }}
      />,
    ));

    const subscribe = container.querySelector<HTMLButtonElement>(
      ".issue-subscribe-button",
    );
    expect(subscribe?.disabled).toBe(true);
    expect(subscribe?.title).toBe("담당자는 이 이슈를 항상 구독합니다.");

    await act(async () => root.unmount());
    container.remove();
  });


  it("moves the conversation into a tab when the issue page becomes narrow", async () => {
    let resizeCallback: ResizeObserverCallback | null = null;
    class TestResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }

      disconnect() {}
      observe() {}
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onViewingIssueConversationChange = vi.fn();
    await act(async () => root.render(
      <RunPage
        error={null}
        isRecovering={false}
        isSidebarOpen
        onBack={() => undefined}
        onCancel={async () => undefined}
        onLoadAttachment={async () => new Blob()}
        onLoadIssueMessages={async () => []}
        onLoadRunEvidence={async () => []}
        onMove={async () => undefined}
        onRetry={async () => undefined}
        onViewingIssueConversationChange={onViewingIssueConversationChange}
        onSendIssueMessage={async () => {
          throw new Error("not implemented in this test");
        }}
        run={demoDashboard.runs[0]}
      />,
    ));
    expect(onViewingIssueConversationChange).toHaveBeenLastCalledWith(
      demoDashboard.runs[0].id,
    );

    const layout = container.querySelector<HTMLElement>(".run-page-layout")!;
    const emitResize = async (width: number) => {
      await act(async () => {
        resizeCallback?.([{
          contentRect: { width } as DOMRectReadOnly,
          target: layout,
        } as unknown as ResizeObserverEntry], {} as ResizeObserver);
      });
    };

    await emitResize(959);

    const conversationTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((tab) => tab.textContent === "대화");
    const conversationPanel = container.querySelector<HTMLElement>(
      ".issue-conversation-tab-panel",
    );
    expect(layout.classList.contains("is-conversation-tabbed")).toBe(true);
    expect(conversationTab).not.toBeNull();
    expect(conversationPanel?.hidden).toBe(true);
    expect(container.querySelector(".run-page-conversation-resizer")).toBeNull();
    expect(container.querySelectorAll(".issue-conversation")).toHaveLength(1);
    expect(onViewingIssueConversationChange).toHaveBeenLastCalledWith(null);

    await act(async () => conversationTab?.click());

    expect(conversationTab?.getAttribute("aria-selected")).toBe("true");
    expect(conversationPanel?.hidden).toBe(false);
    expect(conversationPanel?.querySelector(".issue-conversation")).not.toBeNull();
    expect(onViewingIssueConversationChange).toHaveBeenLastCalledWith(
      demoDashboard.runs[0].id,
    );

    await emitResize(960);

    expect(layout.classList.contains("is-conversation-tabbed")).toBe(false);
    expect(
      Array.from(container.querySelectorAll('[role="tab"]')).some(
        (tab) => tab.textContent === "대화",
      ),
    ).toBe(false);
    expect(container.querySelector(".issue-conversation-tab-panel")).toBeNull();
    expect(container.querySelector(".run-page-conversation-resizer")).not.toBeNull();
    expect(
      container.querySelector<HTMLElement>(".issue-description-pane")?.hidden,
    ).toBe(false);
    expect(onViewingIssueConversationChange).toHaveBeenLastCalledWith(
      demoDashboard.runs[0].id,
    );

    await act(async () => root.unmount());
    expect(onViewingIssueConversationChange).toHaveBeenLastCalledWith(null);
    container.remove();
    vi.unstubAllGlobals();
  });

  it("selects the conversation tab when a narrow issue opens from an Inbox reply", async () => {
    let resizeCallback: ResizeObserverCallback | null = null;
    class TestResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }

      disconnect() {}
      observe() {}
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <RunPage
        error={null}
        initialDetailTab="conversation"
        isRecovering={false}
        isSidebarOpen
        onBack={() => undefined}
        onCancel={async () => undefined}
        onLoadAttachment={async () => new Blob()}
        onLoadIssueMessages={async () => []}
        onLoadRunEvidence={async () => []}
        onMove={async () => undefined}
        onRetry={async () => undefined}
        onSendIssueMessage={async () => {
          throw new Error("not implemented in this test");
        }}
        run={demoDashboard.runs[0]}
      />,
    ));

    const layout = container.querySelector<HTMLElement>(".run-page-layout")!;
    await act(async () => {
      resizeCallback?.([{
        contentRect: { width: 959 } as DOMRectReadOnly,
        target: layout,
      } as unknown as ResizeObserverEntry], {} as ResizeObserver);
    });

    const conversationTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((tab) => tab.textContent === "대화");
    const conversationPanel = container.querySelector<HTMLElement>(
      ".issue-conversation-tab-panel",
    );
    expect(layout.classList.contains("is-conversation-tabbed")).toBe(true);
    expect(conversationTab?.getAttribute("aria-selected")).toBe("true");
    expect(conversationPanel?.hidden).toBe(false);
    expect(conversationPanel?.querySelector(".issue-conversation")).not.toBeNull();
    expect(container.querySelector(".run-page-conversation-resizer")).toBeNull();

    await act(async () => {
      resizeCallback?.([{
        contentRect: { width: 960 } as DOMRectReadOnly,
        target: layout,
      } as unknown as ResizeObserverEntry], {} as ResizeObserver);
    });
    expect(layout.classList.contains("is-conversation-tabbed")).toBe(false);
    expect(container.querySelector(".issue-conversation-tab-panel")).toBeNull();
    expect(
      container.querySelector<HTMLElement>(".issue-description-pane")?.hidden,
    ).toBe(false);

    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("marks an open issue viewed again when its inbox version changes", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onIssueViewed = vi.fn();
    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        dashboard={demoDashboard}
        onIssueViewed={onIssueViewed}
      />,
    ));

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".kanban-card")?.click();
    });

    const viewedRun = demoDashboard.runs[0];
    expect(onIssueViewed).toHaveBeenLastCalledWith(viewedRun.id);
    const callsAfterOpening = onIssueViewed.mock.calls.length;
    const updatedDashboard = {
      ...demoDashboard,
      runs: demoDashboard.runs.map((run) =>
        run.id === viewedRun.id
          ? {
              ...run,
              eventCount: run.eventCount + 1,
              lastEventAt: "2026-08-06T03:00:00.000Z",
            }
          : run,
      ),
    };

    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        dashboard={updatedDashboard}
        onIssueViewed={onIssueViewed}
      />,
    ));

    expect(onIssueViewed).toHaveBeenLastCalledWith(viewedRun.id);
    expect(onIssueViewed).toHaveBeenCalledTimes(callsAfterOpening + 1);
    const callsAfterIssueUpdate = onIssueViewed.mock.calls.length;

    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        dashboard={{
          ...updatedDashboard,
          conversationNotifications: [
            {
              id: "new-reply",
              runId: viewedRun.id,
              runTitle: viewedRun.title,
              rootMessageId: "root-message",
              body: "I added the requested answer.",
              author: {
                id: "reply-author",
                name: "Reply author",
                image: null,
                provider: null,
              },
              reason: "thread_reply",
              createdAt: "2026-08-06T03:01:00.000Z",
            },
          ],
        }}
        onIssueViewed={onIssueViewed}
      />,
    ));

    expect(onIssueViewed).toHaveBeenLastCalledWith(viewedRun.id);
    expect(onIssueViewed).toHaveBeenCalledTimes(callsAfterIssueUpdate + 1);

    await act(async () => root.unmount());
    container.remove();
  });


  it("refreshes status history when the open issue records a new event", async () => {
    const run = demoDashboard.runs[0];
    const events = demoRunEvents[run.id];
    const queuedEvent = events.at(-1)!;
    const onLoadRunEvents = vi
      .fn<() => Promise<typeof events>>()
      .mockResolvedValueOnce([queuedEvent])
      .mockResolvedValueOnce(events);
    const initialDashboard = {
      ...demoDashboard,
      runs: [{ ...run, eventCount: 1 }, ...demoDashboard.runs.slice(1)],
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        dashboard={initialDashboard}
        onLoadRunEvents={onLoadRunEvents}
        requestedRunId={run.id}
      />,
    ));
    expect(onLoadRunEvents).toHaveBeenCalledTimes(1);
    const statusHistoryTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((button) => button.textContent === "상태");
    await act(async () => statusHistoryTab?.click());
    expect(
      container.querySelectorAll(".issue-status-history-panel .timeline-event"),
    ).toHaveLength(1);

    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        dashboard={demoDashboard}
        onLoadRunEvents={onLoadRunEvents}
        requestedRunId={run.id}
      />,
    ));
    expect(onLoadRunEvents).toHaveBeenCalledTimes(2);
    expect(
      container.querySelectorAll(".issue-status-history-panel .timeline-event"),
    ).toHaveLength(events.length);

    await act(async () => root.unmount());
    container.remove();
  });



  it("restores the Kanban scroll position through internal issue navigation", async () => {
    const run = demoDashboard.runs[0];
    const dashboard = { ...demoDashboard, runs: [run] };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        dashboard={dashboard}
      />,
    ));
    const board = container.querySelector<HTMLDivElement>(".kanban-board");
    expect(board).not.toBeNull();
    if (board) board.scrollLeft = 248;

    await act(async () =>
      container.querySelector<HTMLElement>(".kanban-card")?.click(),
    );
    expect(container.querySelector(".run-page-shell")).not.toBeNull();

    await act(async () =>
      container.querySelector<HTMLButtonElement>(
        ".run-page-titlebar-back",
      )?.click(),
    );
    expect(container.querySelector<HTMLDivElement>(".kanban-board")?.scrollLeft)
      .toBe(248);

    await act(async () => root.unmount());
    container.remove();
  });


  it("adds a checkpoint from an unstarted issue progress chart", async () => {
    const onUpdateIssueCheckpoints = vi.fn(async () => undefined);
    const run: HuntRun = {
      ...demoDashboard.runs[0],
      status: "queued",
      workflowStage: null,
      claimedAt: null,
      leaseExpiresAt: null,
      issueCheckpoints: [],
      workflow: {
        ...demoDashboard.runs[0].workflow,
        execution: { checkpoints: [] },
      },
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <RunPage
        error={null}
        isRecovering={false}
        isSidebarOpen
        onBack={() => undefined}
        onCancel={async () => undefined}
        onLoadAttachment={async () => new Blob()}
        onLoadIssueMessages={async () => []}
        onLoadRunEvidence={async () => []}
        onMove={async () => undefined}
        onRetry={async () => undefined}
        onSendIssueMessage={async () => {
          throw new Error("not implemented in this test");
        }}
        onUpdateIssueCheckpoints={onUpdateIssueCheckpoints}
        run={run}
      />,
    ));

    const checkpoint = container.querySelector<HTMLButtonElement>(
      '.issue-workflow-checkpoint[data-position="after"]',
    );
    expect(checkpoint?.disabled).toBe(false);
    await act(async () => checkpoint?.click());
    expect(onUpdateIssueCheckpoints).toHaveBeenCalledWith([
      expect.objectContaining({
        key: expect.stringMatching(/^issue-after-/u),
        position: "after",
      }),
    ]);

    await act(async () => root.unmount());
    container.remove();
  });


  it("opens the requested issue conversation in the conversation tab", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <HuntDashboard
        {...dashboardProps}
        companionMode
        dashboard={demoDashboard}
        requestedRunId={demoDashboard.runs[0].id}
        requestedRunInitialTab="conversation"
      />,
    ));

    const conversationTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((tab) => tab.textContent === "대화");
    const conversationPanel = container.querySelector<HTMLElement>(
      ".issue-conversation-tab-panel",
    );
    expect(conversationTab?.getAttribute("aria-selected")).toBe("true");
    expect(conversationPanel?.hidden).toBe(false);

    await act(async () => root.unmount());
    container.remove();
  });




  it("shows editable prerequisite and follow-up relationships in issue properties", async () => {
    const prerequisite = demoDashboard.runs[1];
    const dependent = demoDashboard.runs[0];
    const addDependency = vi.fn(async () => undefined);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <TooltipProvider>
        <RunPage
          availableRuns={demoDashboard.runs}
          isSidebarOpen
          error={null}
          isRecovering={false}
          onAddDependency={addDependency}
          onBack={() => undefined}
          onCancel={async () => undefined}
          onLoadAttachment={async () => new Blob()}
          onLoadIssueMessages={async () => []}
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onRemoveDependency={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async () => {
            throw new Error("not implemented in this test");
          }}
          run={{
            ...dependent,
            prerequisites: [
              {
                id: prerequisite.id,
                runNumber: prerequisite.runNumber,
                title: prerequisite.title,
                status: prerequisite.status,
              },
            ],
            dependents: [],
          }}
        />
      </TooltipProvider>,
    ));

    expect(
      container.querySelector(".issue-description-scroll .issue-dependencies"),
    ).toBeNull();
    expect(container.querySelector(".issue-dependencies")).toBeNull();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".run-page-properties-toggle")?.click();
    });
    const dependencies = container.querySelector(
      ".run-properties .issue-dependencies",
    );
    expect(dependencies).not.toBeNull();
    expect(dependencies?.textContent).toContain("선행 이슈");
    expect(dependencies?.textContent).toContain(`AH-${prerequisite.runNumber}`);
    expect(dependencies?.textContent).toContain(prerequisite.title);
    expect(dependencies?.textContent).toContain("후속 이슈");
    expect(
      dependencies?.querySelector('[aria-label*="의존성 제거"]'),
    ).not.toBeNull();

    await act(async () => {
      dependencies?.querySelector<HTMLButtonElement>(
        ".issue-dependency-add-button",
      )?.click();
    });
    const picker = document.querySelector('[role="dialog"]');
    expect(picker?.textContent).toContain("선행 이슈 추가");
    expect(picker?.querySelector('[aria-label="이슈 검색"]')).not.toBeNull();
    const candidateButton = picker?.querySelector<HTMLButtonElement>(
      ".issue-dependency-picker-item",
    );
    expect(candidateButton).not.toBeNull();
    await act(async () => candidateButton?.click());
    expect(addDependency).toHaveBeenCalledWith(
      expect.not.stringMatching(prerequisite.id),
    );
    await act(async () => {
      Array.from(picker?.querySelectorAll<HTMLButtonElement>("button") ?? [])
        .find((button) => button.textContent?.trim() === "닫기")
        ?.click();
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });


  it("loads collected evidence in the issue evidence tab", async () => {
    const observedAt = "2026-07-28T04:30:00.000Z";
    const evidence: RunEvidence[] = [
      {
        key: "BRIAR-12:analyzing:repository_findings",
        attempt: 1,
        revision: 1,
        stage: "analyzing",
        type: "repository_findings",
        status: "passed",
        detail: "증빙 조회 경로와 화면 연결 지점을 확인했습니다.",
        command: "bun run test src/components/HuntDashboard.test.tsx",
        url: "https://example.com/evidence/1",
        metadata: { suite: "dashboard" },
        actor: "briar-workflow",
        observedAt,
        recordedAt: observedAt,
        requiredRevision: 1,
        canonical: true,
      },
    ];
    const onLoadRunEvidence = vi.fn(async () => evidence);
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
          onLoadRunEvidence={onLoadRunEvidence}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async () => {
            throw new Error("not implemented in this test");
          }}
          run={{
            ...demoDashboard.runs[0],
            workflow: {
              ...demoDashboard.runs[0].workflow,
              stages: demoDashboard.runs[0].workflow.stages.map((stage) =>
                stage.id === "analyzing"
                  ? { ...stage, evidence: ["repository_findings"] }
                  : stage.id === "local_qa"
                    ? { ...stage, evidence: ["local_ci_result"] }
                    : stage,
              ),
            },
          }}
        />,
      );
    });

    const evidenceTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((button) => button.textContent?.includes("증빙"));
    await act(async () => evidenceTab?.click());

    expect(onLoadRunEvidence).toHaveBeenCalledOnce();
    expect(container.querySelector(".run-evidence-panel")?.textContent).toContain(
      "repository_findings",
    );
    expect(container.querySelector(".run-evidence-panel")?.textContent).toContain(
      "증빙 조회 경로와 화면 연결 지점을 확인했습니다.",
    );
    expect(container.querySelector(".run-evidence-command code")?.textContent)
      .toContain("HuntDashboard.test.tsx");
    expect(container.querySelector(".run-evidence-panel")?.textContent).toContain(
      "local_ci_result",
    );
    expect(container.querySelector(".run-evidence-panel")?.textContent).toContain(
      "기록 안 됨",
    );

    await act(async () => root.unmount());
    container.remove();
  });

  it("shows authenticated result screenshots in the result and evidence tabs", async () => {
    const observedAt = "2026-07-28T04:30:00.000Z";
    const image = {
      id: "image-1",
      filename: "finished-dashboard.png",
      contentType: "image/png",
      byteSize: 1024,
      sha256: "abc",
      position: 0,
      url: "/projects/project-1/runs/run-1/evidence/images/image-1",
    };
    const staleImage = {
      ...image,
      id: "image-stale",
      filename: "stale-dashboard.png",
      url: "/projects/project-1/runs/run-1/evidence/images/image-stale",
    };
    const failedImage = {
      ...image,
      id: "image-failed",
      filename: "failed-dashboard.png",
      url: "/projects/project-1/runs/run-1/evidence/images/image-failed",
    };
    const evidence: RunEvidence[] = [
      {
        key: "BRIAR-12:local_qa:ui_result",
        attempt: 1,
        revision: 1,
        stage: "local_qa",
        type: "ui_result",
        status: "passed",
        detail: "완성된 대시보드 화면을 확인했습니다.",
        command: null,
        url: null,
        metadata: null,
        actor: "briar-workflow",
        observedAt,
        recordedAt: observedAt,
        images: [image],
        requiredRevision: 1,
        canonical: true,
      },
      {
        key: "BRIAR-12:local_qa:stale_ui_result",
        attempt: 1,
        revision: 0,
        stage: "local_qa",
        type: "ui_result",
        status: "passed",
        detail: "이전 리비전 화면입니다.",
        command: null,
        url: null,
        metadata: null,
        actor: "briar-workflow",
        observedAt,
        recordedAt: observedAt,
        images: [staleImage],
        requiredRevision: 1,
        canonical: false,
      },
      {
        key: "BRIAR-12:local_qa:failed_ui_result",
        attempt: 1,
        revision: 1,
        stage: "local_qa",
        type: "ui_result",
        status: "failed",
        detail: "실패한 화면입니다.",
        command: null,
        url: null,
        metadata: null,
        actor: "briar-workflow",
        observedAt,
        recordedAt: observedAt,
        images: [failedImage],
        requiredRevision: 1,
        canonical: true,
      },
    ];
    const onLoadImage = vi.fn(async () => new Blob(["image"], { type: "image/png" }));
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:result-screenshot"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
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
          onLoadRunEvidence={async () => evidence}
          onLoadRunEvidenceImage={onLoadImage}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async () => {
            throw new Error("not implemented in this test");
          }}
          run={{
            ...demoDashboard.runs[0],
            status: "completed",
            resultSummary: "완료된 결과를 확인했습니다.",
          }}
        />,
      );
    });

    expect(onLoadImage).toHaveBeenCalledTimes(1);
    expect(onLoadImage).toHaveBeenCalledWith(image);
    expect(onLoadImage).not.toHaveBeenCalledWith(staleImage);
    expect(onLoadImage).not.toHaveBeenCalledWith(failedImage);
    expect(
      container
        .querySelector(".run-result-screenshots .run-evidence-image img")
        ?.getAttribute("src"),
    ).toBe("blob:result-screenshot");
    expect(
      container.querySelectorAll(
        ".run-result-screenshots .run-evidence-image",
      ),
    ).toHaveLength(1);
    expect(
      container.querySelector(".run-result-screenshots")?.textContent,
    ).toContain("결과 화면");
    expect(
      container
        .querySelector(".completed-issue-card")
        ?.contains(container.querySelector(".run-result-screenshots")),
    ).toBe(true);
    const enlargeButton = container.querySelector<HTMLButtonElement>(
      '.run-result-screenshots [aria-label="finished-dashboard.png 크게 보기"]',
    );
    expect(enlargeButton).not.toBeNull();
    expect(
      container.querySelector(".run-result-screenshots .run-evidence-image a"),
    ).toBeNull();

    await act(async () => enlargeButton?.click());

    expect(document.querySelector('[role="dialog"] img')?.getAttribute("src"))
      .toBe("blob:result-screenshot");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "finished-dashboard.png",
    );
    const download = document.querySelector<HTMLAnchorElement>(
      '[role="dialog"] .image-lightbox-download',
    );
    expect(download?.download).toBe("finished-dashboard.png");
    expect(download?.getAttribute("href")).toBe("blob:result-screenshot");

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[role="dialog"] button')?.click();
    });

    expect(document.querySelector('[role="dialog"]')).toBeNull();

    const evidenceTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((button) => button.textContent?.includes("증빙"));
    await act(async () => evidenceTab?.click());

    expect(onLoadImage).toHaveBeenCalledWith(image);
    expect(onLoadImage).toHaveBeenCalledWith(staleImage);
    expect(onLoadImage).toHaveBeenCalledWith(failedImage);
    expect(
      container.querySelector(".run-evidence-image img")?.getAttribute("src"),
    ).toBe("blob:result-screenshot");
    expect(container.querySelector(".run-evidence-images")?.textContent).toContain(
      "결과 화면",
    );

    await act(async () => root.unmount());
    container.remove();
  });

  it("reloads result screenshots when the open issue changes", async () => {
    const observedAt = "2026-07-28T04:30:00.000Z";
    const firstRun = {
      ...demoDashboard.runs[0],
      id: "run-result-first",
      sourceKey: "BRIAR-101",
      status: "completed" as const,
      resultSummary: "첫 번째 이슈 결과입니다.",
    };
    const secondRun = {
      ...firstRun,
      id: "run-result-second",
      sourceKey: "BRIAR-102",
      resultSummary: "두 번째 이슈 결과입니다.",
    };
    const evidenceFor = (run: HuntRun): RunEvidence[] => [{
      key: `${run.sourceKey}:local_qa:ui_result`,
      attempt: 1,
      revision: 1,
      stage: "local_qa",
      type: "ui_result",
      status: "passed",
      detail: `${run.sourceKey} 화면입니다.`,
      command: null,
      url: null,
      metadata: null,
      actor: "briar-workflow",
      observedAt,
      recordedAt: observedAt,
      images: [{
        id: `image-${run.id}`,
        filename: `${run.id}.png`,
        contentType: "image/png",
        byteSize: 1024,
        sha256: run.id,
        position: 0,
        url: `/projects/project-1/runs/${run.id}/evidence/images/image-${run.id}`,
      }],
      requiredRevision: 1,
      canonical: true,
    }];
    const evidenceLoads: string[] = [];
    const onLoadImage = vi.fn(async () =>
      new Blob(["image"], { type: "image/png" }));
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn()
        .mockReturnValueOnce("blob:first-result-screenshot")
        .mockReturnValueOnce("blob:second-result-screenshot"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const renderPage = (run: HuntRun) => (
      <RunPage
        isSidebarOpen
        error={null}
        isRecovering={false}
        onBack={() => undefined}
        onCancel={async () => undefined}
        onLoadAttachment={async () => new Blob()}
        onLoadIssueMessages={async () => []}
        onLoadRunEvidence={async () => {
          evidenceLoads.push(run.id);
          return evidenceFor(run);
        }}
        onLoadRunEvidenceImage={onLoadImage}
        onMove={async () => undefined}
        onRetry={async () => undefined}
        onSendIssueMessage={async () => {
          throw new Error("not implemented in this test");
        }}
        run={run}
      />
    );

    await act(async () => root.render(renderPage(firstRun)));
    expect(
      container
        .querySelector(".run-result-screenshots .run-evidence-image img")
        ?.getAttribute("src"),
    ).toBe("blob:first-result-screenshot");

    await act(async () => root.render(renderPage(secondRun)));

    expect(evidenceLoads).toEqual([firstRun.id, secondRun.id]);
    expect(container.textContent).not.toContain(`${firstRun.id}.png`);
    expect(container.textContent).toContain(`${secondRun.id}.png`);
    expect(
      container
        .querySelector(".run-result-screenshots .run-evidence-image img")
        ?.getAttribute("src"),
    ).toBe("blob:second-result-screenshot");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(
      "blob:first-result-screenshot",
    );

    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps loaded messages visible when the run snapshot refreshes", async () => {
    const createdAt = new Date().toISOString();
    const loadedMessage: IssueMessage = {
      id: "message-loaded",
      runId: demoDashboard.runs[0].id,
      parentMessageId: null,
      body: "계속 보여야 하는 메시지",
      author: { id: "jay", name: "Jay", image: null, provider: null },
      replyCount: 0,
      createdAt,
      updatedAt: createdAt,
    };
    const onLoadIssueMessages = vi
      .fn<() => Promise<IssueMessage[]>>()
      .mockResolvedValueOnce([loadedMessage])
      .mockImplementation(() => new Promise(() => undefined));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const renderPage = (run = demoDashboard.runs[0]) => (
      <RunPage
        isSidebarOpen
        error={null}
        isRecovering={false}
        onBack={() => undefined}
        onCancel={async () => undefined}
        onLoadAttachment={async () => new Blob()}
        onLoadIssueMessages={() => onLoadIssueMessages()}
        onLoadRunEvidence={async () => []}
        onMove={async () => undefined}
        onRetry={async () => undefined}
        onSendIssueMessage={async () => {
          throw new Error("not implemented in this test");
        }}
        run={run}
      />
    );

    await act(async () => root.render(renderPage()));
    expect(onLoadIssueMessages).toHaveBeenCalledOnce();
    expect(container.querySelector(".issue-message-list")?.textContent).toContain(
      loadedMessage.body,
    );

    await act(async () => {
      root.render(
        renderPage({
          ...demoDashboard.runs[0],
          updatedAt: new Date(Date.now() + 15_000).toISOString(),
        }),
      );
    });

    expect(onLoadIssueMessages).toHaveBeenCalledOnce();
    expect(container.querySelector(".issue-message-state")).toBeNull();
    expect(container.querySelector(".issue-message-list")?.textContent).toContain(
      loadedMessage.body,
    );

    await act(async () => root.unmount());
    container.remove();
  });

  it("uses Inbox conversation changes as a delta recovery signal", async () => {
    const run = demoDashboard.runs[0];
    const createdAt = "2026-08-15T00:00:00.000Z";
    const trigger: IssueMessage = {
      id: "message-trigger",
      runId: run.id,
      parentMessageId: null,
      body: "@developer 답변해 줘",
      author: { id: "jay", name: "Jay", image: null, provider: null },
      replyCount: 0,
      createdAt,
      updatedAt: createdAt,
    };
    const reply: IssueMessage = {
      ...trigger,
      id: "message-reply",
      parentMessageId: trigger.id,
      body: "완료된 답변",
      author: {
        id: null,
        name: "Briar · Codex",
        image: null,
        provider: "codex",
      },
      createdAt: "2026-08-15T00:01:00.000Z",
      updatedAt: "2026-08-15T00:01:00.000Z",
    };
    const replyJob = {
      id: "reply-job-1",
      triggerMessageId: trigger.id,
      parentMessageId: trigger.id,
      agentId: "agent-developer",
      agentName: "Developer",
      status: "running" as const,
      attempts: 1,
      workerId: null,
      provider: "codex" as const,
      error: null,
      updatedAt: createdAt,
    };
    const reviewerReplyJob = {
      ...replyJob,
      id: "reply-job-2",
      agentId: "agent-reviewer",
      agentName: "Reviewer",
    };
    const loadSnapshot = vi
      .spyOn(api, "loadIssueConversationSnapshot")
      .mockResolvedValue({
        cursor: 7,
        messages: [trigger],
        agentReplies: [replyJob, reviewerReplyJob],
      });
    const loadDelta = vi
      .spyOn(api, "loadIssueConversationDelta")
      .mockResolvedValueOnce({
        cursor: 7,
        hasMore: false,
        changed: false,
      })
      .mockResolvedValueOnce({
        cursor: 8,
        hasMore: false,
        changed: true,
        messages: [trigger, reply],
        agentReplies: [replyJob, reviewerReplyJob].map((job) => ({
          ...job,
          status: "completed" as const,
          updatedAt: "2026-08-15T00:01:00.000Z",
        })),
      });
    const transport = {
      start: vi.fn(),
      stop: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    };
    const createTransport = vi
      .spyOn(channelRealtime, "createProjectRealtimeTransport")
      .mockReturnValue(transport);
    const activity = vi
      .spyOn(issueActivityHook, "useIssueAgentActivity")
      .mockReturnValue(new Map([[
        replyJob.id,
        {
          version: 1,
          replyJobId: replyJob.id,
          attempt: 1,
          sequence: 1,
          projectId: demoDashboard.project.id,
          runId: run.id,
          triggerMessageId: trigger.id,
          parentMessageId: trigger.id,
          activity: {
            id: "commentary-1",
            kind: "message",
            headline: "원인을 확인하고 있습니다.",
          },
          sentAt: createdAt,
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
      ]]));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const renderPage = (conversationInboxSyncSignal: string) => (
      <RunPage
        conversationInboxSyncSignal={conversationInboxSyncSignal}
        error={null}
        isRecovering={false}
        isSidebarOpen
        onBack={() => undefined}
        onCancel={async () => undefined}
        onLoadAttachment={async () => new Blob()}
        onLoadIssueMessages={async () => []}
        onLoadRunEvidence={async () => []}
        onMove={async () => undefined}
        onRetry={async () => undefined}
        onSendIssueMessage={async () => {
          throw new Error("message should not be sent");
        }}
        organizationId="organization-1"
        projectId={demoDashboard.project.id}
        run={run}
        token="token"
      />
    );

    await act(async () => {
      root.render(renderPage("baseline"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(loadSnapshot).toHaveBeenCalledOnce();
    expect(loadDelta).toHaveBeenCalledOnce();
    expect(container.textContent).toContain(
      "Developer · 원인을 확인하고 있습니다.",
    );
    expect(container.textContent).not.toContain(
      "Briar · 원인을 확인하고 있습니다.",
    );
    expect(container.textContent).toContain(
      "Reviewer님이 답변을 작성하고 있습니다…",
    );

    await act(async () => {
      root.render(renderPage("conversation:message-reply"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(loadDelta).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain(reply.body);
    expect(container.textContent).not.toContain(
      "Agent가 답변을 작성하고 있습니다",
    );

    await act(async () => root.unmount());
    container.remove();
    createTransport.mockRestore();
    activity.mockRestore();
    loadDelta.mockRestore();
    loadSnapshot.mockRestore();
  });

  it("reloads execution proposals when the run execution snapshot changes", async () => {
    const conversationRun = demoDashboard.runs[1];
    const targetRun = {
      ...demoDashboard.runs[0],
      status: "backlog" as const,
      workflowStage: null,
      executionReadiness: "ready" as const,
      claimedBy: null,
      claimedAt: null,
      workerId: null,
      dispatchedAt: null,
      requestedByUserId: null,
      dispatchMode: null,
    };
    const createdAt = "2026-08-11T00:00:00.000Z";
    const message: IssueMessage = {
      id: "message-execution-proposal",
      runId: conversationRun.id,
      parentMessageId: null,
      body: "이 이슈의 실행을 제안합니다.",
      author: { id: null, name: "Briar · Codex", image: null, provider: "codex" },
      replyCount: 0,
      executionProposal: {
        id: "40404040-dddd-4ddd-8ddd-dddddddddddd",
        type: "request_issue_execute",
        status: "pending",
        projectId: demoDashboard.project.id,
        runId: targetRun.id,
        title: targetRun.title,
        createdAt,
        acceptedAt: null,
        requestedProvider: null,
        requestedModel: null,
        requestedEffort: null,
        requestedWorkerId: null,
        delegatedByAgentId: null,
        delegatedByAgentName: null,
      },
      createdAt,
      updatedAt: createdAt,
    };
    const onLoadIssueMessages = vi
      .fn<() => Promise<IssueMessage[]>>()
      .mockResolvedValueOnce([message])
      .mockResolvedValue([{ ...message, executionProposal: null }]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const renderPage = (nextTargetRun: HuntRun) => (
      <RunPage
        availableRuns={[conversationRun, nextTargetRun]}
        isSidebarOpen
        error={null}
        isRecovering={false}
        onBack={() => undefined}
        onCancel={async () => undefined}
        onLoadAttachment={async () => new Blob()}
        onLoadIssueMessages={onLoadIssueMessages}
        onLoadRunEvidence={async () => []}
        onMove={async () => undefined}
        onRetry={async () => undefined}
        onSendIssueMessage={async () => {
          throw new Error("not implemented in this test");
        }}
        run={conversationRun}
      />
    );

    await act(async () => root.render(renderPage(targetRun)));
    expect(container.querySelector(".execution-proposal-card")).not.toBeNull();

    await act(async () => {
      root.render(renderPage({ ...targetRun, agentId: dashboardAgent.id }));
      await Promise.resolve();
    });

    expect(onLoadIssueMessages).toHaveBeenCalledTimes(2);
    expect(container.querySelector(".execution-proposal-card")).toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it("uses the shared exact-Worker Skill approval in issue conversations", async () => {
    const run = demoDashboard.runs[0];
    const pending = {
      id: "skill-issue-approval",
      type: "request_agent_skill_execute" as const,
      status: "pending" as const,
      projectId: demoDashboard.project.id,
      agentId: dashboardAgent.id,
      agentName: dashboardAgent.name,
      skillId: "skill-release",
      skillName: "Release",
      request: "Release this project",
      provider: "codex" as const,
      model: null,
      effort: null,
      createdAt: "2026-08-11T00:00:00.000Z",
      acceptedAt: null,
      requestedWorkerId: null,
      requestedWorkerLabel: null,
      resultSessionId: null,
      delegatedByAgentId: null,
      delegatedByAgentName: null,
    };
    const message: IssueMessage = {
      id: "message-skill-approval",
      runId: run.id,
      parentMessageId: null,
      body: "I matched the Release Skill.",
      author: { id: null, name: "Briar · Codex", image: null, provider: "codex" },
      replyCount: 0,
      skillExecutionProposal: pending,
      createdAt: pending.createdAt,
      updatedAt: pending.createdAt,
    };
    const onAccept = vi.fn(async (_proposal, input) => ({
      ...pending,
      status: "accepted" as const,
      acceptedAt: "2026-08-11T00:01:00.000Z",
      requestedWorkerId: input.workerId,
      requestedWorkerLabel: dashboardWorker.label,
      resultSessionId: "session-skill-issue",
    }));
    const skillWorker: ExecutionWorker = {
      ...dashboardWorker,
      readiness: "available",
      activeSessions: 0,
      availableSessions: 1,
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <RunPage
          availableRuns={[run]}
          error={null}
          executionWorkers={[skillWorker]}
          isRecovering={false}
          isSidebarOpen
          onAcceptSkillExecution={onAccept}
          onBack={() => undefined}
          onCancel={async () => undefined}
          onLoadAttachment={async () => new Blob()}
          onLoadIssueMessages={async () => [message]}
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async () => {
            throw new Error("not implemented in this test");
          }}
          projectId={demoDashboard.project.id}
          run={run}
        />,
      );
      await Promise.resolve();
    });
    expect(container.querySelector(".skill-execution-proposal-card")).not.toBeNull();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".skill-execution-proposal-card footer button",
      )?.click();
    });
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>(
        'button[aria-label="실행할 정확한 Worker"]',
      )?.click();
    });
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>(
        '[role="option"][data-value="worker-1"]',
      )?.click();
    });
    const approve = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("승인하고 Skill 실행"));
    await act(async () => approve?.click());

    expect(onAccept).toHaveBeenCalledWith(pending, { workerId: "worker-1" });
    expect(container.textContent).toContain("session-skill-issue");
    await act(async () => root.unmount());
    container.remove();
  });

  it("revalidates a newly loaded pending proposal when its target changed during the load", async () => {
    const conversationRun = demoDashboard.runs[1];
    const targetRun = {
      ...demoDashboard.runs[0],
      status: "backlog" as const,
      workflowStage: null,
      executionReadiness: "ready" as const,
      claimedBy: null,
      claimedAt: null,
      workerId: null,
      dispatchedAt: null,
      requestedByUserId: null,
      dispatchMode: null,
    };
    const createdAt = "2026-08-11T00:00:00.000Z";
    const message: IssueMessage = {
      id: "message-delayed-execution-proposal",
      runId: conversationRun.id,
      parentMessageId: null,
      body: "늦게 도착한 실행 제안입니다.",
      author: { id: null, name: "Briar · Codex", image: null, provider: "codex" },
      replyCount: 0,
      executionProposal: {
        id: "51515151-dddd-4ddd-8ddd-dddddddddddd",
        type: "request_issue_execute",
        status: "pending",
        projectId: demoDashboard.project.id,
        runId: targetRun.id,
        title: targetRun.title,
        createdAt,
        acceptedAt: null,
        requestedProvider: null,
        requestedModel: null,
        requestedEffort: null,
        requestedWorkerId: null,
        delegatedByAgentId: null,
        delegatedByAgentName: null,
      },
      createdAt,
      updatedAt: createdAt,
    };
    let resolveInitialLoad!: (messages: IssueMessage[]) => void;
    const initialLoad = new Promise<IssueMessage[]>((resolve) => {
      resolveInitialLoad = resolve;
    });
    const onLoadIssueMessages = vi
      .fn<() => Promise<IssueMessage[]>>()
      .mockImplementationOnce(() => initialLoad)
      .mockResolvedValue([{ ...message, executionProposal: null }]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const renderPage = (nextTargetRun: HuntRun) => (
      <RunPage
        availableRuns={[conversationRun, nextTargetRun]}
        isSidebarOpen
        error={null}
        isRecovering={false}
        onBack={() => undefined}
        onCancel={async () => undefined}
        onLoadAttachment={async () => new Blob()}
        onLoadIssueMessages={onLoadIssueMessages}
        onLoadRunEvidence={async () => []}
        onMove={async () => undefined}
        onRetry={async () => undefined}
        onSendIssueMessage={async () => {
          throw new Error("not implemented in this test");
        }}
        run={conversationRun}
      />
    );

    await act(async () => root.render(renderPage(targetRun)));
    await act(async () => {
      root.render(renderPage({
        ...targetRun,
        status: "queued",
        updatedAt: "2026-08-11T00:01:00.000Z",
      }));
      resolveInitialLoad([message]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onLoadIssueMessages).toHaveBeenCalledTimes(2);
    expect(container.querySelector(".execution-proposal-card")).toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it("does not reload accepted proposal history as its target progresses", async () => {
    const conversationRun = demoDashboard.runs[1];
    const targetRun = demoDashboard.runs[0];
    const createdAt = "2026-08-11T00:00:00.000Z";
    const message: IssueMessage = {
      id: "message-accepted-execution-proposal",
      runId: conversationRun.id,
      parentMessageId: null,
      body: "승인된 실행 기록입니다.",
      author: { id: null, name: "Briar · Codex", image: null, provider: "codex" },
      replyCount: 0,
      executionProposal: {
        id: "62626262-dddd-4ddd-8ddd-dddddddddddd",
        type: "request_issue_execute",
        status: "accepted",
        projectId: demoDashboard.project.id,
        runId: targetRun.id,
        title: targetRun.title,
        createdAt,
        acceptedAt: "2026-08-11T00:01:00.000Z",
        requestedProvider: "codex",
        requestedModel: "gpt-5.6-sol",
        requestedEffort: "high",
        requestedWorkerId: null,
        delegatedByAgentId: null,
        delegatedByAgentName: null,
      },
      createdAt,
      updatedAt: createdAt,
    };
    const onLoadIssueMessages = vi
      .fn<() => Promise<IssueMessage[]>>()
      .mockResolvedValue([message]);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const renderPage = (nextTargetRun: HuntRun) => (
      <RunPage
        availableRuns={[conversationRun, nextTargetRun]}
        isSidebarOpen
        error={null}
        isRecovering={false}
        onBack={() => undefined}
        onCancel={async () => undefined}
        onLoadAttachment={async () => new Blob()}
        onLoadIssueMessages={onLoadIssueMessages}
        onLoadRunEvidence={async () => []}
        onMove={async () => undefined}
        onRetry={async () => undefined}
        onSendIssueMessage={async () => {
          throw new Error("not implemented in this test");
        }}
        run={conversationRun}
      />
    );

    await act(async () => root.render(renderPage(targetRun)));
    expect(onLoadIssueMessages).toHaveBeenCalledOnce();
    await act(async () => {
      root.render(renderPage({
        ...targetRun,
        status: "queued",
        updatedAt: "2026-08-11T00:02:00.000Z",
      }));
      await Promise.resolve();
    });

    expect(onLoadIssueMessages).toHaveBeenCalledOnce();
    expect(container.querySelector(".execution-proposal-card")).not.toBeNull();
    expect(container.querySelector(".issue-message-state")).toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });





  it("shows an Android/Tauri message without a sending label and restores the draft on failure", async () => {
    let rejectSend: (reason: Error) => void = () => undefined;
    const pendingSend = new Promise<IssueMessageSendResult>((_resolve, reject) => {
      rejectSend = reject;
    });
    const onSendIssueMessage = vi.fn(() => pendingSend);
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
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={onSendIssueMessage}
          run={demoDashboard.runs[0]}
        />,
      );
      await Promise.resolve();
    });

    const draft = "안드로이드 대화 초안";
    const textarea = container.querySelector<HTMLTextAreaElement>(
      ".issue-message-composer textarea",
    );
    await act(async () => {
      if (!textarea) return;
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(textarea, draft);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".issue-message-composer .issue-message-send",
      )?.click();
      await Promise.resolve();
    });

    expect(onSendIssueMessage).toHaveBeenCalledOnce();
    expect(onSendIssueMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        body: draft,
        clientMessageId: expect.any(String),
      }),
    );
    expect(textarea?.value).toBe("");
    expect(container.querySelector(".issue-message.is-optimistic")?.textContent)
      .toContain(draft);
    expect(container.querySelector(".conversation-message-sending"))
      .toBeNull();
    expect(
      container.querySelector<HTMLButtonElement>(
        ".issue-message-composer .issue-message-send",
      )?.disabled,
    ).toBe(true);

    await act(async () => {
      rejectSend(new Error("전송 실패"));
      await pendingSend.catch(() => undefined);
      await Promise.resolve();
    });
    expect(textarea?.value).toBe(draft);
    expect(container.querySelector(".issue-message.is-optimistic")).toBeNull();
    expect(container.querySelector(".issue-composer-error")?.textContent)
      .toContain("전송 실패");

    await act(async () => root.unmount());
    container.remove();
  });

  it("pastes an image into the issue conversation and sends it without text", async () => {
    const image = new File(["image"], "clipboard.png", { type: "image/png" });
    const sentMessage: IssueMessage = {
      id: "message-with-image",
      runId: demoDashboard.runs[0].id,
      parentMessageId: null,
      body: "![clipboard.png](briar-attachment://stored-image)",
      attachments: [{
        id: "stored-image",
        filename: image.name,
        contentType: image.type,
        byteSize: image.size,
        url: "blob:stored-image",
      }],
      author: { id: "jay", name: "Jay", image: null, provider: null },
      replyCount: 0,
      createdAt: "2026-08-05T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:00.000Z",
    };
    const onSendIssueMessage = vi.fn(async () => ({
      message: sentMessage,
      agentReply: null,
    }));
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
          onLoadAttachment={async () => image}
          onLoadIssueMessages={async () => []}
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={onSendIssueMessage}
          run={demoDashboard.runs[0]}
        />,
      );
      await Promise.resolve();
    });
    const textarea = container.querySelector<HTMLTextAreaElement>(
      ".issue-conversation > .issue-message-composer textarea",
    );
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        files: [image],
        items: [{ kind: "file", getAsFile: () => image }],
        types: ["Files"],
      },
    });
    await act(async () => textarea?.dispatchEvent(paste));
    expect(container.querySelector(".issue-composer-attachment")?.textContent)
      .toContain("clipboard.png");
    expect(
      container.querySelector(
        ".issue-conversation > .issue-message-composer .issue-message-send .lucide-send",
      ),
    ).not.toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".issue-conversation > .issue-message-composer .issue-message-send",
      )?.click();
      await Promise.resolve();
    });
    expect(onSendIssueMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [image],
        body: expect.stringContaining("briar-attachment://"),
      }),
    );
    await act(async () => root.unmount());
    container.remove();
  });


  it("renders replies flat and sends a reply to any message", async () => {
    const rootMessage: IssueMessage = {
      id: "message-root",
      runId: demoDashboard.runs[0].id,
      parentMessageId: null,
      body: "원문 메시지",
      author: { id: "jay", name: "Jay", image: null, provider: null },
      replyCount: 1,
      createdAt: "2026-08-03T10:00:00.000Z",
      updatedAt: "2026-08-03T10:00:00.000Z",
    };
    const reply: IssueMessage = {
      ...rootMessage,
      id: "message-reply",
      parentMessageId: rootMessage.id,
      body: "기존 답글",
      replyCount: 1,
      createdAt: "2026-08-03T10:01:00.000Z",
      updatedAt: "2026-08-03T10:01:00.000Z",
    };
    const nestedReply: IssueMessage = {
      ...rootMessage,
      id: "message-nested-reply",
      parentMessageId: reply.id,
      body: "기존 대댓글",
      replyCount: 0,
      createdAt: "2026-08-03T10:02:00.000Z",
      updatedAt: "2026-08-03T10:02:00.000Z",
    };
    let sentParentId: string | null | undefined;
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
          onLoadIssueMessages={async () => [rootMessage, reply, nestedReply]}
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async (input) => {
            sentParentId = input.parentMessageId;
            return { message: nestedReply, agentReply: null };
          }}
          run={demoDashboard.runs[0]}
        />,
      );
    });

    const groupByBody = (body: string) =>
      Array.from(
        container.querySelectorAll<HTMLElement>(".issue-message-group"),
      ).find((group) =>
        group
          .querySelector(":scope > .issue-message > div > .issue-message-body")
          ?.textContent?.includes(body),
      );
    const replyGroup = groupByBody("기존 답글");
    const nestedGroup = groupByBody("기존 대댓글");
    expect(container.querySelectorAll(".issue-message-group")).toHaveLength(3);
    expect(container.querySelector(".issue-message-replies")).toBeNull();
    expect(replyGroup).not.toBeUndefined();
    expect(nestedGroup).not.toBeUndefined();
    expect(replyGroup?.querySelector(".issue-message-parent-quote")?.textContent)
      .toContain("원문 메시지");
    expect(
      nestedGroup?.querySelector(".issue-message-parent-quote")?.textContent,
    ).toContain("기존 답글");

    const nestedReplyButton = nestedGroup?.querySelector<HTMLButtonElement>(
      ".issue-reply-trigger",
    );
    expect(nestedReplyButton?.getAttribute("title")).toBe("답글 작성");
    await act(async () => nestedReplyButton?.click());
    const nestedComposer = nestedGroup?.querySelector<HTMLElement>(
      ".issue-inline-reply-composer .issue-message-composer textarea",
    ) as HTMLTextAreaElement | null;
    expect(nestedComposer?.placeholder).toBe("답장 남기기…");

    await act(async () => {
      if (!nestedComposer) return;
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(nestedComposer, "대댓글에 이어서");
      nestedComposer.dispatchEvent(new Event("input", { bubbles: true }));
      nestedComposer.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
        }),
      );
      await Promise.resolve();
    });
    expect(sentParentId).toBe(nestedReply.id);
    await act(async () => root.unmount());
    container.remove();
  });

  it("edits and deletes messages the current user authored", async () => {
    const createdAt = "2026-08-03T10:00:00.000Z";
    const rootMessage: IssueMessage = {
      id: "message-root",
      runId: demoDashboard.runs[0].id,
      parentMessageId: null,
      body: "수정 전 원문",
      author: { id: "jay", name: "Jay", image: null, provider: null },
      replyCount: 1,
      createdAt,
      updatedAt: createdAt,
    };
    const reply: IssueMessage = {
      ...rootMessage,
      id: "message-reply",
      parentMessageId: rootMessage.id,
      body: "기존 답글",
      replyCount: 0,
      createdAt: "2026-08-03T10:01:00.000Z",
      updatedAt: "2026-08-03T10:01:00.000Z",
    };
    const onEditIssueMessage = vi.fn(async () => ({
      ...rootMessage,
      body: "수정 후 본문",
      updatedAt: "2026-08-03T10:02:00.000Z",
    }));
    const onDeleteIssueMessage = vi.fn(async () => undefined);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <RunPage
          currentUserId="jay"
          isSidebarOpen
          error={null}
          isRecovering={false}
          onBack={() => undefined}
          onCancel={async () => undefined}
          onDeleteIssueMessage={onDeleteIssueMessage}
          onEditIssueMessage={onEditIssueMessage}
          onLoadAttachment={async () => new Blob()}
          onLoadIssueMessages={async () => [rootMessage, reply]}
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async () => ({
            message: rootMessage,
            agentReply: null,
          })}
          run={demoDashboard.runs[0]}
        />,
      );
    });

    const groupByBody = (body: string) =>
      Array.from(
        container.querySelectorAll<HTMLElement>(".issue-message-group"),
      ).find((group) =>
        group
          .querySelector(":scope > .issue-message > div > .issue-message-body")
          ?.textContent?.includes(body),
      );
    const rootGroup = groupByBody("수정 전 원문");
    expect(rootGroup).not.toBeUndefined();
    const editButton = rootGroup?.querySelector<HTMLButtonElement>(
      'button[title="메시지 수정"]',
    );
    const deleteButton = rootGroup?.querySelector<HTMLButtonElement>(
      'button[title="메시지 삭제"]',
    );
    expect(editButton).not.toBeNull();
    expect(deleteButton).not.toBeNull();

    await act(async () => editButton?.click());
    const editComposer = rootGroup?.querySelector<HTMLElement>(
      ".issue-inline-reply-composer .issue-message-composer textarea",
    ) as HTMLTextAreaElement | null;
    expect(editComposer?.value).toBe("수정 전 원문");
    expect(editComposer?.placeholder).toBe("메시지 수정…");
    await act(async () => {
      if (!editComposer) return;
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(editComposer, "수정 후 본문");
      editComposer.dispatchEvent(new Event("input", { bubbles: true }));
      editComposer.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
        }),
      );
      await Promise.resolve();
    });
    expect(onEditIssueMessage).toHaveBeenCalledWith(
      rootMessage.id,
      expect.objectContaining({ body: "수정 후 본문" }),
    );
    expect(container.textContent).toContain("수정 후 본문");

    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockImplementation(() => true);
    const replyGroup = groupByBody("기존 답글");
    await act(async () =>
      replyGroup
        ?.querySelector<HTMLButtonElement>('button[title="메시지 삭제"]')
        ?.click()
    );
    expect(onDeleteIssueMessage).toHaveBeenCalledWith(reply.id);
    expect(rootGroup?.querySelector(".conversation-reply-summary")).toBeNull();

    await act(async () => deleteButton?.click());
    confirmSpy.mockRestore();
    expect(onDeleteIssueMessage).toHaveBeenCalledWith(rootMessage.id);
    expect(container.querySelector(".issue-message-group")).toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it("hides edit and delete actions for messages the current user did not author", async () => {
    const createdAt = "2026-08-03T10:00:00.000Z";
    const agentMessage: IssueMessage = {
      id: "message-agent",
      runId: demoDashboard.runs[0].id,
      parentMessageId: null,
      body: "Developer의 답변",
      author: {
        id: null,
        name: "Briar · Codex",
        image: null,
        provider: "codex",
      },
      replyCount: 0,
      createdAt,
      updatedAt: createdAt,
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <RunPage
          currentUserId="jay"
          isSidebarOpen
          error={null}
          isRecovering={false}
          onBack={() => undefined}
          onCancel={async () => undefined}
          onLoadAttachment={async () => new Blob()}
          onLoadIssueMessages={async () => [agentMessage]}
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async () => ({
            message: agentMessage,
            agentReply: null,
          })}
          run={demoDashboard.runs[0]}
        />,
      );
    });
    expect(
      container.querySelector('button[title="메시지 수정"]'),
    ).toBeNull();
    expect(
      container.querySelector('button[title="메시지 삭제"]'),
    ).toBeNull();
    await act(async () => root.unmount());
    container.remove();
  });


  it("keeps the conversation error alert when an agent reply fails", async () => {
    const createdAt = new Date().toISOString();
    const userMessage: IssueMessage = {
      id: "message-reply-failed",
      runId: demoDashboard.runs[0].id,
      parentMessageId: null,
      body: "@developer 실패한 답변",
      author: { id: "jay", name: "Jay", image: null, provider: null },
      replyCount: 0,
      createdAt,
      updatedAt: createdAt,
    };
    let rejectAgentReply: (error: Error) => void = () => undefined;
    const pendingAgentReply = new Promise<IssueMessage>((_, reject) => {
      rejectAgentReply = reject;
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
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async () => ({
            message: userMessage,
            agentReply: pendingAgentReply,
          })}
          run={demoDashboard.runs[0]}
        />,
      );
    });

    const textarea = container.querySelector<HTMLTextAreaElement>(
      ".issue-message-composer textarea",
    );
    await act(async () => {
      if (!textarea) return;
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(textarea, userMessage.body);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
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

    const userMessageGroup = Array.from(
      container.querySelectorAll<HTMLElement>(".issue-message-group"),
    ).find((group) => group.textContent?.includes(userMessage.body));
    expectPendingAgentReplyLoader(userMessageGroup);

    await act(async () => {
      rejectAgentReply(new Error("worker unavailable"));
      await pendingAgentReply.catch(() => undefined);
    });

    const errorState = userMessageGroup?.querySelector(
      ":scope > .issue-agent-reply-state.error",
    );
    expect(errorState?.textContent).toContain(
      "Agent 답변을 생성하지 못했습니다: worker unavailable",
    );
    expect(errorState?.querySelector("[data-testid='loading-state']")).toBeNull();
    expect(errorState?.querySelector(".spin")).toBeNull();
    expect(errorState?.querySelector("svg")).not.toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });



  it("sends the selected member id with an issue conversation mention", async () => {
    const createdAt = new Date().toISOString();
    let sentInput:
      | {
          body: string;
          parentMessageId: string | null;
          mentionedUserIds?: string[];
          mentionedAgentIds?: string[];
        }
      | undefined;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <RunPage
          isSidebarOpen
          error={null}
          isRecovering={false}
          mentionMembers={[
            {
              userId: "member-1",
              name: "Member One",
              email: "member@example.com",
              image: null,
              role: "member",
              createdAt,
            },
          ]}
          onBack={() => undefined}
          onCancel={async () => undefined}
          onLoadAttachment={async () => new Blob()}
          onLoadIssueMessages={async () => []}
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async (input) => {
            sentInput = input;
            return {
              message: {
                id: "member-mention",
                runId: demoDashboard.runs[0].id,
                parentMessageId: null,
                body: input.body,
                author: {
                  id: "owner",
                  name: "Owner",
                  image: null,
                  provider: null,
                },
                replyCount: 0,
                createdAt,
                updatedAt: createdAt,
              },
              agentReply: null,
            };
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
      )?.set?.call(textarea, "@mem");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const suggestion = container.querySelector<HTMLButtonElement>(
      '[role="option"]',
    );
    expect(suggestion?.textContent).toContain("@member");
    await act(async () => suggestion?.click());
    expect(textarea?.value).toBe("@member ");
    const composerMention = container.querySelector<HTMLButtonElement>(
      ".issue-composer-field .conversation-mention-button[data-mention-handle='member']",
    );
    expect(composerMention?.textContent).toBe("@member");
    await act(async () => composerMention?.click());
    expect(
      document.body.querySelector<HTMLElement>(".profile-dialog")?.textContent,
    ).toContain("Member One");

    await act(async () => {
      if (!textarea) return;
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(textarea, "@member 확인해 주세요");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
        }),
      );
      await Promise.resolve();
    });

    expect(sentInput).toEqual({
      body: "@member 확인해 주세요",
      clientMessageId: expect.any(String),
      parentMessageId: null,
      mentionedUserIds: ["member-1"],
      mentionedAgentIds: [],
    });
    await act(async () => root.unmount());
    container.remove();
  });





  it("clears the resume spinner when the run reaches another paused checkpoint", async () => {
    const onResume = vi.fn(async () => undefined);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const pausedRun: HuntRun = {
      ...demoDashboard.runs[1],
      status: "paused",
    };
    const renderRun = (run: HuntRun) => (
      <TooltipProvider>
        <RunPage
          isSidebarOpen
          error={null}
          isRecovering={false}
          onBack={() => undefined}
          onCancel={async () => undefined}
          onLoadAttachment={async () => new Blob()}
          onLoadIssueMessages={async () => []}
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onResume={onResume}
          onRetry={async () => undefined}
          onSendIssueMessage={async () => {
            throw new Error("not implemented in this test");
          }}
          run={run}
        />
      </TooltipProvider>
    );

    await act(async () => {
      root.render(renderRun(pausedRun));
    });

    const resumeButton = container.querySelector<HTMLButtonElement>(
      ".paused-result-resume",
    );
    expect(resumeButton?.disabled).toBe(false);
    expect(resumeButton?.querySelector(".spin")).toBeNull();

    await act(async () => {
      resumeButton?.click();
      await Promise.resolve();
    });

    expect(onResume).toHaveBeenCalledOnce();
    expect(resumeButton?.disabled).toBe(true);
    expect(resumeButton?.querySelector(".spin")).not.toBeNull();

    await act(async () => {
      root.render(renderRun({
        ...pausedRun,
        checkpoint: pausedRun.checkpoint
          ? {
              ...pausedRun.checkpoint,
              key: "project-after-pr_open",
              stage: "pr_open",
              stageLabel: "Pull request",
              terminalReviewOnly: false,
            }
          : null,
        workflowStage: "pr_open",
      }));
    });

    const nextCheckpointButton = container.querySelector<HTMLButtonElement>(
      ".paused-result-resume",
    );
    expect(nextCheckpointButton?.disabled).toBe(false);
    expect(nextCheckpointButton?.querySelector(".spin")).toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it("submits paused review feedback as an explicit rework request", async () => {
    const onRework = vi.fn(async () => undefined);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <TooltipProvider>
        <RunPage
          error={null}
          isRecovering={false}
          isSidebarOpen
          onBack={() => undefined}
          onCancel={async () => undefined}
          onLoadAttachment={async () => new Blob()}
          onLoadIssueMessages={async () => []}
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onRework={onRework}
          onSendIssueMessage={async () => {
            throw new Error("not implemented in this test");
          }}
          run={{ ...demoDashboard.runs[1], status: "paused" as const }}
        />
      </TooltipProvider>,
    ));

    const openButton = container.querySelector<HTMLButtonElement>(
      ".paused-result-rework",
    );
    expect(openButton?.textContent).toContain("수정 요청");
    await act(async () => openButton?.click());
    const textarea = container.querySelector<HTMLTextAreaElement>(
      ".paused-rework-form textarea",
    );
    expect(textarea).not.toBeNull();
    await act(async () => {
      if (!textarea) return;
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(textarea, "결과 요약을 더 짧게 만들고 모바일 화면도 다시 확인해 주세요.");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const form = container.querySelector<HTMLFormElement>(".paused-rework-form");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(onRework).toHaveBeenCalledWith({
      workflowStage: "local_qa",
      reason: "결과 요약을 더 짧게 만들고 모바일 화면도 다시 확인해 주세요.",
    });

    await act(async () => root.unmount());
    container.remove();
  });

  it("requires the user to accept a Project Agent rework proposal before revision", async () => {
    const proposalId = "abababab-abab-4bab-8bab-abababababab";
    const message: IssueMessage = {
      id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
      runId: demoDashboard.runs[1].id,
      parentMessageId: null,
      body: "D를 D′로 바꾸는 개정을 제안했습니다.",
      author: {
        id: null,
        name: "Briar · Codex",
        image: null,
        provider: "codex",
      },
      replyCount: 0,
      proposedAction: {
        id: proposalId,
        type: "request_issue_rework",
        workflowStage: "local_qa",
        reason: "D를 D′로 변경하고 영향받는 QA를 다시 확인합니다.",
        status: "pending",
        acceptedAt: null,
        appliedRevision: null,
      },
      createdAt: "2026-08-05T01:00:00.000Z",
      updatedAt: "2026-08-05T01:00:00.000Z",
    };
    const onAccept = vi.fn(async () => ({
      ...message.proposedAction!,
      status: "accepted" as const,
      acceptedAt: "2026-08-05T01:01:00.000Z",
      appliedRevision: 2,
    }));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <TooltipProvider>
        <RunPage
          error={null}
          isRecovering={false}
          isSidebarOpen
          onAcceptIssueAction={onAccept}
          onBack={() => undefined}
          onCancel={async () => undefined}
          onLoadAttachment={async () => new Blob()}
          onLoadIssueMessages={async () => [message]}
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async () => {
            throw new Error("not implemented in this test");
          }}
          run={{ ...demoDashboard.runs[1], status: "completed" as const }}
        />
      </TooltipProvider>,
    ));
    await act(async () => { await Promise.resolve(); });

    const acceptButton = container.querySelector<HTMLButtonElement>(
      ".issue-rework-proposal-accept",
    );
    expect(acceptButton?.textContent).toContain("수락하고 개정 시작");
    expect(onAccept).not.toHaveBeenCalled();
    await act(async () => {
      acceptButton?.click();
      await Promise.resolve();
    });
    expect(onAccept).toHaveBeenCalledWith(message.proposedAction);
    expect(container.textContent).toContain("리비전 2 개정이 시작되었습니다.");

    await act(async () => root.unmount());
    container.remove();
  });

  it("requires acceptance before a Project Agent-created issue is persisted", async () => {
    const createdRunId = "30303030-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const message: IssueMessage = {
      id: "10101010-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      runId: demoDashboard.runs[1].id,
      parentMessageId: null,
      body: "후속 QA 이슈 생성을 제안했습니다.",
      author: { id: null, name: "Briar · Codex", image: null, provider: "codex" },
      replyCount: 0,
      proposedAction: {
        id: "20202020-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        type: "request_issue_create",
        issue: {
          title: "후속 QA",
          description: "모바일 승인 흐름을 확인합니다.",
          priority: 2,
          // Older Agent replies can still carry queued. Approval semantics are
          // nevertheless backlog-only and must be presented that way.
          status: "queued",
        },
        status: "pending",
        acceptedAt: null,
        resultRunId: null,
      },
      createdAt: "2026-08-06T01:00:00.000Z",
      updatedAt: "2026-08-06T01:00:00.000Z",
    };
    const onAccept = vi.fn(async () => ({
      ...message.proposedAction!,
      status: "accepted" as const,
      acceptedAt: "2026-08-06T01:01:00.000Z",
      resultRunId: createdRunId,
    }));
    const onIssueOpen = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <TooltipProvider>
        <RunPage
          error={null}
          isRecovering={false}
          isSidebarOpen
          onAcceptIssueAction={onAccept}
          onBack={() => undefined}
          onCancel={async () => undefined}
          onDependencyOpen={onIssueOpen}
          onLoadAttachment={async () => new Blob()}
          onLoadIssueMessages={async () => [message]}
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async () => { throw new Error("not implemented"); }}
          run={demoDashboard.runs[1]}
        />
      </TooltipProvider>,
    ));
    await act(async () => { await Promise.resolve(); });

    const acceptButton = container.querySelector<HTMLButtonElement>(
      ".issue-rework-proposal-accept",
    );
    const proposalCard = container.querySelector<HTMLElement>(
      ".issue-rework-proposal",
    );
    expect(container.textContent).toContain("후속 QA");
    expect(proposalCard?.textContent).toContain("백로그에만 생성");
    expect(proposalCard?.textContent).toContain("별도 승인 필요");
    expect(proposalCard?.textContent).not.toContain("생성 상태: queued");
    expect(acceptButton?.textContent).toContain("수락하고 이슈 만들기");
    expect(acceptButton?.querySelector(".lucide-plus")).not.toBeNull();
    expect(onAccept).not.toHaveBeenCalled();
    await act(async () => {
      acceptButton?.click();
      await Promise.resolve();
    });
    expect(onAccept).toHaveBeenCalledWith(message.proposedAction);
    expect(container.textContent).toContain("새 이슈가 생성되었습니다.");
    const viewButton = container.querySelector<HTMLButtonElement>(
      ".issue-rework-proposal-view",
    );
    expect(viewButton?.textContent).toContain("이슈 보기");
    expect(onIssueOpen).not.toHaveBeenCalled();
    await act(async () => {
      viewButton?.click();
    });
    expect(onIssueOpen).toHaveBeenCalledWith(createdRunId);

    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps create evidence while approving its distinct follow-up run", async () => {
    const conversationRun = demoDashboard.runs[1];
    const targetRun = {
      ...demoDashboard.runs[0],
      id: "30303030-cccc-4ccc-8ccc-cccccccccccc",
      title: "후속 QA 실행",
      status: "backlog" as const,
      workflowStage: null,
      executionReadiness: "ready" as const,
      claimedBy: null,
      claimedAt: null,
      workerId: null,
      dispatchedAt: null,
      requestedByUserId: null,
      dispatchMode: null,
    };
    const executionProposal = {
      id: "40404040-cccc-4ccc-8ccc-cccccccccccc",
      type: "request_issue_execute" as const,
      status: "pending" as const,
      projectId: demoDashboard.project.id,
      runId: targetRun.id,
      title: targetRun.title,
      createdAt: "2026-08-11T00:00:00.000Z",
      acceptedAt: null,
      requestedProvider: null,
      requestedModel: null,
      requestedEffort: null,
      requestedWorkerId: null,
      delegatedByAgentId: null,
      delegatedByAgentName: null,
    };
    const message: IssueMessage = {
      id: "10101010-cccc-4ccc-8ccc-cccccccccccc",
      runId: conversationRun.id,
      parentMessageId: null,
      body: "후속 QA 이슈 생성과 실행을 제안합니다.",
      author: { id: null, name: "Briar · Codex", image: null, provider: "codex" },
      replyCount: 0,
      proposedAction: {
        id: "20202020-cccc-4ccc-8ccc-cccccccccccc",
        type: "request_issue_create",
        issue: {
          title: targetRun.title,
          description: "생성과 실행 경계를 분리합니다.",
          priority: 2,
          status: "backlog",
        },
        executeAfterCreate: true,
        status: "pending",
        acceptedAt: null,
        resultRunId: null,
      },
      executionProposal: null,
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:01:00.000Z",
    };
    const acceptedCreate = {
      ...message.proposedAction!,
      status: "accepted" as const,
      acceptedAt: "2026-08-11T00:01:00.000Z",
      resultRunId: targetRun.id,
    };
    const materializedMessage: IssueMessage = {
      ...message,
      proposedAction: acceptedCreate,
      executionProposal,
    };
    const onLoadMessages = vi.fn()
      .mockResolvedValueOnce([message])
      .mockResolvedValue([materializedMessage]);
    const onAcceptCreate = vi.fn(async () => acceptedCreate);
    const onAcceptExecution = vi.fn(async (_proposal, input) => ({
      ...executionProposal,
      status: "accepted" as const,
      acceptedAt: "2026-08-11T00:02:00.000Z",
      requestedProvider: input.provider,
      requestedModel: input.model,
      requestedEffort: input.effort,
      requestedWorkerId: input.workerId,
    }));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <TooltipProvider>
        <RunPage
          availableRuns={[conversationRun, targetRun]}
          error={null}
          executionWorkers={[{
            ...dashboardWorker,
            readiness: "available",
            activeSessions: 0,
            availableSessions: 1,
          }]}
          isRecovering={false}
          isSidebarOpen
          onAcceptIssueAction={onAcceptCreate}
          onAcceptIssueExecution={onAcceptExecution}
          onBack={() => undefined}
          onCancel={async () => undefined}
          onLoadAttachment={async () => new Blob()}
          onLoadIssueMessages={onLoadMessages}
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async () => { throw new Error("not implemented"); }}
          run={conversationRun}
        />
      </TooltipProvider>,
    ));
    await act(async () => { await Promise.resolve(); });

    expect(container.textContent).not.toContain("새 이슈가 생성되었습니다");
    expect(container.textContent).not.toContain("이슈 실행 제안");
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".issue-rework-proposal-accept",
      )?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onAcceptCreate).toHaveBeenCalledWith(message.proposedAction);
    expect(onLoadMessages).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("새 이슈가 생성되었습니다");
    expect(container.textContent).toContain("이슈 실행 제안");
    expect(onAcceptExecution).not.toHaveBeenCalled();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".execution-proposal-approve",
      )?.click();
    });
    expect(document.body.textContent).toContain("후속 QA 실행");
    expect(document.body.textContent).toContain("이슈 실행 승인");
    const finalApprove = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("승인하고 실행"));
    await act(async () => finalApprove?.click());

    expect(onAcceptExecution).toHaveBeenCalledWith(
      executionProposal,
      {
        provider: "codex",
        model: targetRun.preferredModel,
        effort: targetRun.preferredEffort,
        workerId: null,
      },
    );
    expect(container.textContent).toContain("새 이슈가 생성되었습니다");
    expect(container.textContent).toContain("실행이 명시적으로 승인");

    await act(async () => root.unmount());
    container.remove();
  });





  it("prioritizes verified deployment evidence for completed-issue manual QA", async () => {
    const completedRun: HuntRun = {
      ...demoDashboard.runs[0],
      status: "completed",
      currentRevision: 2,
      resultSummary: "검증된 배포 대상에서 완료 결과를 확인합니다.",
      workflow: {
        ...demoDashboard.runs[0].workflow,
        stages: [
          ...demoDashboard.runs[0].workflow.stages,
          {
            id: "production_qa",
            label: "Production QA",
            required: true,
            evidence: ["production target"],
          },
        ],
      },
    };
    const evidence = (overrides: Partial<RunEvidence>): RunEvidence => ({
      key: "deployment-evidence",
      attempt: 1,
      revision: 2,
      stage: "production_qa",
      type: "production target",
      status: "passed",
      detail: "배포 후 화면을 확인했습니다.",
      command: null,
      url: "https://qa.example.com/result/2",
      metadata: { environment: "Production EU" },
      actor: "briar-workflow",
      observedAt: "2026-08-18T01:00:00.000Z",
      recordedAt: "2026-08-18T01:00:00.000Z",
      requiredRevision: 2,
      canonical: true,
      ...overrides,
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <TooltipProvider>
          <RunPage
            error={null}
            isRecovering={false}
            isSidebarOpen
            onBack={() => undefined}
            onCancel={async () => undefined}
            onLoadAttachment={async () => new Blob()}
            onLoadIssueMessages={async () => []}
            onLoadRunEvidence={async () => [
              evidence({}),
              evidence({
                key: "ci-url",
                stage: "ci_qa",
                type: "ci run",
                url: "https://ci.example.com/run/2",
                metadata: { environment: "CI" },
              }),
              evidence({
                key: "release-pr-url",
                stage: "pr_open",
                type: "release pull request",
                url: "https://github.com/example/repo/pull/2",
                metadata: { environment: "Release review" },
              }),
              evidence({
                key: "stale-deployment",
                canonical: false,
                url: "https://stale.example.com/result/1",
              }),
              evidence({
                key: "pending-deployment",
                status: "pending",
                url: "https://pending.example.com/result/2",
              }),
              evidence({
                key: "unsafe-deployment",
                url: "javascript:alert(1)",
              }),
            ]}
            onMove={async () => undefined}
            onRetry={async () => undefined}
            onSendIssueMessage={async () => {
              throw new Error("not implemented in this test");
            }}
            run={completedRun}
          />
        </TooltipProvider>,
      );
      await Promise.resolve();
    });

    const guide = container.querySelector(".run-manual-qa");
    expect(guide?.textContent).toContain("검증된 배포 대상");
    expect(guide?.textContent).toContain("Production EU");
    expect(guide?.textContent).toContain("대상 리비전 2");
    expect(
      guide?.querySelector<HTMLAnchorElement>("a")?.getAttribute("href"),
    ).toBe("https://qa.example.com/result/2");
    expect(guide?.textContent).toContain("‘대화’ 탭에서 @briar");
    expect(guide?.textContent).not.toContain("배포되지 않은 상태");
    expect(guide?.innerHTML).not.toContain("ci.example.com");
    expect(guide?.innerHTML).not.toContain("github.com");
    expect(guide?.innerHTML).not.toContain("stale.example.com");
    expect(guide?.innerHTML).not.toContain("pending.example.com");
    expect(guide?.innerHTML).not.toContain("javascript:");

    await act(async () => root.unmount());
    container.remove();
  });





  it("shows result reviewers in the result and properties panels and records the current member", async () => {
    const onCompleteResultReview = vi.fn(async () => undefined);
    const completedRun = {
      ...demoDashboard.runs[0],
      status: "completed" as const,
      resultSummary: "검수할 작업 결과입니다.",
      resultReviews: [
        {
          userId: "reviewer-1",
          name: "민지 김",
          username: "minji",
          image: "https://example.com/minji.png",
          completedAt: "2026-08-02T01:00:00.000Z",
        },
      ],
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <TooltipProvider>
        <RunPage
          currentUserId="reviewer-2"
          error={null}
          isRecovering={false}
          isSidebarOpen
          onBack={() => undefined}
          onCancel={async () => undefined}
          onCompleteResultReview={onCompleteResultReview}
          onLoadAttachment={async () => new Blob()}
          onLoadIssueMessages={async () => []}
          onLoadRunEvidence={async () => []}
          onMove={async () => undefined}
          onRetry={async () => undefined}
          onSendIssueMessage={async () => {
            throw new Error("not implemented in this test");
          }}
          run={completedRun}
        />
      </TooltipProvider>,
    ));

    expect(container.querySelector(".run-result-review")?.textContent).toContain(
      "@minji",
    );
    expect(
      container.querySelector(".completed-issue-card-heading .status-pill.reviewed"),
    ).not.toBeNull();
    expect(
      container.querySelector(
        ".completed-issue-card-heading .status-pill-review-icon",
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(".run-page-property-select.reviewed"),
    ).not.toBeNull();
    const reviewButton = container.querySelector<HTMLButtonElement>(
      ".run-result-review-complete",
    );
    expect(reviewButton?.textContent).toContain("검수 완료");
    await act(async () => reviewButton?.click());
    expect(onCompleteResultReview).toHaveBeenCalledOnce();

    await act(async () =>
      container.querySelector<HTMLButtonElement>(
        ".run-page-properties-toggle",
      )?.click()
    );
    const reviewProperty = container.querySelector(
      ".run-result-review-property",
    );
    expect(reviewProperty?.getAttribute("aria-label")).toContain("@minji");
    expect(reviewProperty?.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/minji.png",
    );

    await act(async () => root.unmount());
    container.remove();
  });

});
