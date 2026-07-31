/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateIssueDialog } from "./HuntDashboard";
import type { CreateIssueInput } from "../types";

describe("CreateIssueDialog attachments", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    URL.createObjectURL = vi.fn(() => "blob:clipboard-preview");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  it("adds a pasted clipboard image and renders its preview", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <CreateIssueDialog
          isSubmitting={false}
          onClose={() => undefined}
          onCreate={async () => undefined}
        />,
      );
    });

    const image = new File(["clipboard image"], "clipboard.png", {
      type: "image/png",
    });
    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: {
        files: [],
        items: [
          { getAsFile: () => image, kind: "file", type: "image/png" },
          { getAsFile: () => null, kind: "string", type: "text/plain" },
        ],
      },
    });

    await act(async () => {
      container.querySelector("form")?.dispatchEvent(pasteEvent);
    });

    expect(pasteEvent.defaultPrevented).toBe(true);
    const inlineImage = container.querySelector<HTMLImageElement>(
      ".issue-inline-attachment img",
    );
    expect(inlineImage?.alt).toBe("clipboard.png");
    expect(inlineImage?.src).toBe("blob:clipboard-preview");
    expect(
      Array.from(container.querySelectorAll<HTMLTextAreaElement>("textarea"))
        .map((textarea) => textarea.value)
        .join(""),
    ).not.toContain("briar-attachment://");
    expect(container.querySelector(".issue-attachment-item")).toBeNull();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".issue-inline-attachment button")
        ?.click();
    });
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
    expect(container.querySelector(".issue-attachment-item")).toBeNull();

    await act(async () => root.unmount());
  });

  it("inserts a pasted image at the description caret and submits its reference", async () => {
    const onCreate = vi.fn<(input: CreateIssueInput) => Promise<void>>(
      async () => undefined,
    );
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <CreateIssueDialog
          isSubmitting={false}
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
    const [submitted] = onCreate.mock.calls[0]!;
    expect(submitted.attachments).toEqual([image]);
    expect(submitted.attachmentReferences).toHaveLength(1);
    expect(submitted.description).toContain(
      `briar-attachment://${submitted.attachmentReferences?.[0]}`,
    );

    await act(async () => root.unmount());
  });

  it("leaves ordinary text paste untouched", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <CreateIssueDialog
          isSubmitting={false}
          onClose={() => undefined}
          onCreate={async () => undefined}
        />,
      );
    });

    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: {
        files: [],
        items: [{ getAsFile: () => null, kind: "string", type: "text/plain" }],
      },
    });

    await act(async () => {
      container.querySelector("textarea")?.dispatchEvent(pasteEvent);
    });

    expect(pasteEvent.defaultPrevented).toBe(false);
    expect(container.querySelector(".issue-attachment-item")).toBeNull();

    await act(async () => root.unmount());
  });

  it("adds a dropped image and shows drag feedback", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <CreateIssueDialog
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
          isSubmitting={false}
          onClose={() => undefined}
          onCreate={onCreate}
          projectName="GG"
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

    expect(onCreate).toHaveBeenCalledWith({
      attachments: [],
      description: null,
      priority: 2,
      status: "queued",
      title: "Keyboard-created issue",
    });

    await act(async () => root.unmount());
  });

  it("moves focus to the description with Enter from the title input", async () => {
    const onCreate = vi.fn(async () => undefined);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <CreateIssueDialog
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

  it("keeps plain Enter available for the description", async () => {
    const onCreate = vi.fn(async () => undefined);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <CreateIssueDialog
          isSubmitting={false}
          onClose={() => undefined}
          onCreate={onCreate}
        />,
      );
    });

    const enterEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
    });
    await act(async () => {
      container.querySelector("textarea")?.dispatchEvent(enterEvent);
    });

    expect(enterEvent.defaultPrevented).toBe(false);
    expect(onCreate).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });

  it("does not submit Enter while the title is being composed", async () => {
    const onCreate = vi.fn(async () => undefined);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <CreateIssueDialog
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
      container.querySelector<HTMLFormElement>("form")?.requestSubmit();
    });

    expect(onCreate).toHaveBeenCalledWith({
      attachments: [],
      description: null,
      priority: 2,
      status: "backlog",
      title: "Backlog issue",
    });

    await act(async () => root.unmount());
  });
});
