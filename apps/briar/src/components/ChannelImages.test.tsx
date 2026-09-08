/** @vitest-environment jsdom */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { createReactTestRoot, renderReactTestRoot } from "@/test/react";
import { I18nProvider } from "@/i18n";
import {
  ChannelDraftImages,
  ChannelMessageImageCacheProvider,
  ChannelMessageImages,
  channelBodyWithoutImages,
  draftChannelImage,
  registerChannelMessageImageSource,
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
          imageWidth: null,
          imageHeight: null,
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
            imageWidth: null,
            imageHeight: null,
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

  it("renders a local blob image attachment immediately with eager loading without network fetch", async () => {
    const load = vi.spyOn(api, "loadChannelMessageAttachment");
    await renderReactTestRoot(
      root,
      <I18nProvider>
        <ChannelMessageImages
          attachments={[{
            id: "local-img-1",
            filename: "screenshot.png",
            contentType: "image/png",
            byteSize: 4096,
            url: "blob:http://localhost/local-screenshot",
            imageWidth: null,
            imageHeight: null,
          }]}
          token="token"
        />
      </I18nProvider>,
    );

    const img = container.querySelector<HTMLImageElement>("img");
    expect(img).not.toBeNull();
    expect(img?.src).toBe("blob:http://localhost/local-screenshot");
    expect(img?.getAttribute("loading")).toBe("eager");
    expect(container.querySelector('[aria-label="churning"]')).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it("renders a server image attachment immediately from seeded cache without loading spinner", async () => {
    const load = vi.spyOn(api, "loadChannelMessageAttachment");
    const cache = {
      disposed: false,
      entries: new Map(),
    };
    registerChannelMessageImageSource(
      cache,
      "server-img-1:/attachments/server-img-1",
      "blob:http://localhost/cached-source",
    );

    await renderReactTestRoot(
      root,
      <I18nProvider>
        <ChannelMessageImageCacheProvider cache={cache}>
          <ChannelMessageImages
            attachments={[{
              id: "server-img-1",
              filename: "server-pic.png",
              contentType: "image/png",
              byteSize: 8192,
              url: "/attachments/server-img-1",
              imageWidth: null,
              imageHeight: null,
            }]}
            token="token"
          />
        </ChannelMessageImageCacheProvider>
      </I18nProvider>,
    );

    const img = container.querySelector<HTMLImageElement>("img");
    expect(img).not.toBeNull();
    expect(img?.src).toBe("blob:http://localhost/cached-source");
    expect(container.querySelector('[aria-label="churning"]')).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it.each([
    { imageWidth: null, imageHeight: null, expected: "", label: "unknown" },
    {
      imageWidth: 1_600,
      imageHeight: 900,
      expected: "1600 / 900",
      label: "recorded",
    },
  ])(
    "keeps the reserved box identical across loading for $label dimensions",
    async ({ expected, imageHeight, imageWidth }) => {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: vi.fn(() => "blob:loaded-attachment"),
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: vi.fn(),
      });
      let resolveAttachment: (blob: Blob) => void = () => undefined;
      vi.spyOn(api, "loadChannelMessageAttachment").mockReturnValue(
        new Promise<Blob>((resolve) => {
          resolveAttachment = resolve;
        }),
      );
      await renderReactTestRoot(
        root,
        <I18nProvider>
          <ChannelMessageImages
            attachments={[{
              id: "pending-img-1",
              filename: "pending.png",
              contentType: "image/png",
              byteSize: 4_096,
              url: "/attachments/pending-img-1",
              imageWidth,
              imageHeight,
            }]}
            token="token"
          />
        </I18nProvider>,
      );

      const preview = () =>
        container.querySelector<HTMLElement>(".channel-message-image-preview");
      expect(container.querySelector(".channel-message-image-state"))
        .not.toBeNull();
      const reservedWhileLoading = preview()?.style.aspectRatio;
      expect(reservedWhileLoading).toBe(expected);

      await act(async () => {
        resolveAttachment(new Blob(["png"], { type: "image/png" }));
      });
      await vi.waitFor(() => {
        expect(container.querySelector("img")).not.toBeNull();
      });

      // The spinner and the picture share one container, so the row keeps the
      // height it reserved whether or not the upload recorded its dimensions.
      expect(preview()?.style.aspectRatio).toBe(reservedWhileLoading);
      expect(preview()?.querySelector("img")).not.toBeNull();
    },
  );

  it("normalizes escaped line breaks in message bodies", () => {
    expect(channelBodyWithoutImages("first\\nsecond\\r\\nthird"))
      .toBe("first\nsecond\nthird");
  });
});
