/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest";
import {
  loadBrowserAutomationSettings,
  updateBrowserAutomationSettings,
} from "./agent-browser";

describe("browser automation settings", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to ego-browser without silently selecting a fallback", async () => {
    await expect(loadBrowserAutomationSettings()).resolves.toEqual({
      provider: "ego-browser",
    });
  });

  it("persists an explicit agent-browser selection", async () => {
    await updateBrowserAutomationSettings({ provider: "agent-browser" });

    await expect(loadBrowserAutomationSettings()).resolves.toEqual({
      provider: "agent-browser",
    });
  });
});
