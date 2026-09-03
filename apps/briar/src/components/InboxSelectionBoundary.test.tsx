/** @vitest-environment jsdom */

import { RegistryProvider, useAtomSet } from "@effect/atom-react";
import { act } from "react";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { createRenderCounter } from "../test/render-count";
import { describe, expect, it } from "vitest";

import { inboxDetailTargetAtom } from "../state/inbox-selection";
import { InboxDetailTargetBoundary } from "./InboxSelectionBoundary";

describe("InboxSelectionBoundary", () => {
  it("updates detail subscribers without rerendering the app shell", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    const renders = createRenderCounter();

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
      renders.useRenderCount("shell");
      return (
        <>
          <SelectMessage />
          <InboxDetailTargetBoundary>
            {(target) =>
              renders.record(
                "detail",
                <output>{target?.messageId ?? "none"}</output>,
              )}
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
    renders.expectRenderCounts({ detail: 1, shell: 1 });

    await act(async () => container.querySelector("button")?.click());

    expect(container.querySelector("output")?.textContent).toBe("message-1");
    renders.expectRenderCounts({ detail: 2, shell: 1 });

    await cleanup();
  });
});
