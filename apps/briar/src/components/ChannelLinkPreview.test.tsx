/** @vitest-environment jsdom */

import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { createReactTestRoot, settle } from "@/test/react";
import { I18nProvider } from "@/i18n";
import { ChannelLinkPreview } from "./ChannelLinkPreview";
import type { ChannelLinkPreview as ChannelLinkPreviewData } from "@/lib/channels-contract";

const message = (url: string) => ({
  body: `Look at this ${url}`,
  blocks: [],
  deletedAt: null,
  optimistic: false,
});

const preview = (
  url: string,
  overrides: Partial<ChannelLinkPreviewData> = {},
): ChannelLinkPreviewData => ({
  url,
  title: "A headline",
  description: "A useful summary.",
  imageUrl: "https://cdn.example.org/hero.png",
  faviconUrl: null,
  siteName: "Example",
  imageWidth: null,
  imageHeight: null,
  ...overrides,
});

describe("channel link preview layout reservation", () => {
  let cleanup: () => Promise<void>;
  let container: HTMLDivElement;
  let render: (node: React.ReactNode) => Promise<void>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    ({ cleanup, container, render } = createReactTestRoot({
      attachToDocument: true,
    }));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanup();
  });

  const frame = (root: HTMLElement = container) =>
    root.querySelector<HTMLElement>(".channel-link-preview-image");
  const card = (root: HTMLElement = container) =>
    root.querySelector<HTMLImageElement>(".channel-link-preview-image img");

  it("reserves the image box before the picture loads and keeps it when it fails", async () => {
    const url = "https://news.example.com/unsized";
    vi.spyOn(api, "loadChannelLinkPreview").mockResolvedValue({
      preview: preview(url),
    });
    await render(
      <I18nProvider>
        <ChannelLinkPreview
          channelId="channel-1"
          message={message(url)}
          workspaceId="org-1"
          token="token"
        />
      </I18nProvider>,
    );
    await settle(() => card() !== null, { description: "the preview card" });

    const image = card()!;
    // No inline ratio, so the fixed 1.91:1 reservation in the stylesheet holds
    // and the height cannot depend on when the picture arrives.
    expect(frame()?.style.aspectRatio).toBe("");
    expect(image.getAttribute("loading")).toBe("lazy");

    await act(async () => {
      image.dispatchEvent(new Event("error"));
    });
    // The picture is gone, the space it claimed is not.
    expect(card()).toBeNull();
    expect(frame()).not.toBeNull();
  });

  it("uses the reported dimensions when the worker resolved them", async () => {
    const url = "https://news.example.com/sized";
    vi.spyOn(api, "loadChannelLinkPreview").mockResolvedValue({
      preview: preview(url, { imageWidth: 1_600, imageHeight: 900 }),
    });
    await render(
      <I18nProvider>
        <ChannelLinkPreview
          channelId="channel-1"
          message={message(url)}
          workspaceId="org-1"
          token="token"
        />
      </I18nProvider>,
    );
    await settle(() => card() !== null, { description: "the preview card" });

    expect(frame()?.style.aspectRatio).toBe("1600 / 900");
  });

  it("renders a cached preview on the first frame instead of a skeleton", async () => {
    const url = "https://news.example.com/cached";
    const load = vi.spyOn(api, "loadChannelLinkPreview").mockResolvedValue({
      preview: preview(url, { imageWidth: 800, imageHeight: 400 }),
    });
    const node = (
      <I18nProvider>
        <ChannelLinkPreview
          channelId="channel-1"
          message={message(url)}
          workspaceId="org-1"
          token="token"
        />
      </I18nProvider>
    );
    await render(node);
    await settle(() => card() !== null, { description: "the preview card" });

    /*
      Static markup is the render pass alone, with no effects: it is exactly
      what a remounted row paints on its first frame. The card has to be there
      already, because a skeleton frame would resize the row a moment later.
    */
    const firstFrame = renderToStaticMarkup(node);
    expect(firstFrame).not.toContain("channel-link-preview-loading");
    expect(firstFrame).toContain("channel-link-preview-image");
    expect(firstFrame).toContain("aspect-ratio:800 / 400");
    expect(firstFrame).toContain("<img");
    expect(load).toHaveBeenCalledOnce();
  });

  it("shows a skeleton that matches the card while a preview is still loading", async () => {
    const url = "https://news.example.com/pending";
    vi.spyOn(api, "loadChannelLinkPreview").mockReturnValue(
      new Promise(() => undefined),
    );
    await render(
      <I18nProvider>
        <ChannelLinkPreview
          channelId="channel-1"
          message={message(url)}
          workspaceId="org-1"
          token="token"
        />
      </I18nProvider>,
    );

    expect(container.querySelector(".channel-link-preview-loading"))
      .not.toBeNull();
  });
});
