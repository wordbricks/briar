/** @vitest-environment jsdom */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  htmlArtifactPreviewMaxBytes,
  htmlArtifactPreviewMessageType,
  htmlArtifactPreviewProtocolVersion,
} from "@/lib/html-artifact-preview-contract";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { HtmlArtifactPreview } from "./HtmlArtifactPreview";

const shellMessage = (type: string) => ({
  type,
  version: htmlArtifactPreviewProtocolVersion,
});

function dispatchShellMessage(
  frame: HTMLIFrameElement,
  type: string,
  origin = "null",
) {
  window.dispatchEvent(new MessageEvent("message", {
    data: shellMessage(type),
    origin,
    source: frame.contentWindow,
  }));
}

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

  it("loads HTML on demand and sends it once after the isolated shell is ready", async () => {
    const artifact =
      "<!doctype html><html><head><title>Planets</title></head><body><button onclick=\"document.body.dataset.clicked='yes'\">Explore</button></body></html>";
    const loadAttachment = vi.fn(async () =>
      new Blob([artifact], { type: "text/html" })
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
    const frame = dialog!.querySelector<HTMLIFrameElement>("iframe")!;
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame.getAttribute("srcdoc")).toBeNull();
    expect(frame.src).toBe("http://127.0.0.1:8787/html-artifact-preview");

    const postMessage = vi.spyOn(frame.contentWindow!, "postMessage");
    dispatchShellMessage(
      frame,
      htmlArtifactPreviewMessageType.ready,
      "http://127.0.0.1:8787",
    );
    expect(postMessage.mock.calls.filter(([message]) =>
      message.type === htmlArtifactPreviewMessageType.render
    )).toHaveLength(0);

    dispatchShellMessage(frame, htmlArtifactPreviewMessageType.ready);
    await vi.waitFor(() => {
      expect(postMessage.mock.calls.filter(([message]) =>
        message.type === htmlArtifactPreviewMessageType.render
      )).toEqual([[
        {
          type: htmlArtifactPreviewMessageType.render,
          version: htmlArtifactPreviewProtocolVersion,
          html: artifact,
        },
        "*",
      ]]);
    });
    dispatchShellMessage(frame, htmlArtifactPreviewMessageType.ready);
    dispatchShellMessage(frame, htmlArtifactPreviewMessageType.rendered);
    await vi.waitFor(() => expect(frame.classList.contains("is-pending")).toBe(false));
    expect(postMessage.mock.calls.filter(([message]) =>
      message.type === htmlArtifactPreviewMessageType.render
    )).toHaveLength(1);
  });

  it("fails closed when the shell is not ready and remounts it on retry", async () => {
    let shellTimeout: (() => void) | undefined;
    const setTimeout = vi.spyOn(window, "setTimeout").mockImplementation(
      ((callback: TimerHandler, delay?: number) => {
        if (delay === 5_000 && typeof callback === "function") {
          shellTimeout = callback as () => void;
        }
        return 1;
      }) as typeof window.setTimeout,
    );
    await renderReactTestRoot(
      root,
      <HtmlArtifactPreview
        byteSize={20}
        filename="timeout.html"
        loadAttachment={() =>
          Promise.resolve(new Blob(["<p>Safe</p>"], { type: "text/html" }))}
      />,
    );

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        '[aria-label="timeout.html HTML 미리보기 열기"]',
      )?.click();
    });
    const firstFrame = document.querySelector<HTMLIFrameElement>(
      ".html-artifact-dialog iframe",
    );
    expect(shellTimeout).toBeTypeOf("function");
    await act(async () => shellTimeout?.());
    const retry = document.querySelector<HTMLButtonElement>(
      ".html-artifact-state.is-error button",
    );
    expect(retry).not.toBeNull();
    await act(async () => retry?.click());
    expect(document.querySelector(".html-artifact-dialog iframe"))
      .not.toBe(firstFrame);
    setTimeout.mockRestore();
  });

  it("rejects an oversized attachment before reading or sending it", async () => {
    const text = vi.fn(async () => "must not be read");
    const oversized = {
      size: htmlArtifactPreviewMaxBytes + 1,
      text,
    } as unknown as Blob;
    await renderReactTestRoot(
      root,
      <HtmlArtifactPreview
        byteSize={htmlArtifactPreviewMaxBytes + 1}
        filename="oversized.html"
        loadAttachment={() => Promise.resolve(oversized)}
      />,
    );

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        '[aria-label="oversized.html HTML 미리보기 열기"]',
      )?.click();
    });
    await vi.waitFor(() => {
      expect(document.querySelector(".html-artifact-state.is-error"))
        .not.toBeNull();
    });
    expect(text).not.toHaveBeenCalled();
  });
});
