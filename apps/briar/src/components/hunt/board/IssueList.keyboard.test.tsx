/** @vitest-environment jsdom */

import { act, type ComponentProps } from "react";
import { createReactTestRoot, renderReactTestRoot } from "../../../test/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppKeyboardCommandProvider } from "@/hooks/appKeyboardCommands";
import { demoDashboard } from "@/lib/demo-data";
import type { HuntRun } from "@/types";
import { IssueList } from "./IssueList";

const noop = () => undefined;
const baseProps = {
  availableProviders: [],
  deletingIssueId: null,
  members: demoDashboard.members ?? [],
  onCheckpointsChange: noop,
  onDelete: noop,
  onEdit: noop,
  onMove: noop,
  onPreferencesChange: noop,
  onPriorityChange: noop,
  processingIssueIds: new Set<string>(),
  updatingIssueId: null
} satisfies Omit<ComponentProps<typeof IssueList>, "onOpen" | "runs">;

describe("IssueList keyboard navigation", () => {
  let cleanup: () => Promise<void>;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createReactTestRoot>["root"];
  let onOpen: ReturnType<typeof vi.fn<(runId: string) => void>>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    window.localStorage.clear();
    ({ cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    }));
    onOpen = vi.fn();
  });

  afterEach(async () => {
    await cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  async function renderList(runs: readonly HuntRun[]) {
    await renderReactTestRoot(
      root,
      <AppKeyboardCommandProvider>
        <button data-testid="outside" type="button">Outside</button>
        <IssueList {...baseProps} onOpen={onOpen} runs={[...runs]} />
      </AppKeyboardCommandProvider>,
    );
  }

  function row(runId: string): HTMLDivElement {
    return container.querySelector<HTMLDivElement>(
      `.issue-list-row[data-run-id="${runId}"]`
    )!;
  }

  function outside(): HTMLButtonElement {
    return container.querySelector<HTMLButtonElement>(
      '[data-testid="outside"]'
    )!;
  }

  async function press(
    init: KeyboardEventInit,
    target: HTMLElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : document.body
  ): Promise<KeyboardEvent> {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ...init
    });
    await act(async () => {
      target.dispatchEvent(event);
    });
    return event;
  }

  it("moves from outside focus with physical J/K and arrows without opening", async () => {
    const runs = demoDashboard.runs.slice(0, 3);
    await renderList(runs);
    const rows = runs.map(run => row(run.id));
    const syntheticClicks = rows.map(item => vi.spyOn(item, "click"));

    await act(async () => outside().focus());
    expect(await press({ code: "KeyJ", key: "ㅓ" })).toHaveProperty(
      "defaultPrevented",
      true
    );
    expect(document.activeElement).toBe(rows[0]);

    expect(await press({
      code: "ArrowDown",
      key: "ArrowDown",
      repeat: true
    })).toHaveProperty("defaultPrevented", true);
    expect(document.activeElement).toBe(rows[1]);

    await press({ code: "KeyJ", key: "ㅓ", repeat: true });
    expect(document.activeElement).toBe(rows[2]);
    await press({ code: "KeyK", key: "ㅏ" });
    expect(document.activeElement).toBe(rows[1]);
    await press({ code: "ArrowUp", key: "ArrowUp" });
    expect(document.activeElement).toBe(rows[0]);

    expect(row(runs[0]!.id).getAttribute("data-keyboard-list-current")).toBe("");
    expect(onOpen).not.toHaveBeenCalled();
    for (const click of syntheticClicks) expect(click).not.toHaveBeenCalled();
    expect(container.querySelector('[role="table"]')).not.toBeNull();
    expect(container.querySelectorAll('.issue-list-row[role="row"]')).toHaveLength(3);
    expect(container.querySelectorAll('.issue-list-row [role="cell"]')).toHaveLength(12);
  });

  it("passes empty and unsupported vertical-list commands", async () => {
    await renderList([]);
    await act(async () => outside().focus());

    expect(await press({ code: "KeyJ", key: "j" })).toHaveProperty(
      "defaultPrevented",
      false
    );
    expect(document.activeElement).toBe(outside());

    await renderList(demoDashboard.runs.slice(0, 2));
    await act(async () => outside().focus());
    expect(await press({ code: "KeyH", key: "h" })).toHaveProperty(
      "defaultPrevented",
      false
    );
    expect(await press({ code: "ArrowRight", key: "ArrowRight" }))
      .toHaveProperty("defaultPrevented", false);
    expect(document.activeElement).toBe(outside());
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("uses stable IDs after reorder and falls back to a visible selection after filtering", async () => {
    const [first, second, third] = demoDashboard.runs.slice(0, 3) as [
      HuntRun,
      HuntRun,
      HuntRun
    ];
    await renderList([first, second, third]);

    await act(async () => row(second.id).click());
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(second.id);
    await act(async () => outside().focus());
    await press({ code: "KeyJ", key: "j" });
    expect(document.activeElement).toBe(row(third.id));

    await renderList([third, first, second]);
    await press({ code: "KeyJ", key: "j" }, outside());
    expect(document.activeElement).toBe(row(first.id));

    await renderList([third, second]);
    await press({ code: "KeyK", key: "k" }, outside());
    expect(document.activeElement).toBe(row(third.id));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("clamps and refocuses at boundaries without a synthetic click or open", async () => {
    const runs = demoDashboard.runs.slice(0, 2);
    await renderList(runs);
    await act(async () => outside().focus());
    await press({ code: "KeyK", key: "k" });
    const last = row(runs[1]!.id);
    expect(document.activeElement).toBe(last);

    const click = vi.spyOn(last, "click");
    await act(async () => outside().focus());
    const boundary = await press({ code: "KeyJ", key: "j", repeat: true });

    expect(boundary.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    expect(onOpen).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it("activates a focused row exactly once for Enter or Space", async () => {
    const runs = demoDashboard.runs.slice(0, 2);
    await renderList(runs);
    const second = row(runs[1]!.id);
    const click = vi.spyOn(second, "click");
    await act(async () => second.focus());

    expect(await press({ code: "Enter", key: "Enter" }, second))
      .toHaveProperty("defaultPrevented", true);
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(runs[1]!.id);
    expect(click).not.toHaveBeenCalled();

    onOpen.mockClear();
    expect(await press({ code: "Space", key: " " }, second))
      .toHaveProperty("defaultPrevented", true);
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(runs[1]!.id);
    expect(click).not.toHaveBeenCalled();
  });

  it("synchronizes the cursor from pointer, focus, and click interactions", async () => {
    const runs = demoDashboard.runs.slice(0, 3);
    await renderList(runs);

    await act(async () => {
      row(runs[1]!.id).dispatchEvent(new MouseEvent("pointerdown", {
        bubbles: true
      }));
    });
    await act(async () => outside().focus());
    await press({ code: "KeyJ", key: "j" });
    expect(document.activeElement).toBe(row(runs[2]!.id));

    await act(async () => row(runs[0]!.id).focus());
    await act(async () => outside().focus());
    await press({ code: "KeyJ", key: "j" });
    expect(document.activeElement).toBe(row(runs[1]!.id));

    await act(async () => row(runs[2]!.id).click());
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(runs[2]!.id);
    await act(async () => outside().focus());
    await press({ code: "KeyK", key: "k" });
    expect(document.activeElement).toBe(row(runs[1]!.id));
  });
});
