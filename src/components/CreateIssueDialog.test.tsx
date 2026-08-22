/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultAgentProviderModelCatalog,
  loadAgentProviderModels,
} from "../lib/project-llm";
import { CreateIssueDialog } from "./HuntDashboard";
import type { CreateIssueInput } from "../types";
import { createIssueDraftStorageKey } from "../lib/create-issue-draft";
import { demoDashboard } from "../lib/demo-data";
import { writeAgentProviderModelPreference } from "../lib/agent-model-preferences";

vi.mock("../lib/project-llm", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/project-llm")>();
  return {
    ...original,
    loadAgentProviderModels: vi.fn(async () =>
      original.defaultAgentProviderModelCatalog
    ),
  };
});

const projects = [
  {
    id: "project-1",
    name: "GG",
    organizationId: "organization-1",
    createdAt: "2026-07-01T00:00:00.000Z",
  },
  {
    id: "project-2",
    name: "Mobile",
    organizationId: "organization-1",
    createdAt: "2026-07-02T00:00:00.000Z",
  },
];
const projectProps = { defaultProjectId: "project-1", projects };

describe("CreateIssueDialog attachments", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    window.localStorage.clear();
    URL.createObjectURL = vi.fn(() => "blob:clipboard-preview");
    URL.revokeObjectURL = vi.fn();
    vi.mocked(loadAgentProviderModels).mockReset();
    vi.mocked(loadAgentProviderModels).mockResolvedValue({
      ...defaultAgentProviderModelCatalog,
      claude: {
        models: [{
          id: "sonnet",
          label: "Claude Sonnet",
          efforts: [{ id: "xhigh", label: "xhigh" }],
        }],
        defaultEfforts: [],
        allowCustomModels: true,
        error: null,
      },
    });
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });


  it("inserts a pasted image at the description caret and submits its reference", async () => {
    const onCreate = vi.fn<(
      projectId: string,
      input: CreateIssueInput,
    ) => Promise<void>>(
      async () => undefined,
    );
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <CreateIssueDialog
          {...projectProps}
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
          onCreate={onCreate}
        />,
      );
    });

    const title = container.querySelector<HTMLInputElement>(".issue-title-input");
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    await act(async () => {
      const titleSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      const textareaSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      titleSetter?.call(title, "Inline screenshot");
      title?.dispatchEvent(new Event("input", { bubbles: true }));
      textareaSetter?.call(textarea, "before after");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
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
    await act(async () => textarea?.dispatchEvent(pasteEvent));

    expect(
      Array.from(container.querySelectorAll<HTMLTextAreaElement>("textarea"))
        .map((segment) => segment.value)
        .join(""),
    ).toBe("before\n\n\n\n after");
    expect(
      container.querySelector<HTMLImageElement>(".issue-inline-attachment img")?.src,
    ).toBe("blob:clipboard-preview");
    expect(
      Array.from(container.querySelectorAll<HTMLTextAreaElement>("textarea"))
        .map((segment) => segment.value)
        .join(""),
    ).not.toContain(
      "briar-attachment://",
    );
    await act(async () => {
      container.querySelector<HTMLFormElement>("form")?.requestSubmit();
    });
    const [submittedProjectId, submitted] = onCreate.mock.calls[0]!;
    expect(submittedProjectId).toBe("project-1");
    expect(submitted.attachments).toEqual([image]);
    expect(submitted.attachmentReferences).toHaveLength(1);
    expect(submitted.description).toContain(
      `briar-attachment://${submitted.attachmentReferences?.[0]}`,
    );

    await act(async () => root.unmount());
  });


  it("adds a dropped image and shows drag feedback", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <CreateIssueDialog
          {...projectProps}
          isSubmitting={false}
          onClose={() => undefined}
          onCreate={async () => undefined}
        />,
      );
    });

    const image = new File(["dropped image"], "dropped.png", {
      type: "image/png",
    });
    const dataTransfer = {
      dropEffect: "none",
      files: [image],
      types: ["Files"],
    };
    const dragEnterEvent = new Event("dragenter", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(dragEnterEvent, "dataTransfer", {
      value: dataTransfer,
    });

    await act(async () => {
      container.querySelector("form")?.dispatchEvent(dragEnterEvent);
    });

    expect(dragEnterEvent.defaultPrevented).toBe(true);
    expect(container.querySelector(".issue-attachment-drop-overlay")).not.toBeNull();

    const dropEvent = new Event("drop", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(dropEvent, "dataTransfer", {
      value: dataTransfer,
    });
    await act(async () => {
      container.querySelector("form")?.dispatchEvent(dropEvent);
    });

    expect(dropEvent.defaultPrevented).toBe(true);
    expect(container.querySelector(".issue-attachment-drop-overlay")).toBeNull();
    expect(
      container.querySelector<HTMLImageElement>(
        ".issue-inline-attachment img",
      )?.alt,
    ).toBe("dropped.png");
    expect(
      container.querySelector<HTMLImageElement>(
        ".issue-inline-attachment img",
      )?.src,
    ).toBe("blob:clipboard-preview");

    await act(async () => root.unmount());
  });


  it("submits with Command+Enter when the title is present", async () => {
    const onCreate = vi.fn(async () => undefined);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <CreateIssueDialog
          {...projectProps}
          isSubmitting={false}
          onClose={() => undefined}
          onCreate={onCreate}
        />,
      );
    });

    const titleInput =
      container.querySelector<HTMLInputElement>(".issue-title-input");
    expect(titleInput).not.toBeNull();

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(titleInput, "Keyboard-created issue");
      titleInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      container.querySelector("textarea")?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Enter",
          metaKey: true,
        }),
      );
    });

    expect(onCreate).toHaveBeenCalledWith(
      "project-1",
      {
        assigneeUserId: null,
        attachments: [],
        description: null,
        fullAuto: false,
        preferredEffort: null,
        preferredModel: null,
        preferredProvider: null,
        priority: 2,
        status: "queued",
        title: "Keyboard-created issue",
      },
    );

    await act(async () => root.unmount());
  });

  it("moves focus to the description with Enter from the title input", async () => {
    const onCreate = vi.fn(async () => undefined);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <CreateIssueDialog
          {...projectProps}
          isSubmitting={false}
          onClose={() => undefined}
          onCreate={onCreate}
        />,
      );
    });

    const titleInput =
      container.querySelector<HTMLInputElement>(".issue-title-input");
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(titleInput, "Enter-created issue");
      titleInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const enterEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
    });
    await act(async () => {
      titleInput?.dispatchEvent(enterEvent);
    });

    expect(enterEvent.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(
      container.querySelector(".issue-description-input"),
    );
    expect(onCreate).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });



  it("does not submit Enter while the title is being composed", async () => {
    const onCreate = vi.fn(async () => undefined);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <CreateIssueDialog
          {...projectProps}
          isSubmitting={false}
          onClose={() => undefined}
          onCreate={onCreate}
        />,
      );
    });

    const enterEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      isComposing: true,
      key: "Enter",
    });
    await act(async () => {
      container
        .querySelector<HTMLInputElement>(".issue-title-input")
        ?.dispatchEvent(enterEvent);
    });

    expect(enterEvent.defaultPrevented).toBe(false);
    expect(onCreate).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });

  it("creates an issue in backlog when that status is selected", async () => {
    const onCreate = vi.fn(async () => undefined);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <CreateIssueDialog
          {...projectProps}
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
          onCreate={onCreate}
        />,
      );
    });

    const titleInput =
      container.querySelector<HTMLInputElement>(".issue-title-input");
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(titleInput, "Backlog issue");
      titleInput?.dispatchEvent(new Event("input", { bubbles: true }));
      container
        .querySelector<HTMLButtonElement>(
          ".issue-status-select .select-menu-trigger",
        )
        ?.click();
    });
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          '[role="option"][data-value="backlog"]',
        )
        ?.click();
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          ".issue-assignee-select .select-menu-trigger",
        )
        ?.click();
    });
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          '[role="option"][data-value="user-1"]',
        )
        ?.click();
    });
    await act(async () => {
      container.querySelector<HTMLFormElement>("form")?.requestSubmit();
    });

    expect(onCreate).toHaveBeenCalledWith(
      "project-1",
      {
        attachments: [],
        description: null,
        fullAuto: false,
        preferredEffort: null,
        preferredModel: null,
        preferredProvider: null,
        priority: 2,
        assigneeUserId: "user-1",
        status: "backlog",
        title: "Backlog issue",
      },
    );

    await act(async () => root.unmount());
  });

  it("selects a preferred provider and model when creating an issue", async () => {
    const onCreate = vi.fn(async () => undefined);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <CreateIssueDialog
          {...projectProps}
          availableProviders={["codex", "claude", "grok"]}
          isSubmitting={false}
          onClose={() => undefined}
          onCreate={onCreate}
        />,
      );
    });

    const titleInput = container.querySelector<HTMLInputElement>(
      ".issue-title-input",
    );
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(titleInput, "Preferred execution issue");
      titleInput?.dispatchEvent(new Event("input", { bubbles: true }));
      container
        .querySelector<HTMLButtonElement>(
          ".issue-provider-select .select-menu-trigger",
        )
        ?.click();
    });
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[role="option"][data-value="claude"]')
        ?.click();
    });
    expect(
      container.querySelector<HTMLButtonElement>(
        ".issue-provider-select .select-menu-trigger",
      )?.textContent,
    ).toContain("Claude");
    expect(
      container.querySelector(
        ".issue-provider-select .select-menu-trigger-leading svg",
      ),
    ).not.toBeNull();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          ".issue-model-select .select-menu-trigger",
        )
        ?.click();
    });
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[role="option"][data-value="sonnet"]')
        ?.click();
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          ".issue-effort-select .select-menu-trigger",
        )
        ?.click();
    });
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[role="option"][data-value="xhigh"]')
        ?.click();
    });
    await act(async () => {
      container.querySelector<HTMLFormElement>("form")?.requestSubmit();
    });

    expect(onCreate).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        preferredProvider: "claude",
        preferredModel: "sonnet",
        preferredEffort: "xhigh",
        title: "Preferred execution issue",
      }),
    );

    await act(async () => root.unmount());
  });

  it("defaults to the active project and can create in another organization project", async () => {
    const onCreate = vi.fn(async () => undefined);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <CreateIssueDialog
          {...projectProps}
          isSubmitting={false}
          onClose={() => undefined}
          onCreate={onCreate}
        />,
      );
    });

    const projectTrigger = container.querySelector<HTMLButtonElement>(
      ".issue-project-context .select-menu-trigger",
    );
    expect(projectTrigger?.textContent).toContain("GG");
    await act(async () => projectTrigger?.click());
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          '[role="option"][data-value="project-2"]',
        )
        ?.click();
    });
    expect(projectTrigger?.textContent).toContain("Mobile");

    const titleInput = container.querySelector<HTMLInputElement>(
      ".issue-title-input",
    );
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(titleInput, "Cross-project issue");
      titleInput?.dispatchEvent(new Event("input", { bubbles: true }));
      container.querySelector<HTMLFormElement>("form")?.requestSubmit();
    });

    expect(onCreate).toHaveBeenCalledWith(
      "project-2",
      expect.objectContaining({ title: "Cross-project issue" }),
    );

    await act(async () => root.unmount());
  });


  it("restores a draft after the backdrop closes the dialog", async () => {
    const onClose = vi.fn();
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <CreateIssueDialog
          {...projectProps}
          isSubmitting={false}
          onClose={onClose}
          onCreate={async () => undefined}
        />,
      );
    });

    const titleInput = container.querySelector<HTMLInputElement>(
      ".issue-title-input",
    );
    const descriptionInput = container.querySelector<HTMLTextAreaElement>(
      ".issue-description-input",
    );
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(titleInput, "Accidentally closed issue");
      titleInput?.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(descriptionInput, "Keep this description");
      descriptionInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          ".issue-project-context .select-menu-trigger",
        )
        ?.click();
    });
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          '[role="option"][data-value="project-2"]',
        )
        ?.click();
      container
        .querySelector<HTMLButtonElement>(
          ".issue-status-select .select-menu-trigger",
        )
        ?.click();
    });
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[role="option"][data-value="backlog"]')
        ?.click();
      container
        .querySelector<HTMLButtonElement>(
          ".issue-priority-select .select-menu-trigger",
        )
        ?.click();
    });
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[role="option"][data-value="4"]')
        ?.click();
    });

    const backdrop = container.querySelector(".issue-dialog-backdrop");
    await act(async () => {
      backdrop?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledOnce();
    expect(JSON.parse(window.localStorage.getItem(createIssueDraftStorageKey)!))
      .toEqual({
        assigneeUserId: null,
        description: "Keep this description",
        preferredEffort: "high",
        preferredModel: null,
        preferredProvider: null,
        priority: "4",
        projectId: "project-2",
        status: "backlog",
        title: "Accidentally closed issue",
      });

    await act(async () => root.unmount());
    const restoredOnCreate = vi.fn(async () => undefined);
    const restoredRoot = createRoot(container);
    await act(async () => {
      restoredRoot.render(
        <CreateIssueDialog
          {...projectProps}
          isSubmitting={false}
          onClose={() => undefined}
          onCreate={restoredOnCreate}
        />,
      );
    });

    expect(
      container.querySelector<HTMLInputElement>(".issue-title-input")?.value,
    ).toBe("Accidentally closed issue");
    expect(
      container.querySelector<HTMLTextAreaElement>(
        ".issue-description-input",
      )?.value,
    ).toBe("Keep this description");
    expect(
      container.querySelector(
        ".issue-project-context .select-menu-trigger",
      )?.textContent,
    ).toContain("Mobile");
    await act(async () => {
      container.querySelector<HTMLFormElement>("form")?.requestSubmit();
    });
    expect(restoredOnCreate).toHaveBeenCalledWith(
      "project-2",
      expect.objectContaining({
        description: "Keep this description",
        priority: 4,
        status: "backlog",
        title: "Accidentally closed issue",
      }),
    );

    await act(async () => restoredRoot.unmount());
  });

  it("clears the saved draft after issue creation succeeds", async () => {
    window.localStorage.setItem(
      createIssueDraftStorageKey,
      JSON.stringify({
        description: "Ready to submit",
        priority: "2",
        projectId: "project-1",
        status: "queued",
        title: "Saved issue",
      }),
    );
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <CreateIssueDialog
          {...projectProps}
          isSubmitting={false}
          onClose={() => undefined}
          onCreate={async () => undefined}
        />,
      );
    });
    await act(async () => {
      container.querySelector<HTMLFormElement>("form")?.requestSubmit();
    });

    expect(window.localStorage.getItem(createIssueDraftStorageKey)).toBeNull();
    await act(async () => root.unmount());
  });

  it("keeps the saved draft when issue creation fails", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <CreateIssueDialog
          {...projectProps}
          isSubmitting={false}
          onClose={() => undefined}
          onCreate={async () => {
            throw new Error("Creation failed");
          }}
        />,
      );
    });
    const titleInput = container.querySelector<HTMLInputElement>(
      ".issue-title-input",
    );
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(titleInput, "Retry this issue");
      titleInput?.dispatchEvent(new Event("input", { bubbles: true }));
      container.querySelector<HTMLFormElement>("form")?.requestSubmit();
    });

    expect(
      JSON.parse(window.localStorage.getItem(createIssueDraftStorageKey)!).title,
    ).toBe("Retry this issue");
    expect(container.querySelector(".issue-form-error")?.textContent).toContain(
      "Creation failed",
    );
    await act(async () => root.unmount());
  });

  it("adds an issue checkpoint while creating an issue", async () => {
    const onCreate = vi.fn(async (
      _projectId: string,
      _input: CreateIssueInput,
    ) => undefined);
    const root = createRoot(container);
    await act(async () => root.render(
      <CreateIssueDialog
        {...projectProps}
        isSubmitting={false}
        onClose={() => undefined}
        onCreate={onCreate}
        workflow={demoDashboard.settings.workflow}
        workflowProjectId="project-1"
      />,
    ));

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".issue-checkpoint-trigger",
      )?.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });
    const option = Array.from(
      document.body.querySelectorAll<HTMLElement>(
        '[role="menuitemcheckbox"]:not([data-disabled])',
      ),
    ).find((item) => item.getAttribute("data-state") === "unchecked");
    expect(option).toBeDefined();
    await act(async () => option?.click());

    const title = container.querySelector<HTMLInputElement>(
      ".issue-title-input",
    );
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(title, "Checkpoint issue");
      title?.dispatchEvent(new Event("input", { bubbles: true }));
      container.querySelector<HTMLFormElement>("form")?.requestSubmit();
    });

    expect(onCreate).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        checkpoints: [expect.objectContaining({
          key: expect.stringMatching(/^issue-/u),
          position: expect.stringMatching(/^(before|after)$/u),
        })],
      }),
    );
    await act(async () => root.unmount());
  });

  it("submits Full Auto and clears issue-specific checkpoints", async () => {
    const onCreate = vi.fn(async (
      _projectId: string,
      _input: CreateIssueInput,
    ) => undefined);
    const root = createRoot(container);
    await act(async () => root.render(
      <CreateIssueDialog
        {...projectProps}
        isSubmitting={false}
        onClose={() => undefined}
        onCreate={onCreate}
        workflow={demoDashboard.settings.workflow}
        workflowProjectId="project-1"
      />,
    ));

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".issue-checkpoint-trigger",
      )?.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });
    const checkpoint = Array.from(
      document.body.querySelectorAll<HTMLElement>(
        '[role="menuitemcheckbox"]:not([data-disabled])',
      ),
    ).find((item) => item.getAttribute("data-state") === "unchecked");
    await act(async () => checkpoint?.click());

    const fullAuto = container.querySelector<HTMLInputElement>(
      ".issue-full-auto-toggle input",
    );
    await act(async () => fullAuto?.click());
    expect(fullAuto?.checked).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>(".issue-checkpoint-trigger")
        ?.disabled,
    ).toBe(true);

    const title = container.querySelector<HTMLInputElement>(
      ".issue-title-input",
    );
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(title, "Full Auto issue");
      title?.dispatchEvent(new Event("input", { bubbles: true }));
      container.querySelector<HTMLFormElement>("form")?.requestSubmit();
    });

    expect(onCreate).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        fullAuto: true,
        title: "Full Auto issue",
      }),
    );
    expect(onCreate.mock.calls[0]?.[1]).not.toHaveProperty("checkpoints");
    await act(async () => root.unmount());
  });


});
