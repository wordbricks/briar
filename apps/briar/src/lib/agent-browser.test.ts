import { describe, expect, it } from "vitest";
import { loadBrowserAutomationSettings } from "./agent-browser";

describe("browser automation settings", () => {
  it("defaults to agent-browser when no stored setting is available", async () => {
    await expect(loadBrowserAutomationSettings()).resolves.toEqual({
      provider: "agent-browser",
    });
  });
});
