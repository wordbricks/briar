/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appZoomStorageKey,
  installAppZoomShortcuts,
} from "./app-zoom";

describe("app zoom shortcuts", () => {
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
});
