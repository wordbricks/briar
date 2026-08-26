/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { appZoomStorageKey, createAppZoomCommands } from "./app-zoom";

describe("app zoom commands", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.style.removeProperty("zoom");
  });

  it("initializes once and exposes synchronous repeatable commands", () => {
    window.localStorage.setItem(appZoomStorageKey, "1.2");
    const setZoom = vi.fn((_zoom: number) => new Promise<void>(() => {}));

    const commands = createAppZoomCommands(setZoom);

    expect(commands.getZoom()).toBe(1.2);
    expect(setZoom).toHaveBeenCalledOnce();
    expect(setZoom).toHaveBeenCalledWith(1.2);
    expect(commands.zoomIn()).toEqual({ changed: true, zoom: 1.3 });
    expect(commands.zoomIn()).toEqual({ changed: true, zoom: 1.4 });
    expect(commands.zoomIn()).toEqual({ changed: false, zoom: 1.4 });
    expect(commands.getZoom()).toBe(1.4);
    expect(setZoom.mock.calls.map(([zoom]) => zoom)).toEqual([
      1.2,
      1.3,
      1.4,
    ]);
    expect(window.localStorage.getItem(appZoomStorageKey)).toBe("1.4");
  });

  it("clamps repeated zoom-out commands and only applies actual changes", () => {
    const setZoom = vi.fn();
    const commands = createAppZoomCommands(setZoom);

    expect(commands.zoomOut()).toEqual({ changed: true, zoom: 0.9 });
    expect(commands.zoomOut()).toEqual({ changed: true, zoom: 0.8 });
    expect(commands.zoomOut()).toEqual({ changed: false, zoom: 0.8 });
    expect(setZoom.mock.calls.map(([zoom]) => zoom)).toEqual([1, 0.9, 0.8]);
    expect(window.localStorage.getItem(appZoomStorageKey)).toBe("0.8");
  });

  it("falls back to the default for an unsupported stored zoom", () => {
    window.localStorage.setItem(appZoomStorageKey, "7");
    const setZoom = vi.fn();

    const commands = createAppZoomCommands(setZoom);

    expect(commands.getZoom()).toBe(1);
    expect(setZoom).toHaveBeenCalledOnce();
    expect(setZoom).toHaveBeenCalledWith(1);
  });

  it("keeps command instances isolated instead of sharing module state", () => {
    window.localStorage.setItem(appZoomStorageKey, "1.2");
    const first = createAppZoomCommands(vi.fn());
    window.localStorage.setItem(appZoomStorageKey, "0.9");
    const second = createAppZoomCommands(vi.fn());

    expect(first.zoomIn()).toEqual({ changed: true, zoom: 1.3 });
    expect(second.zoomOut()).toEqual({ changed: true, zoom: 0.8 });
    expect(first.getZoom()).toBe(1.3);
    expect(second.getZoom()).toBe(0.8);
  });
});
