/** @vitest-environment jsdom */

import { act } from "react";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ImageLightbox, imageDownloadFilename } from "./ImageLightbox";

describe("ImageLightbox", () => {
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

  it("opens the image in an app-sized modal with a named download", async () => {
    await renderReactTestRoot(
      root,
      <ImageLightbox
        alt="Finished dashboard"
        filename="finished-dashboard.png"
        source="blob:finished-dashboard"
      />,
    );

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
