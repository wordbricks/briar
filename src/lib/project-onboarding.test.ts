/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  hasDeferredProjectOnboarding,
  markProjectOnboardingDeferred,
  projectOnboardingDeferredStorageKey,
} from "./project-onboarding";

describe("project onboarding deferral", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("persists the choice per user", () => {
    markProjectOnboardingDeferred("user-1");

    expect(hasDeferredProjectOnboarding("user-1")).toBe(true);
    expect(hasDeferredProjectOnboarding("user-2")).toBe(false);
    expect(
      window.localStorage.getItem(
        `${projectOnboardingDeferredStorageKey}:user-1`,
      ),
    ).toBe("true");
  });

  it("keeps the current session usable when storage is unavailable", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("storage unavailable");
      });

    expect(() => markProjectOnboardingDeferred("user-1")).not.toThrow();
    setItem.mockRestore();
  });
});
