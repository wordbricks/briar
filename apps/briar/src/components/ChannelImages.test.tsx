/** @vitest-environment jsdom */

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelMessageAttachment } from "../lib/channels-contract";

const loadChannelMessageAttachment = vi.fn();

vi.mock("../lib/api", () => ({
  loadChannelMessageAttachment: (...args: unknown[]) =>
    loadChannelMessageAttachment(...args),
}));

const {
  ChannelMessageImageCacheProvider,
  ChannelMessageImages,
  useChannelMessageImageCache,
} = await import("./ChannelImages");

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const attachment = (id: string): ChannelMessageAttachment => ({
  id,
  filename: `${id}.png`,
  contentType: "image/png",
  byteSize: id.length,
  url: `/channels/channel-${id}/attachments/${id}`,
});

function Harness() {
  const [active, setActive] = useState("a");
  const cache = useChannelMessageImageCache("org-1\0token");
  return (
    <ChannelMessageImageCacheProvider cache={cache}>
      <button onClick={() => setActive(active === "a" ? "b" : "a")}>Switch</button>
      <ChannelMessageImages attachments={[attachment(active)]} token="token" />
    </ChannelMessageImageCacheProvider>
  );
}

describe("ChannelMessageImages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadChannelMessageAttachment.mockImplementation(
      (_token: string, image: ChannelMessageAttachment) =>
        Promise.resolve(new Blob([image.id], { type: image.contentType })),
    );
    let created = 0;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => `blob:channel-${++created}`),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("reuses a loaded image after switching away and back", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<Harness />));

    expect(loadChannelMessageAttachment).toHaveBeenCalledTimes(1);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "blob:channel-1",
    );

    const switchChannel = () =>
      container.querySelector<HTMLButtonElement>("button")!.click();
    await act(async () => switchChannel());
    expect(loadChannelMessageAttachment).toHaveBeenCalledTimes(2);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "blob:channel-2",
    );

    await act(async () => switchChannel());
    expect(loadChannelMessageAttachment).toHaveBeenCalledTimes(2);
    expect(container.querySelector(".channel-message-image-state")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "blob:channel-1",
    );
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    container.remove();
  });
});
