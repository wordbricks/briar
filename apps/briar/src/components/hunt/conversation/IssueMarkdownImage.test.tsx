/** @vitest-environment jsdom */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReactTestRoot, renderReactTestRoot } from "@/test/react";
import { IssueMarkdownImage } from "./IssueMarkdownImage";

describe("IssueMarkdownImage HTML artifacts", () => {
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

  it("renders an agent HTML attachment as a preview card instead of an image", async () => {
    const attachment = {
      id: "artifact-1",
      filename: "lesson.html",
      contentType: "text/html",
      byteSize: 20,
      url: "/attachments/artifact-1",
    };
    const onLoadAttachment = vi.fn(async () =>
      new Blob(["<h1>Lesson</h1>"], { type: "text/html" })
    );
    await renderReactTestRoot(
      root,
      <IssueMarkdownImage
        alt="lesson.html"
        attachments={[attachment]}
        onLoadAttachment={onLoadAttachment}
        src="briar-attachment://artifact-1"
      />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(onLoadAttachment).not.toHaveBeenCalled();
    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="lesson.html HTML 미리보기 열기"]',
    );
    await act(async () => trigger?.click());
    expect(onLoadAttachment).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(document.querySelector(".html-artifact-dialog iframe"))
        .not.toBeNull();
    });
  });
});
