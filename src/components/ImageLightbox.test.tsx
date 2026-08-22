/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ImageLightbox, imageDownloadFilename } from "./ImageLightbox";

describe("ImageLightbox", () => {
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
  });

  it("opens the image in an app-sized modal with a named download", async () => {
    await act(async () => {
      root.render(
        <ImageLightbox
          alt="Finished dashboard"
          filename="finished-dashboard.png"
          source="blob:finished-dashboard"
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="finished-dashboard.png 크게 보기"]',
    );
    expect(trigger).not.toBeNull();

    await act(async () => trigger?.click());

    const dialog = document.querySelector<HTMLElement>("[role='dialog']");
    const download = dialog?.querySelector<HTMLAnchorElement>(
      ".image-lightbox-download",
    );
    expect(dialog?.classList.contains("image-lightbox-dialog")).toBe(true);
    expect(dialog?.querySelector(".image-lightbox-body img")?.getAttribute("src"))
      .toBe("blob:finished-dashboard");
    expect(download?.getAttribute("download")).toBe("finished-dashboard.png");
    expect(download?.getAttribute("href")).toBe("blob:finished-dashboard");
    expect(download?.getAttribute("aria-label"))
      .toBe("finished-dashboard.png 다운로드");
  });

});
