/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateIssueDialog } from "./HuntDashboard";

describe("CreateIssueDialog clipboard attachments", () => {
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
    expect(container.textContent).toContain("clipboard.png");
    expect(container.querySelector<HTMLImageElement>(".issue-attachment-preview img")?.src)
      .toBe("blob:clipboard-preview");

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
