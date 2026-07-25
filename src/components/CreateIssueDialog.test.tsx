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
});
