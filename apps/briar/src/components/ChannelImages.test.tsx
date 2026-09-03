/** @vitest-environment jsdom */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { createReactTestRoot, renderReactTestRoot } from "@/test/react";
import { I18nProvider } from "@/i18n";
import {
  ChannelDraftImages,
  ChannelMessageImages,
  draftChannelImage,
} from "./ChannelImages";

describe("channel message attachments", () => {
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
    vi.restoreAllMocks();
    await cleanup();
  });

  it("renders a channel HTML attachment as an on-demand modal preview", async () => {
    const load = vi.spyOn(api, "loadChannelMessageAttachment").mockResolvedValue(
      new Blob(["<h1>Channel lesson</h1>"], { type: "text/html" }),
    );
    await renderReactTestRoot(
      root,
      <ChannelMessageImages
        attachments={[{
          id: "artifact-1",
          filename: "channel-lesson.html",
          contentType: "text/html",
          byteSize: 24,
          url: "/attachments/artifact-1",
        }]}
        token="token"
      />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(load).not.toHaveBeenCalled();
    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="channel-lesson.html HTML 미리보기 열기"]',
    );
    await act(async () => trigger?.click());
    expect(load).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(document.querySelector(".html-artifact-dialog iframe"))
        .not.toBeNull();
    });
  });

  it("renders a PDF as a file card backed by an authenticated blob URL", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:private-pdf"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const load = vi.spyOn(api, "loadChannelMessageAttachment").mockResolvedValue(
      new Blob(["%PDF-1.7"], { type: "application/pdf" }),
    );
    await renderReactTestRoot(
      root,
      <I18nProvider>
        <ChannelMessageImages
          attachments={[{
            id: "pdf-1",
            filename: "product brief.pdf",
            contentType: "application/pdf",
            byteSize: 2048,
            url: "/attachments/pdf-1",
          }]}
          token="token"
        />
      </I18nProvider>,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).toContain("product brief.pdf");
    expect(container.textContent).toContain("2KB · PDF");
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    const link = container.querySelector<HTMLAnchorElement>(
      'a[href="blob:private-pdf"]',
    );
    expect(link?.target).toBe("_blank");
    expect(link?.textContent).toContain("Open");
  });

  it("shows a PDF filename and size in the removable draft card", async () => {
    const onRemove = vi.fn();
    const pdf = new File(["%PDF-1.7"], "draft.pdf", {
      type: "application/pdf",
    });
    await renderReactTestRoot(
      root,
      <ChannelDraftImages
        images={[draftChannelImage(pdf)]}
        onRemove={onRemove}
      />,
    );

    expect(container.textContent).toContain("draft.pdf");
    expect(container.textContent).toContain("8B");
    await act(async () => container.querySelector("button")?.click());
    expect(onRemove).toHaveBeenCalledOnce();
  });
});
