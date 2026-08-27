/** @vitest-environment jsdom */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { createReactTestRoot, renderReactTestRoot } from "@/test/react";
import { ChannelMessageImages } from "./ChannelImages";

describe("ChannelMessageImages HTML artifacts", () => {
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
});
