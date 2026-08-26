/** @vitest-environment jsdom */

import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { describe, expect, it } from "vitest";

import { InboxDetailPanel } from "./InboxDetailPanel";
import { MainContent } from "./layout";

describe("InboxDetailPanel", () => {
  it("embeds detail main content without creating a nested main landmark", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
      <main>
        <InboxDetailPanel label="Selected issue">
          <MainContent id="issue-detail">Issue detail</MainContent>
        </InboxDetailPanel>
      </main>,
    );

    expect(container.querySelectorAll("main")).toHaveLength(1);
    const detail = container.querySelector("#issue-detail");
    expect(detail?.tagName).toBe("DIV");
    expect(detail?.classList.contains("main-content")).toBe(true);

    await cleanup();
  });
});
