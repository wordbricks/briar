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

  it("renders details in the inline right-hand pane", async () => {
    await act(async () =>
      root.render(
        <InboxDetailPanel label="Issue details">
          <p>Finished issue</p>
        </InboxDetailPanel>,
      ),
    );

    const pane = container.querySelector(".inbox-detail-pane");
    expect(pane?.getAttribute("aria-label")).toBe("Issue details");
    expect(pane?.textContent).toContain("Finished issue");
    expect(document.body.querySelector("[aria-modal='true']")).toBeNull();
  });
});
