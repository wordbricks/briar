import { describe, expect, it } from "vitest";
import {
  createNavigationHistory,
  reduceNavigationHistory,
} from "./useNavigationHistory";

describe("navigation history", () => {
  it("moves backward and forward through visited destinations", () => {
    let history = createNavigationHistory("issues");
    history = reduceNavigationHistory(history, {
      type: "navigate",
      value: "inbox",
    });
    history = reduceNavigationHistory(history, {
      type: "navigate",
      value: "auto-hunt",
    });
    history = reduceNavigationHistory(history, { type: "back" });

    expect(history.entries[history.index]).toBe("inbox");

    history = reduceNavigationHistory(history, { type: "forward" });
    expect(history.entries[history.index]).toBe("auto-hunt");
  });

  it("drops forward history after navigating from a previous destination", () => {
    let history = createNavigationHistory("issues");
    history = reduceNavigationHistory(history, {
      type: "navigate",
      value: "inbox",
    });
    history = reduceNavigationHistory(history, {
      type: "navigate",
      value: "auto-hunt",
    });
    history = reduceNavigationHistory(history, { type: "back" });
    history = reduceNavigationHistory(history, {
      type: "navigate",
      value: "project-settings",
    });

    expect(history.entries).toEqual([
      "issues",
      "inbox",
      "project-settings",
    ]);
    expect(history.index).toBe(2);
  });

  it("does not add consecutive duplicate destinations", () => {
    const initial = createNavigationHistory("issues");
    const history = reduceNavigationHistory(initial, {
      type: "navigate",
      value: "issues",
    });

    expect(history).toBe(initial);
  });
});
