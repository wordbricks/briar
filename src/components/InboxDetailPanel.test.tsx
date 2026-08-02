/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InboxDetailPanel } from "./InboxDetailPanel";

describe("InboxDetailPanel", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("renders details in an accessible modal side panel", async () => {
    await act(async () =>
      root.render(
        <InboxDetailPanel label="Issue details" onClose={vi.fn()}>
          <p>Finished issue</p>
        </InboxDetailPanel>,
      ),
    );

    const dialog = document.body.querySelector(".inbox-detail-drawer");
    expect(dialog?.getAttribute("role")).toBe("dialog");
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.getAttribute("aria-label")).toBeNull();
    expect(dialog?.textContent).toContain("Issue details");
    expect(dialog?.textContent).toContain("Finished issue");
  });

  it("closes with Escape", async () => {
    const onClose = vi.fn();
    await act(async () =>
      root.render(
        <InboxDetailPanel label="Issue details" onClose={onClose}>
          <p>Finished issue</p>
        </InboxDetailPanel>,
      ),
    );

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      );
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
