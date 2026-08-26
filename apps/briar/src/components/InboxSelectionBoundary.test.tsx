/** @vitest-environment jsdom */

import { RegistryProvider, useAtomSet } from "@effect/atom-react";
import { act } from "react";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { describe, expect, it } from "vitest";

import { inboxDetailTargetAtom } from "../lib/inbox-selection";
import { InboxDetailTargetBoundary } from "./InboxSelectionBoundary";

describe("InboxSelectionBoundary", () => {
  it("updates detail subscribers without rerendering the app shell", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    let shellRenderCount = 0;
    let detailRenderCount = 0;

    function SelectMessage() {
      const setTarget = useAtomSet(inboxDetailTargetAtom);
      return (
        <button
          onClick={() =>
            setTarget({
              kind: "issue",
              messageId: "message-1",
              projectId: "project-1",
              targetId: "run-1",
            })}
          type="button"
        >
          Select
        </button>
      );
    }

    function AppShell() {
      shellRenderCount += 1;
      return (
        <>
          <SelectMessage />
          <InboxDetailTargetBoundary>
            {(target) => {
              detailRenderCount += 1;
              return <output>{target?.messageId ?? "none"}</output>;
            }}
          </InboxDetailTargetBoundary>
        </>
      );
    }

    await renderReactTestRoot(
      root,
      <RegistryProvider>
        <AppShell />
      </RegistryProvider>,
    );
    expect(shellRenderCount).toBe(1);
    expect(detailRenderCount).toBe(1);

    await act(async () => container.querySelector("button")?.click());

    expect(container.querySelector("output")?.textContent).toBe("message-1");
    expect(shellRenderCount).toBe(1);
    expect(detailRenderCount).toBe(2);

    await cleanup();
  });
});
