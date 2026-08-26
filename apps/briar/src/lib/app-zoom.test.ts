/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appZoomStorageKey,
  createAppZoomCommands,
  installAppZoomShortcuts,
} from "./app-zoom";

describe("app zoom", () => {
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.style.removeProperty("zoom");
  });

  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
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

  it("can share one initialized command object with the legacy adapter", () => {
    const setZoom = vi.fn();
    const commands = createAppZoomCommands(setZoom);
    uninstall = installAppZoomShortcuts(commands);

    expect(setZoom).toHaveBeenCalledOnce();
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        code: "Equal",
        key: "+",
        metaKey: true,
        repeat: true,
      }),
    );

    expect(commands.getZoom()).toBe(1.1);
    expect(setZoom).toHaveBeenCalledTimes(2);
  });

  it("changes and persists zoom with Command-plus and Command-minus", () => {
    const setZoom = vi.fn();
    uninstall = installAppZoomShortcuts(setZoom);
    expect(setZoom).toHaveBeenLastCalledWith(1);

    const zoomIn = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "Equal",
      key: "+",
      metaKey: true,
      shiftKey: true,
    });
    window.dispatchEvent(zoomIn);

    expect(zoomIn.defaultPrevented).toBe(true);
    expect(setZoom).toHaveBeenLastCalledWith(1.1);
    expect(window.localStorage.getItem(appZoomStorageKey)).toBe("1.1");

    const zoomOut = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "Minus",
      key: "-",
      metaKey: true,
    });
    window.dispatchEvent(zoomOut);

    expect(zoomOut.defaultPrevented).toBe(true);
    expect(setZoom).toHaveBeenLastCalledWith(1);
    expect(window.localStorage.getItem(appZoomStorageKey)).toBe("1");
  });

  it("restores a saved zoom level", () => {
    const setZoom = vi.fn();
    window.localStorage.setItem(appZoomStorageKey, "1.3");
    uninstall = installAppZoomShortcuts(setZoom);

    expect(setZoom).toHaveBeenCalledOnce();
    expect(setZoom).toHaveBeenCalledWith(1.3);
  });

  it("ignores shortcuts without Command and clamps the supported range", () => {
    const setZoom = vi.fn();
    uninstall = installAppZoomShortcuts(setZoom);

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        code: "Equal",
        key: "+",
      }),
    );
    expect(setZoom).toHaveBeenCalledOnce();

    for (let index = 0; index < 10; index += 1) {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          code: "Minus",
          key: "-",
          metaKey: true,
        }),
      );
    }

    expect(setZoom).toHaveBeenLastCalledWith(0.8);
    expect(setZoom).toHaveBeenCalledTimes(3);
    expect(window.localStorage.getItem(appZoomStorageKey)).toBe("0.8");
  });

  it.each([
    ["Equal code", { code: "Equal", key: "=" }, 1.1],
    ["numpad add code", { code: "NumpadAdd", key: "+" }, 1.1],
    ["plus key", { code: "Unidentified", key: "+" }, 1.1],
    ["Minus code", { code: "Minus", key: "-" }, 0.9],
    ["numpad subtract code", { code: "NumpadSubtract", key: "-" }, 0.9],
    ["unicode minus key", { code: "Unidentified", key: "−" }, 0.9],
  ])("preserves the %s shortcut variant", (_label, key, expectedZoom) => {
    const setZoom = vi.fn();
    uninstall = installAppZoomShortcuts(setZoom);
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ...key,
      metaKey: true,
    });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(setZoom).toHaveBeenLastCalledWith(expectedZoom);
  });
});
