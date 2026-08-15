/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearFirstRunTutorialPending,
  firstRunTutorialPendingStorageKey,
  hasPendingFirstRunTutorial,
  markFirstRunTutorialPending,
  shouldShowFirstOrganizationSetup,
} from "./project-onboarding";

describe("first-run tutorial state", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("persists the choice per user", () => {
    markFirstRunTutorialPending("user-1");

    expect(hasPendingFirstRunTutorial("user-1")).toBe(true);
    expect(hasPendingFirstRunTutorial("user-2")).toBe(false);
    expect(
      window.localStorage.getItem(
        `${firstRunTutorialPendingStorageKey}:user-1`,
      ),
    ).toBe("true");

    clearFirstRunTutorialPending("user-1");
    expect(hasPendingFirstRunTutorial("user-1")).toBe(false);
  });

  it("keeps the current session usable when storage is unavailable", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("storage unavailable");
      });

    expect(() => markFirstRunTutorialPending("user-1")).not.toThrow();
    setItem.mockRestore();
  });
});

describe("first organization setup routing", () => {
  const baseState = {
    hasUser: true,
    organizationCount: 0,
    projectCount: 0,
    remoteMode: false,
  };

  it("asks for an organization only after login when the account has none", () => {
    expect(shouldShowFirstOrganizationSetup(baseState)).toBe(true);
    expect(
      shouldShowFirstOrganizationSetup({ ...baseState, hasUser: false }),
    ).toBe(false);
  });

  it("opens the app directly for an existing organization or project", () => {
    expect(
      shouldShowFirstOrganizationSetup({
        ...baseState,
        organizationCount: 1,
      }),
    ).toBe(false);
    expect(
      shouldShowFirstOrganizationSetup({ ...baseState, projectCount: 1 }),
    ).toBe(false);
  });
});
