/** @vitest-environment jsdom */

import { act } from "react";
import { BoardHarness } from "../../../test/board-harness";
import { createReactTestRoot, renderReactTestRoot } from "../../../test/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppKeyboardCommandProvider } from "@/hooks/appKeyboardCommands";
import { demoDashboard } from "@/lib/demo-data";
import { saveKeyboardNavigationPreferences } from "@/lib/keybindings";
import type { HuntRun } from "@/types";

const dashboardProps = {
  deletingIssueId: null,
  error: null,
  isCreatingIssue: false,
  isSidebarOpen: true,
  onCancelRun: async () => undefined,
  onCreateIssue: async () => undefined,
  onDeleteIssue: async () => undefined,
  onLoadAttachment: async () => new Blob(),
  onLoadIssueMessages: async () => [],
  onLoadRunEvidence: async () => [],
  onMoveRun: async () => undefined,
  onRetryRun: async () => undefined,
  onSendIssueMessage: async () => {
    throw new Error("not implemented in this test");
  },
  onUpdateIssue: async () => undefined,
  recoveringRunId: null,
  recoveryError: null,
  updatingIssueId: null,
};

function kanbanRun(
  id: string,
  runNumber: number,
  status: HuntRun["status"],
  workflowStage: string | null,
): HuntRun {
  return {
    ...demoDashboard.runs[0]!,
    id,
    runNumber,
    sourceKey: id,
    status,
    title: id,
    workflowStage,
  };
}

const backlogOne = kanbanRun("backlog-1", 101, "backlog", null);
const backlogTwo = kanbanRun("backlog-2", 102, "backlog", null);
const backlogThree = kanbanRun("backlog-3", 103, "backlog", null);
const queuedOne = kanbanRun("queued-1", 104, "queued", null);
const analyzingOne = kanbanRun("analyzing-1", 105, "running", "analyzing");
const analyzingTwo = kanbanRun("analyzing-2", 106, "running", "analyzing");
const runs = [
  backlogOne,
  backlogTwo,
  backlogThree,
  queuedOne,
  analyzingOne,
  analyzingTwo,
];

describe("Kanban card keyboard navigation", () => {
  let cleanup: () => Promise<void>;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createReactTestRoot>["root"];
  let onSelectedRunChange: ReturnType<typeof vi.fn<(runId: string | null) => void>>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    window.localStorage.clear();
    ({ cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    }));
    onSelectedRunChange = vi.fn();
  });

  afterEach(async () => {
    await cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  async function renderBoard(boardRuns: readonly HuntRun[] = runs) {
    await renderReactTestRoot(
      root,
      <AppKeyboardCommandProvider>
        <button data-testid="outside" type="button">Outside</button>
        <BoardHarness
          {...dashboardProps}
          dashboard={{ ...demoDashboard, runs: [...boardRuns] }}
          onSelectedRunChange={onSelectedRunChange}
          selectedRunId={null}
        />
      </AppKeyboardCommandProvider>,
    );
    onSelectedRunChange.mockClear();
  }

  function card(runId: string): HTMLDivElement {
    return container.querySelector<HTMLDivElement>(
      `.kanban-card[data-run-id="${runId}"]`,
    )!;
  }

  function outside(): HTMLButtonElement {
    return container.querySelector<HTMLButtonElement>("[data-testid='outside']")!;
  }

  async function focus(element: HTMLElement) {
    await act(async () => element.focus());
  }

  async function press(
    init: KeyboardEventInit,
    target: HTMLElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : document.body,
  ): Promise<KeyboardEvent> {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    await act(async () => target.dispatchEvent(event));
    return event;
  }

  it("navigates rows and adjacent visible card columns without opening issues", async () => {
    await renderBoard();
    const cards = runs.map(run => card(run.id));
    const syntheticClicks = cards.map(item => vi.spyOn(item, "click"));

    await focus(outside());
    expect(await press({ code: "KeyJ", key: "ㅓ" })).toHaveProperty(
      "defaultPrevented",
      true,
    );
    expect(document.activeElement).toBe(card(backlogOne.id));

    expect(await press({ code: "KeyJ", key: "ㅓ", repeat: true }))
      .toHaveProperty("defaultPrevented", true);
    expect(document.activeElement).toBe(card(backlogTwo.id));

    await focus(outside());
    await press({ code: "ArrowDown", key: "ArrowDown", repeat: true });
    expect(document.activeElement).toBe(card(backlogThree.id));

    await press({ code: "KeyL", key: "ㅣ" });
    expect(document.activeElement).toBe(card(queuedOne.id));
    await press({ code: "ArrowRight", key: "ArrowRight" });
    expect(document.activeElement).toBe(card(analyzingOne.id));
    await press({ code: "KeyJ", key: "ㅓ", repeat: true });
    expect(document.activeElement).toBe(card(analyzingTwo.id));
    await press({ code: "KeyH", key: "ㅗ" });
    expect(document.activeElement).toBe(card(queuedOne.id));
    await press({ code: "ArrowLeft", key: "ArrowLeft" });
    expect(document.activeElement).toBe(card(backlogOne.id));

    const clamped = await press({ code: "KeyK", key: "ㅏ" });
    expect(clamped.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(card(backlogOne.id));
    const horizontalEdge = await press({ code: "KeyH", key: "ㅗ" });
    expect(horizontalEdge.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(card(backlogOne.id));
    expect(card(backlogOne.id).getAttribute("data-keyboard-list-current")).toBe("");
    expect(onSelectedRunChange).not.toHaveBeenCalled();
    for (const click of syntheticClicks) expect(click).not.toHaveBeenCalled();
  });

  it("synchronizes the controlled cursor on focus and click while preserving activation", async () => {
    await renderBoard();

    await focus(card(backlogTwo.id));
    expect(card(backlogTwo.id).getAttribute("data-keyboard-list-current")).toBe("");
    await focus(outside());
    await press({ code: "KeyJ", key: "j" });
    expect(document.activeElement).toBe(card(backlogThree.id));
    expect(onSelectedRunChange).not.toHaveBeenCalled();

    onSelectedRunChange.mockClear();
    await act(async () => card(queuedOne.id).click());
    expect(card(queuedOne.id).getAttribute("data-keyboard-list-current")).toBe("");
    expect(onSelectedRunChange).toHaveBeenLastCalledWith(queuedOne.id);

    onSelectedRunChange.mockClear();
    await focus(card(analyzingOne.id));
    const enter = await press({ code: "Enter", key: "Enter" });
    expect(enter.defaultPrevented).toBe(true);
    expect(onSelectedRunChange).toHaveBeenLastCalledWith(analyzingOne.id);

    onSelectedRunChange.mockClear();
    await focus(card(analyzingTwo.id));
    const space = await press({ code: "Space", key: " " });
    expect(space.defaultPrevented).toBe(true);
    expect(onSelectedRunChange).toHaveBeenLastCalledWith(analyzingTwo.id);
  });

  it("tracks stable IDs through reorder and falls back after filtering", async () => {
    await renderBoard();
    await focus(card(backlogTwo.id));
    await focus(outside());

    await renderBoard([
      backlogThree,
      backlogTwo,
      backlogOne,
      queuedOne,
      analyzingOne,
      analyzingTwo,
    ]);
    await focus(outside());
    await press({ code: "KeyJ", key: "j" });
    expect(document.activeElement).toBe(card(backlogOne.id));
    expect(card(backlogOne.id).getAttribute("data-keyboard-list-current")).toBe("");

    await renderBoard([backlogThree, queuedOne, analyzingOne]);
    await focus(outside());
    await press({ code: "KeyJ", key: "j" });
    expect(document.activeElement).toBe(card(backlogThree.id));
    expect(card(backlogThree.id).getAttribute("data-keyboard-list-current")).toBe("");
    expect(onSelectedRunChange).not.toHaveBeenCalled();
  });

  it("leaves movement unhandled when the board has no cards", async () => {
    await renderBoard([]);
    await focus(outside());

    const event = await press({ code: "KeyJ", key: "j" });
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(outside());
    expect(onSelectedRunChange).not.toHaveBeenCalled();
  });

  it("respects live navigation preferences and open overlay ownership", async () => {
    saveKeyboardNavigationPreferences({ sequenceShortcutsEnabled: false });
    await renderBoard();
    await focus(outside());

    const disabled = await press({ code: "KeyJ", key: "j" });
    expect(disabled.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(outside());

    saveKeyboardNavigationPreferences({ sequenceShortcutsEnabled: true });
    const enabled = await press({ code: "KeyJ", key: "j" });
    expect(enabled.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(card(backlogOne.id));

    const menu = document.createElement("div");
    const menuItem = document.createElement("button");
    menu.setAttribute("role", "menu");
    menu.append(menuItem);
    document.body.append(menu);
    try {
      await focus(menuItem);
      const ownedByMenu = await press({ code: "KeyJ", key: "j" });
      expect(ownedByMenu.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(menuItem);
    } finally {
      menu.remove();
    }
  });
});
