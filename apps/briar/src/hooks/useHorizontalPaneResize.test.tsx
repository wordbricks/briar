/** @vitest-environment jsdom */

import { act } from "react";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHorizontalPaneResize } from "./useHorizontalPaneResize";

const min = 30;
const max = 65;
const clamp = (value: number) =>
  Math.min(max, Math.max(min, Math.round(value)));
const cssVariable = "--test-pane-width";

function Probe({
  load,
  save,
}: {
  load: () => number | null;
  save: (width: number) => void;
}) {
  const resize = useHorizontalPaneResize({
    clamp,
    cssVariable,
    defaultWidth: 40,
    load,
    max,
    min,
    save,
  });

  return (
    <div
      data-resizing={String(resize.isResizing)}
      data-width={resize.width ?? ""}
      ref={resize.containerRef}
    >
      <div
        aria-orientation="vertical"
        aria-valuemax={max}
        aria-valuemin={min}
        aria-valuenow={resize.effectiveWidth}
        role="separator"
        tabIndex={0}
        {...resize.separatorProps}
      />
    </div>
  );
}

function pointerEvent(
  type: "pointercancel" | "pointerdown" | "pointermove" | "pointerup",
  pointerId: number,
  clientX: number,
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
  });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  return event;
}

describe("useHorizontalPaneResize", () => {
  let frame = 0;
  let pendingFrames: Map<number, FrameRequestCallback>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    pendingFrames = new Map();
    frame = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(
      (callback) => {
        const id = ++frame;
        pendingFrames.set(id, callback);
        return id;
      },
    );
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      pendingFrames.delete(id);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const flushFrames = async () => {
    await act(async () => {
      const callbacks = [...pendingFrames.values()];
      pendingFrames.clear();
      for (const callback of callbacks) callback(0);
      await Promise.resolve();
    });
  };

  it("tracks one captured pointer, calculates a right-edge percentage, and persists on finish", async () => {
    const { cleanup, container, root } = createReactTestRoot();
    const save = vi.fn();
    await renderReactTestRoot(root, <Probe load={() => null} save={save} />);

    const layout = container.firstElementChild as HTMLDivElement;
    const separator = layout.firstElementChild as HTMLDivElement;
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    Object.defineProperties(separator, {
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: releasePointerCapture },
      setPointerCapture: { configurable: true, value: setPointerCapture },
    });
    vi.spyOn(layout, "getBoundingClientRect").mockReturnValue({
      bottom: 100,
      height: 100,
      left: 0,
      right: 1_000,
      top: 0,
      width: 1_000,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const down = pointerEvent("pointerdown", 7, 600);
    await act(async () => separator.dispatchEvent(down));
    expect(setPointerCapture).toHaveBeenCalledWith(7);
    expect(down.defaultPrevented).toBe(true);
    expect(layout.dataset.resizing).toBe("true");

    await act(async () =>
      separator.dispatchEvent(pointerEvent("pointermove", 8, 100)),
    );
    expect(pendingFrames.size).toBe(0);
    expect(layout.dataset.width).toBe("");

    await act(async () =>
      separator.dispatchEvent(pointerEvent("pointermove", 7, 530)),
    );
    // A pointermove only queues a frame; it must not touch React state (no
    // re-render, no persistence) until the drag ends.
    expect(pendingFrames.size).toBe(1);
    expect(layout.dataset.width).toBe("");
    expect(separator.getAttribute("aria-valuenow")).toBe("40");
    expect(layout.style.getPropertyValue(cssVariable)).toBe("");
    expect(save).not.toHaveBeenCalled();

    await flushFrames();
    // The coalesced frame writes the CSS variable directly to the DOM…
    expect(layout.style.getPropertyValue(cssVariable)).toBe("47%");
    // …still without touching React state.
    expect(layout.dataset.width).toBe("");
    expect(separator.getAttribute("aria-valuenow")).toBe("40");
    expect(save).not.toHaveBeenCalled();

    await act(async () =>
      separator.dispatchEvent(pointerEvent("pointerup", 7, 530)),
    );
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    expect(layout.dataset.resizing).toBe("false");
    // pointerup commits exactly once: React state updates and the width is
    // persisted.
    expect(layout.dataset.width).toBe("47");
    expect(separator.getAttribute("aria-valuenow")).toBe("47");
    expect(layout.style.getPropertyValue(cssVariable)).toBe("47%");
    expect(save).toHaveBeenLastCalledWith(47);

    await act(async () =>
      separator.dispatchEvent(pointerEvent("pointerdown", 9, 530)),
    );
    await act(async () =>
      separator.dispatchEvent(pointerEvent("pointermove", 9, 900)),
    );
    await flushFrames();
    expect(layout.dataset.width).toBe("47");
    expect(layout.style.getPropertyValue(cssVariable)).toBe("30%");
    await act(async () =>
      separator.dispatchEvent(pointerEvent("pointercancel", 9, 900)),
    );
    expect(layout.dataset.resizing).toBe("false");
    expect(layout.dataset.width).toBe("30");
    expect(save).toHaveBeenLastCalledWith(30);

    await cleanup();
  });

  it("flushes a pending frame synchronously when the drag ends before the next animation frame", async () => {
    const { cleanup, container, root } = createReactTestRoot();
    const save = vi.fn();
    await renderReactTestRoot(root, <Probe load={() => null} save={save} />);

    const layout = container.firstElementChild as HTMLDivElement;
    const separator = layout.firstElementChild as HTMLDivElement;
    Object.defineProperties(separator, {
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
      setPointerCapture: { configurable: true, value: vi.fn() },
    });
    vi.spyOn(layout, "getBoundingClientRect").mockReturnValue({
      bottom: 100,
      height: 100,
      left: 0,
      right: 1_000,
      top: 0,
      width: 1_000,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    await act(async () =>
      separator.dispatchEvent(pointerEvent("pointerdown", 7, 600)),
    );
    await act(async () =>
      separator.dispatchEvent(pointerEvent("pointermove", 7, 530)),
    );
    expect(pendingFrames.size).toBe(1);

    // pointerup arrives before the browser ever ran the queued frame — a
    // pointerup is not synchronized to animation frames, so this is the
    // common case, not an edge case.
    await act(async () =>
      separator.dispatchEvent(pointerEvent("pointerup", 7, 530)),
    );

    // The final pointer position is still applied and committed...
    expect(layout.dataset.width).toBe("47");
    expect(layout.style.getPropertyValue(cssVariable)).toBe("47%");
    expect(save).toHaveBeenLastCalledWith(47);
    // ...and the now-redundant queued frame is dropped rather than firing
    // (and re-applying the same value) later.
    expect(pendingFrames.size).toBe(0);

    await cleanup();
  });

  it("writes the CSS variable for a persisted width and leaves it unset otherwise", async () => {
    const unset = createReactTestRoot();
    await renderReactTestRoot(
      unset.root,
      <Probe load={() => null} save={vi.fn()} />,
    );
    const layoutWithoutWidth = unset.container.firstElementChild as HTMLDivElement;
    expect(layoutWithoutWidth.style.getPropertyValue(cssVariable)).toBe("");
    await unset.cleanup();

    const persisted = createReactTestRoot();
    await renderReactTestRoot(
      persisted.root,
      <Probe load={() => 48} save={vi.fn()} />,
    );
    const layoutWithWidth = persisted.container.firstElementChild as HTMLDivElement;
    expect(layoutWithWidth.style.getPropertyValue(cssVariable)).toBe("48%");
    await persisted.cleanup();
  });

  it("moves by five points with arrows and clamps Home and End to the bounds", async () => {
    const { cleanup, container, root } = createReactTestRoot();
    const save = vi.fn();
    await renderReactTestRoot(root, <Probe load={() => null} save={save} />);
    const separator = container.querySelector<HTMLElement>(
      '[role="separator"]',
    )!;
    const layout = container.firstElementChild as HTMLDivElement;

    const press = async (key: string) => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key,
      });
      await act(async () => separator.dispatchEvent(event));
      return event;
    };

    expect(separator.getAttribute("aria-valuenow")).toBe("40");
    expect((await press("ArrowLeft")).defaultPrevented).toBe(true);
    expect(separator.getAttribute("aria-valuenow")).toBe("35");
    expect(layout.style.getPropertyValue(cssVariable)).toBe("35%");
    await press("ArrowRight");
    expect(separator.getAttribute("aria-valuenow")).toBe("40");
    await press("Home");
    await press("ArrowLeft");
    expect(separator.getAttribute("aria-valuenow")).toBe("30");
    await press("End");
    await press("ArrowRight");
    expect(separator.getAttribute("aria-valuenow")).toBe("65");
    expect(layout.style.getPropertyValue(cssVariable)).toBe("65%");
    expect(save.mock.calls.map(([width]) => width)).toEqual([
      35, 40, 30, 30, 65, 65,
    ]);

    const ignored = await press("PageDown");
    expect(ignored.defaultPrevented).toBe(false);
    expect(save).toHaveBeenCalledTimes(6);

    await cleanup();
  });

  it("restores a persisted width before the first interaction", async () => {
    const { cleanup, container, root } = createReactTestRoot();
    const load = vi.fn(() => 48);
    const save = vi.fn();
    await renderReactTestRoot(root, <Probe load={load} save={save} />);

    const separator = container.querySelector<HTMLElement>(
      '[role="separator"]',
    )!;
    expect(load).toHaveBeenCalledOnce();
    expect(separator.getAttribute("aria-valuenow")).toBe("48");

    await act(async () =>
      separator.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "ArrowRight",
        }),
      ),
    );
    expect(save).toHaveBeenCalledWith(53);

    await cleanup();
  });
});
