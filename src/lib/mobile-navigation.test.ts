import { describe, expect, it, vi } from "vitest";
import {
  isMobileBackSwipe,
  registerMobileBackHandler,
  requestMobileNavigationBack,
} from "./mobile-navigation";

describe("mobile navigation", () => {
  it("recognizes a quick right swipe that begins at the left edge", () => {
    expect(
      isMobileBackSwipe({
        elapsedMs: 320,
        endX: 116,
        endY: 132,
        startX: 18,
        startY: 110,
      }),
    ).toBe(true);
  });

  it("rejects swipes that start away from the edge or travel vertically", () => {
    expect(
      isMobileBackSwipe({
        elapsedMs: 250,
        endX: 148,
        endY: 105,
        startX: 48,
        startY: 100,
      }),
    ).toBe(false);
    expect(
      isMobileBackSwipe({
        elapsedMs: 250,
        endX: 104,
        endY: 190,
        startX: 12,
        startY: 100,
      }),
    ).toBe(false);
  });

  it("lets the highest-priority active surface handle back first", () => {
    const root = vi.fn(() => true);
    const detail = vi.fn(() => true);
    const unregisterRoot = registerMobileBackHandler(root, 0);
    const unregisterDetail = registerMobileBackHandler(detail, 100);

    expect(requestMobileNavigationBack()).toBe(true);
    expect(detail).toHaveBeenCalledOnce();
    expect(root).not.toHaveBeenCalled();

    unregisterDetail();
    expect(requestMobileNavigationBack()).toBe(true);
    expect(root).toHaveBeenCalledOnce();
    unregisterRoot();
  });
});
