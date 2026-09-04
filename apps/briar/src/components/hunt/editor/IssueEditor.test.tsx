/** @vitest-environment jsdom */

import { act } from "react";
import { createReactTestRoot, renderReactTestRoot } from "../../../test/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AutoHuntSession } from "@/types";
import { demoDashboard, demoRunEvents } from "@/lib/demo-data";
import * as api from "@/lib/api";
import * as channelRealtime from "@/lib/channel-realtime";
import * as issueActivityHook from "@/hooks/use-issue-agent-activity";
import {
  AppKeyboardCommandProvider,
  useAppKeyboardCommandScope,
  useAppKeyboardCommandState,
} from "@/hooks/appKeyboardCommands";
import type { CreateIssueInput, ExecutionWorker, HuntRun, IssueMessage, IssueMessageSendResult, ProjectAgent, RunEvidence, UpdateIssueInput } from "@/types";
import { createIssueDraftStorageKey, saveCreateIssueDraft } from "@/lib/create-issue-draft";
import { HuntDashboard } from "@/components/hunt/HuntDashboard";
import { IssueAgentActivityPanel } from "@/components/hunt/detail/IssueAgentActivityPanel";
import { RunPage } from "@/components/hunt/detail/RunPage";
import { CreateIssueDialog } from "@/components/hunt/editor/CreateIssueDialog";
import { EditIssueDialog } from "@/components/hunt/editor/EditIssueDialog";
import { runMatchesIssuePropertyFilters, type IssuePropertyFilters } from "@/state/board/filters";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
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
  }
};
const dashboardAgent: ProjectAgent = {
  id: "agent-1",
  teamId: demoDashboard.team.id,
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
  updatedAt: "2026-07-29T00:00:00.000Z"
};
const issueMentionAgent: ProjectAgent = {
  ...dashboardAgent,
  id: "agent-mention-1",
  name: "Developer"
};
const dashboardWorker: ExecutionWorker = {
  id: "worker-1",
  deviceId: "device-1",
  ownerUserId: "user-1",
  label: "Lemon Worker",
  icon: {
    type: "emoji",
    value: "🍋"
  },
  agentProvider: "codex",
  providers: ["codex"],
  versions: {
    briar: "1.2.25"
  },
  state: "online",
  readiness: "busy",
  acceptingWork: true,
  readinessDetail: null,
  capabilities: {},
  maxConcurrentSessions: 1,
  activeSessions: 1,
  availableSessions: 0,
  lastHeartbeatAt: "2026-07-29T00:00:00.000Z",
  createdAt: "2026-07-29T00:00:00.000Z"
};
function dashboardAgentSession(run: HuntRun, status: AutoHuntSession["status"] = "running"): AutoHuntSession {
  return {
    id: "session-1",
    dispatchGroupId: "dispatch-1",
    projectId: demoDashboard.team.id,
    agentId: dashboardAgent.id,
    sessionType: "dispatch",
    status,
    issues: [{
      runId: run.id,
      runNumber: run.runNumber,
      sourceKey: run.sourceKey,
      title: run.title,
      outcome: status === "running" ? "pending" : "completed",
      summary: null
    }],
    startedAt: "2026-07-29T00:00:00.000Z",
    updatedAt: status === "running" ? "2026-07-29T00:00:00.000Z" : "2026-07-29T00:10:00.000Z",
    completedAt: status === "running" ? null : "2026-07-29T00:10:00.000Z",
    conversationId: null,
    workspaceRoot: null,
    summary: null,
    error: null,
    events: [],
    dispatchEvents: [],
    workers: []
  };
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
function pendingAgentReplyState(scope: ParentNode | null | undefined) {
  return scope?.querySelector<HTMLElement>(":scope > .issue-agent-reply-state");
}
function expectPendingAgentReplyLoader(scope: ParentNode | null | undefined) {
  const pending = pendingAgentReplyState(scope);
  const loader = pending?.querySelector<HTMLElement>("[data-testid='loading-state']");
  expect(loader).not.toBeNull();
  expect(loader?.dataset.variant).toBe("Drive");
  expect(loader?.dataset.size).toBe("compact");
  expect(pending?.textContent).toContain("에이전트가 답변을 작성하고 있습니다");
  expect(pending?.textContent).toContain("0.0s");
  expect(pending?.querySelector(".spin")).toBeNull();
  return pending;
}
describe("IssueEditor", () => {
  it("debounces inline title and description changes and reports the save state", async () => {
    vi.useFakeTimers();
    const onUpdateIssue = vi.fn(async () => undefined);
    const run = {
      ...demoDashboard.runs[0],
      workerId: null
    };
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    try {
      await renderReactTestRoot(
        root,
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
      );
      const title = container.querySelector<HTMLInputElement>(".run-page-inline-title");
      const description = container.querySelector<HTMLTextAreaElement>(".issue-description-inline-editor .issue-description-input");
      expect(title?.value).toBe(run.title);
      expect(description?.value).toBe(run.issueDescription ?? "");
      expect(container.querySelector(".run-page-save-status")?.getAttribute("aria-label")).toBe("저장됨");
      expect(container.querySelector(".run-page-save-status")?.classList.contains("saved")).toBe(true);
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(title, " 인라인 제목 ");
        title?.dispatchEvent(new Event("input", {
          bubbles: true
        }));
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(description, " 인라인 본문 ");
        description?.dispatchEvent(new Event("input", {
          bubbles: true
        }));
      });
      expect(container.querySelector(".run-page-save-status")?.textContent).toContain("저장 중");
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
        difficulty: run.difficulty,
        attachments: []
      });
      expect(container.querySelector(".run-page-save-status")?.getAttribute("aria-label")).toBe("저장됨");
      expect(container.querySelector(".run-page-save-status")?.classList.contains("saved")).toBe(true);
    } finally {
      await cleanup();
      vi.useRealTimers();
    }
  });
  it("leaves inline editing on Escape before entering go-to mode", async () => {
    vi.useFakeTimers();
    const onGoInbox = vi.fn();
    const onUpdateIssue = vi.fn(async () => undefined);
    const run = {
      ...demoDashboard.runs[0],
      workerId: null
    };
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    const dispatchKey = (target: HTMLElement, init: KeyboardEventInit) => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init
      });
      target.dispatchEvent(event);
      return event;
    };
    function Harness() {
      const keyboardState = useAppKeyboardCommandState();
      useAppKeyboardCommandScope({
        fallthrough: true,
        handlers: {
          goInbox: {
            run: () => {
              onGoInbox();
              return "handled";
            }
          }
        },
        id: "issue-editor-keyboard-regression",
        priority: 0
      });
      return <>
        <output data-testid="shortcut-mode">
          {`${keyboardState.mode}:${keyboardState.pending?.sequence.join("+") ?? "idle"}`}
        </output>
        <RunPage isSidebarOpen error={null} isRecovering={false} onBack={() => undefined} onCancel={async () => undefined} onLoadAttachment={async () => new Blob()} onLoadIssueMessages={async () => []} onLoadRunEvidence={async () => []} onMove={async () => undefined} onRetry={async () => undefined} onSendIssueMessage={async () => {
          throw new Error("not implemented in this test");
        }} onUpdateIssue={onUpdateIssue} run={run} />
      </>;
    }
    try {
      await renderReactTestRoot(
        root,
        <AppKeyboardCommandProvider>
          <Harness />
        </AppKeyboardCommandProvider>,
      );
      const mode = container.querySelector('[data-testid="shortcut-mode"]');
      const title = container.querySelector<HTMLInputElement>(
        ".run-page-inline-title"
      )!;
      const description = container.querySelector<HTMLTextAreaElement>(
        ".issue-description-inline-editor .issue-description-input"
      )!;

      await act(async () => {
        title.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
          ?.set?.call(title, "Escape saves this title");
        title.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(mode?.textContent).toBe("insert:idle");
      expect(dispatchKey(title, { code: "KeyG", key: "g" }).defaultPrevented)
        .toBe(false);
      expect(mode?.textContent).toBe("insert:idle");

      let escape!: KeyboardEvent;
      await act(async () => {
        escape = dispatchKey(title, { code: "Escape", key: "Escape" });
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(escape.defaultPrevented).toBe(true);
      expect(document.activeElement).not.toBe(title);
      expect(mode?.textContent).toBe("normal:idle");
      expect(onUpdateIssue).toHaveBeenCalledWith(expect.objectContaining({
        title: "Escape saves this title"
      }));

      await act(async () => {
        dispatchKey(document.body, { code: "KeyG", key: "g" });
      });
      expect(mode?.textContent).toBe("normal:KeyG");
      await act(async () => {
        dispatchKey(document.body, { code: "KeyI", key: "i" });
      });
      expect(onGoInbox).toHaveBeenCalledTimes(1);
      expect(mode?.textContent).toBe("normal:idle");

      await act(async () => {
        description.focus();
      });
      expect(mode?.textContent).toBe("insert:idle");
      expect(
        dispatchKey(description, { code: "KeyG", key: "g" })
          .defaultPrevented
      ).toBe(false);
      expect(mode?.textContent).toBe("insert:idle");
      await act(async () => {
        escape = dispatchKey(description, {
          code: "Escape",
          key: "Escape"
        });
      });
      expect(escape.defaultPrevented).toBe(true);
      expect(document.activeElement).not.toBe(description);
      expect(mode?.textContent).toBe("normal:idle");

      await act(async () => {
        dispatchKey(document.body, { code: "KeyG", key: "g" });
        dispatchKey(document.body, { code: "KeyI", key: "i" });
      });
      expect(onGoInbox).toHaveBeenCalledTimes(2);
      expect(mode?.textContent).toBe("normal:idle");
    } finally {
      await cleanup();
      vi.useRealTimers();
    }
  });
  it("keeps referenced images inline while the issue body remains editable", async () => {
    vi.useFakeTimers();
    const createObjectUrl = vi.fn((blob: Blob) => `blob:issue-inline-editor-${blob.size}`);
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl,
      writable: true
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrl,
      writable: true
    });
    const inlineAttachment = {
      id: "attachment-inline",
      filename: "inline.png",
      contentType: "image/png",
      byteSize: 6,
      url: "/attachments/attachment-inline"
    };
    const galleryAttachment = {
      id: "attachment-gallery",
      filename: "gallery.png",
      contentType: "image/png",
      byteSize: 7,
      url: "/attachments/attachment-gallery"
    };
    const run = {
      ...demoDashboard.runs[0],
      issueDescription: "before\n\n![inline](briar-attachment://attachment-inline)\n\nafter",
      attachments: [inlineAttachment, galleryAttachment],
      workerId: null
    };
    const onUpdateIssue = vi.fn(async () => undefined);
    const onLoadAttachment = vi.fn(async (attachment: typeof inlineAttachment) => new Blob([attachment.filename], {
      type: attachment.contentType
    }));
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    try {
      await renderReactTestRoot(
        root,
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
      );
      const editor = container.querySelector(".issue-description-inline-editor");
      expect(editor?.tagName).toBe("DIV");
      expect(Array.from(editor?.querySelectorAll<HTMLTextAreaElement>(".issue-description-input") ?? []).map(textarea => textarea.value)).toEqual(["before\n\n", "\n\nafter"]);
      expect(editor?.querySelector<HTMLImageElement>('.issue-inline-attachment img[alt="inline.png"]')).not.toBeNull();
      expect(container.querySelector(".run-attachments")?.textContent).toContain("gallery.png");
      expect(container.querySelector(".run-attachments")?.textContent).not.toContain("inline.png");
      await act(async () => {
        editor?.querySelector<HTMLButtonElement>(".issue-inline-attachment button")?.click();
      });
      expect(container.querySelector(".issue-inline-attachment")).toBeNull();
      expect(container.querySelector(".run-attachments")?.textContent).not.toContain("inline.png");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      expect(onUpdateIssue).toHaveBeenCalledWith({
        title: run.title,
        description: "before\n\nafter",
        priority: run.priority,
        difficulty: run.difficulty,
        attachments: [],
        keptAttachmentIds: ["attachment-gallery"]
      });
    } finally {
      await cleanup();
      vi.useRealTimers();
    }
  });
  it("serializes inline saves when the draft changes during a request", async () => {
    vi.useFakeTimers();
    let resolveFirstSave: () => void = () => undefined;
    const firstSave = new Promise<void>(resolve => {
      resolveFirstSave = resolve;
    });
    const onUpdateIssue = vi.fn<(_input: UpdateIssueInput) => Promise<void>>().mockReturnValueOnce(firstSave).mockResolvedValue(undefined);
    const run = {
      ...demoDashboard.runs[0],
      workerId: null
    };
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    try {
      await renderReactTestRoot(
        root,
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
      );
      const title = container.querySelector<HTMLInputElement>(".run-page-inline-title");
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(title, "먼저 저장할 제목");
        title?.dispatchEvent(new Event("input", {
          bubbles: true
        }));
        await vi.advanceTimersByTimeAsync(600);
      });
      expect(onUpdateIssue).toHaveBeenCalledTimes(1);
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(title, run.title);
        title?.dispatchEvent(new Event("input", {
          bubbles: true
        }));
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
        difficulty: run.difficulty,
        attachments: []
      });
      expect(container.querySelector(".run-page-save-status")?.getAttribute("aria-label")).toBe("저장됨");
      expect(container.querySelector(".run-page-save-status")?.classList.contains("saved")).toBe(true);
    } finally {
      await cleanup();
      vi.useRealTimers();
    }
  });
  it("edits an issue title, description, and priority", async () => {
    let updated: UpdateIssueInput | undefined;
    const { cleanup, container, root } = createReactTestRoot();
    await renderReactTestRoot(
      root,
      <EditIssueDialog
        isSubmitting={false}
        members={[{
          userId: "user-1",
          name: "Kim",
          email: "kim@example.com",
          image: null,
          role: "developer",
          createdAt: "2026-07-01T00:00:00.000Z",
        }]}
        onClose={() => undefined}
        onUpdate={async input => {
          updated = input;
        }}
        run={{
          ...demoDashboard.runs[0],
          priority: 3,
        }}
      />,
    );
    const title = container.querySelector<HTMLInputElement>(".issue-title-input");
    const description = container.querySelector<HTMLTextAreaElement>(".issue-description-input");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(title, "수정된 이슈");
      title?.dispatchEvent(new Event("input", {
        bubbles: true
      }));
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(description, "수정된 설명");
      description?.dispatchEvent(new Event("input", {
        bubbles: true
      }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".issue-assignee-select .select-menu-trigger")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[role="option"][data-value="user-1"]')?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".issue-difficulty-select .select-menu-trigger")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[role="option"][data-value="hard"]')?.click();
    });
    await act(async () => {
      container.querySelector("form")?.dispatchEvent(new Event("submit", {
        bubbles: true,
        cancelable: true
      }));
      await Promise.resolve();
    });
    expect(updated).toEqual({
      title: "수정된 이슈",
      description: "수정된 설명",
      priority: 3,
      difficulty: "hard",
      assigneeUserId: "user-1",
      attachments: [],
      keptAttachmentIds: []
    });
    await cleanup();
  });
  it("pastes an image into the edit description and submits it with kept attachments", async () => {
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
    let updated: UpdateIssueInput | undefined;
    const run: HuntRun = {
      ...demoDashboard.runs[0],
      issueDescription: "before after",
      attachments: [{
        id: "existing-1",
        filename: "screen.png",
        contentType: "image/png",
        byteSize: 100,
        url: "/projects/project/runs/run/attachments/existing-1"
      }]
    };
    const { cleanup, container, root } = createReactTestRoot();
    await renderReactTestRoot(
      root,
      <EditIssueDialog
        isSubmitting={false}
        members={[]}
        onClose={() => undefined}
        onLoadAttachment={async () => new Blob()}
        onUpdate={async input => {
          updated = input;
        }}
        run={run}
      />,
    );
    const textarea = container.querySelector<HTMLTextAreaElement>(".issue-description-input");
    await act(async () => {
      textarea?.focus();
      textarea?.setSelectionRange(6, 6);
    });
    const image = new File(["image"], "inline.png", {
      type: "image/png"
    });
    const pasteEvent = new Event("paste", {
      bubbles: true,
      cancelable: true
    });
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: {
        files: [],
        items: [{
          getAsFile: () => image,
          kind: "file",
          type: "image/png"
        }]
      }
    });
    await act(async () => {
      container.querySelector("form")?.dispatchEvent(pasteEvent);
    });
    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(container.querySelectorAll<HTMLImageElement>(".issue-inline-attachment img")).toHaveLength(1);
    await act(async () => {
      container.querySelector<HTMLFormElement>("form")?.requestSubmit();
    });
    expect(updated).toBeDefined();
    expect(updated!.attachments).toEqual([image]);
    expect(updated!.attachmentReferences).toHaveLength(1);
    expect(updated!.keptAttachmentIds).toEqual(["existing-1"]);
    expect(updated!.description).toContain(`briar-attachment://${updated!.attachmentReferences?.[0]}`);
    await cleanup();
  });
  it("removes an existing inline image while editing", async () => {
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
    let updated: UpdateIssueInput | undefined;
    const run: HuntRun = {
      ...demoDashboard.runs[0],
      issueDescription: "before\n\n![screen.png](briar-attachment://existing-1)\n\nafter",
      attachments: [{
        id: "existing-1",
        filename: "screen.png",
        contentType: "image/png",
        byteSize: 100,
        url: "/projects/project/runs/run/attachments/existing-1"
      }]
    };
    const { cleanup, container, root } = createReactTestRoot();
    await renderReactTestRoot(
      root,
      <EditIssueDialog
        isSubmitting={false}
        members={[]}
        onClose={() => undefined}
        onLoadAttachment={async () => new Blob()}
        onUpdate={async input => {
          updated = input;
        }}
        run={run}
      />,
    );
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".issue-inline-attachment button")?.click();
    });
    expect(Array.from(container.querySelectorAll<HTMLTextAreaElement>("textarea")).map(textarea => textarea.value).join("")).toBe("before\n\nafter");
    await act(async () => {
      container.querySelector<HTMLFormElement>("form")?.requestSubmit();
    });
    expect(updated!.description).not.toContain("briar-attachment://");
    expect(updated!.keptAttachmentIds).toEqual([]);
    await cleanup();
  });
  it("defaults assignee to current user (creator) when creating a new issue", async () => {
    window.localStorage.removeItem(createIssueDraftStorageKey);
    let createdInput: CreateIssueInput | undefined;
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <CreateIssueDialog
        currentUserId="user-1"
        isSubmitting={false}
        members={[{
          userId: "user-1",
          name: "Creator User",
          email: "creator@example.com",
          image: null,
          role: "developer",
          createdAt: "2026-07-01T00:00:00.000Z",
        }, {
          userId: "user-2",
          name: "Other User",
          email: "other@example.com",
          image: null,
          role: "developer",
          createdAt: "2026-07-01T00:00:00.000Z",
        }]}
        onClose={() => undefined}
        onCreate={async (_projectId, input) => {
          createdInput = input;
        }}
        projects={[demoDashboard.team]}
      />,
    );
    const titleInput = container.querySelector<HTMLInputElement>(".issue-title-input");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(titleInput, "새 이슈");
      titleInput?.dispatchEvent(new Event("input", { bubbles: true }));
      container.querySelector<HTMLFormElement>(".issue-dialog")?.requestSubmit();
    });
    expect(createdInput).toBeDefined();
    expect(createdInput?.assigneeUserId).toBe("user-1");
    window.localStorage.removeItem(createIssueDraftStorageKey);
    await cleanup();
  });
  it("allows unassigning the issue before submitting", async () => {
    window.localStorage.removeItem(createIssueDraftStorageKey);
    let createdInput: CreateIssueInput | undefined;
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <CreateIssueDialog
        currentUserId="user-1"
        isSubmitting={false}
        members={[{
          userId: "user-1",
          name: "Creator User",
          email: "creator@example.com",
          image: null,
          role: "developer",
          createdAt: "2026-07-01T00:00:00.000Z",
        }]}
        onClose={() => undefined}
        onCreate={async (_projectId, input) => {
          createdInput = input;
        }}
        projects={[demoDashboard.team]}
      />,
    );
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".issue-assignee-select .select-menu-trigger")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[role="option"][data-value=""]')?.click();
    });
    const titleInput = container.querySelector<HTMLInputElement>(".issue-title-input");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(titleInput, "미배정 이슈");
      titleInput?.dispatchEvent(new Event("input", { bubbles: true }));
      container.querySelector<HTMLFormElement>(".issue-dialog")?.requestSubmit();
    });
    expect(createdInput).toBeDefined();
    expect(createdInput?.assigneeUserId).toBeNull();
    window.localStorage.removeItem(createIssueDraftStorageKey);
    await cleanup();
  });
  it("respects assignee from a saved draft", async () => {
    saveCreateIssueDraft({
      title: "임시 저장 이슈",
      description: "",
      status: "queued",
      priority: "2",
      projectId: demoDashboard.team.id,
      assigneeUserId: "user-2",
    });
    let createdInput: CreateIssueInput | undefined;
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <CreateIssueDialog
        currentUserId="user-1"
        isSubmitting={false}
        members={[{
          userId: "user-1",
          name: "Creator User",
          email: "creator@example.com",
          image: null,
          role: "developer",
          createdAt: "2026-07-01T00:00:00.000Z",
        }, {
          userId: "user-2",
          name: "Other User",
          email: "other@example.com",
          image: null,
          role: "developer",
          createdAt: "2026-07-01T00:00:00.000Z",
        }]}
        onClose={() => undefined}
        onCreate={async (_projectId, input) => {
          createdInput = input;
        }}
        projects={[demoDashboard.team]}
      />,
    );
    const titleInput = container.querySelector<HTMLInputElement>(".issue-title-input");
    await act(async () => {
      container.querySelector<HTMLFormElement>(".issue-dialog")?.requestSubmit();
    });
    expect(createdInput).toBeDefined();
    expect(createdInput?.assigneeUserId).toBe("user-2");
    window.localStorage.removeItem(createIssueDraftStorageKey);
    await cleanup();
  });
});
