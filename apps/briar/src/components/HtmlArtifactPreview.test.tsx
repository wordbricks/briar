/** @vitest-environment jsdom */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { HtmlArtifactPreview } from "./HtmlArtifactPreview";

describe("HtmlArtifactPreview", () => {
  let cleanup: () => Promise<void>;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createReactTestRoot>["root"];

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    ({ cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    }));
  });

  afterEach(async () => {
    await cleanup();
  });

  it("loads HTML on demand and opens it in an isolated app-sized modal", async () => {
    const loadAttachment = vi.fn(async () =>
      new Blob([
        "<!doctype html><html><head><title>Planets</title></head><body><button onclick=\"document.body.dataset.clicked='yes'\">Explore</button></body></html>",
      ], { type: "text/html" })
    );
    await renderReactTestRoot(
      root,
      <HtmlArtifactPreview
        byteSize={3210}
        filename="planets.html"
        loadAttachment={loadAttachment}
      />,
    );

    expect(loadAttachment).not.toHaveBeenCalled();
    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="planets.html HTML 미리보기 열기"]',
    );
    await act(async () => trigger?.click());

    const dialog = document.querySelector<HTMLElement>("[role='dialog']");
    expect(loadAttachment).toHaveBeenCalledOnce();
    expect(dialog?.classList.contains("html-artifact-dialog")).toBe(true);
    await vi.waitFor(() => {
      expect(dialog?.querySelector("iframe")).not.toBeNull();
    });
    const frame = dialog?.querySelector<HTMLIFrameElement>("iframe");
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame?.srcdoc).toContain("Content-Security-Policy");
    expect(frame?.srcdoc).toContain("connect-src 'none'");
    expect(frame?.srcdoc).toContain("onclick=");
  });
});
