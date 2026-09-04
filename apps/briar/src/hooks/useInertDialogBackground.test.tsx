/** @vitest-environment jsdom */

import { act } from "react";
import { describe, expect, it } from "vitest";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { ko } from "@/i18n/messages";
import { demoDashboard } from "@/lib/demo-data";
import { createIssueDraftStorageKey } from "@/lib/create-issue-draft";
import { CreateIssueDialog } from "@/components/hunt/editor/CreateIssueDialog";
import { BoardCreateIssueButton } from "@/components/hunt/board/HuntBoard";
import { useInertDialogBackground } from "./useInertDialogBackground";

const dialogProps = {
  isSubmitting: false,
  onClose: () => undefined,
  onCreate: async () => undefined,
  projects: [demoDashboard.team],
};

/*
  The QA report: with the New issue dialog open, accessibility refs for its
  Title/Description/Create issue controls resolved to unrelated page controls
  (the header New issue button, card add, project add) and clicks hit elements
  obscured by the backdrop. The dialog must therefore take the app background
  out of the accessibility tree and out of interaction while it is open.
*/
describe("useInertDialogBackground", () => {
  it("inerts the app background around an open CreateIssueDialog and restores it on close", async () => {
    window.localStorage.removeItem(createIssueDraftStorageKey);
    const bodyPortal = document.createElement("div");
    bodyPortal.setAttribute("data-testid", "toast-viewport");
    document.body.append(bodyPortal);
    const { cleanup, container, root } = createReactTestRoot({ attachToDocument: true });
    await renderReactTestRoot(root, <div className="desktop-app-frame" data-testid="frame">
        <div className="app-shell" data-testid="shell">
          <div data-testid="window-controls" />
          <div data-testid="sidebar">
            <button type="button">sidebar add</button>
          </div>
          <div data-testid="pages">
            <div data-testid="board">
              <BoardCreateIssueButton onCreate={() => undefined} />
              <button type="button">Add issue to Ready</button>
            </div>
            <CreateIssueDialog {...dialogProps} />
          </div>
        </div>
        <div data-testid="status-bar">
          <button type="button">Manage accounts</button>
        </div>
      </div>);
    const background = ["window-controls", "sidebar", "board", "status-bar"].map(name => container.querySelector(`[data-testid="${name}"]`));
    expect(background.every(element => element?.hasAttribute("inert"))).toBe(true);
    // The dialog itself, and every ancestor it needs, stays interactive, and
    // body-level portals such as the toast viewport are outside the boundary.
    expect(container.querySelector(".issue-dialog")?.closest("[inert]")).toBeNull();
    expect(container.querySelector('[data-testid="pages"]')?.closest("[inert]")).toBeNull();
    expect(bodyPortal.hasAttribute("inert")).toBe(false);
    await act(async () => {
      root.unmount();
    });
    expect(background.every(element => element?.hasAttribute("inert"))).toBe(false);
    bodyPortal.remove();
    window.localStorage.removeItem(createIssueDraftStorageKey);
    await cleanup();
  });

  it("inerts the siblings of a dialog rendered without an app shell", async () => {
    window.localStorage.removeItem(createIssueDraftStorageKey);
    const { cleanup, container, root } = createReactTestRoot({ attachToDocument: true });
    await renderReactTestRoot(root, <>
        <div data-testid="neighbor">
          <button type="button">background control</button>
        </div>
        <CreateIssueDialog {...dialogProps} />
      </>);
    const neighbor = container.querySelector<HTMLElement>('[data-testid="neighbor"]');
    expect(neighbor?.hasAttribute("inert")).toBe(true);
    expect(container.querySelector(".issue-dialog")?.closest("[inert]")).toBeNull();
    await cleanup();
    expect(neighbor?.hasAttribute("inert")).toBe(false);
    window.localStorage.removeItem(createIssueDraftStorageKey);
  });

  it("keeps the header create button's accessible name on its visible text", async () => {
    const { cleanup, container, root } = createReactTestRoot({ attachToDocument: true });
    await renderReactTestRoot(root, <BoardCreateIssueButton onCreate={() => undefined} />);
    const button = container.querySelector<HTMLButtonElement>(".create-issue-button");
    expect(button).not.toBeNull();
    // No aria-label overriding the visible text: the name used to be
    // "Create issue" (dashboard.createIssue), which collided with the dialog's
    // submit button and misrouted Create issue refs to this header control.
    expect(button?.hasAttribute("aria-label")).toBe(false);
    expect(button?.textContent).toContain(ko["issue.newIssue"]);
    await cleanup();
  });
});
