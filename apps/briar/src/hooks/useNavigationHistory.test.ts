import { describe, expect, it } from "vitest";
import {
  createNavigationHistory,
  maxNavigationHistoryEntries,
  reduceNavigationHistory,
} from "./useNavigationHistory";
import {
  channelNavigationLocation,
  issueNavigationLocation,
} from "../lib/app-navigation";

describe("navigation history", () => {
  it("moves backward and forward through visited destinations", () => {
    let history = createNavigationHistory<string>("issues");
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
    let history = createNavigationHistory<string>("issues");
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
    const initial = createNavigationHistory<string>("issues");
    const history = reduceNavigationHistory(initial, {
      type: "navigate",
      value: "issues",
    });

    expect(history).toBe(initial);
  });

  it("restores the issue list and each previously viewed issue", () => {
    let history = createNavigationHistory<string>("issues");
    const firstIssue = issueNavigationLocation("project-a", "run-a");
    const secondIssue = issueNavigationLocation("project-a", "run-b");
    history = reduceNavigationHistory(history, {
      type: "navigate",
      value: firstIssue,
    });
    history = reduceNavigationHistory(history, {
      type: "navigate",
      value: secondIssue,
    });

    history = reduceNavigationHistory(history, { type: "back" });
    expect(history.entries[history.index]).toBe(firstIssue);

    history = reduceNavigationHistory(history, { type: "back" });
    expect(history.entries[history.index]).toBe("issues");

    history = reduceNavigationHistory(history, { type: "forward" });
    expect(history.entries[history.index]).toBe(firstIssue);
  });

  it("restores each channel and direct message in exact visit order", () => {
    const destinations = [
      issueNavigationLocation("project-a", "run-a"),
      channelNavigationLocation(
        "channels",
        "organization-a",
        "channel-a",
        "project-a",
      ),
      channelNavigationLocation(
        "channels",
        "organization-a",
        "channel-b",
        "project-a",
      ),
      channelNavigationLocation(
        "dms",
        "organization-a",
        "dm-a",
        "project-a",
      ),
      issueNavigationLocation("project-b", "run-b"),
    ];
    let history = createNavigationHistory<string>("issues");
    for (const value of destinations) {
      history = reduceNavigationHistory(history, { type: "navigate", value });
    }

    for (const value of [...destinations].reverse().slice(1)) {
      history = reduceNavigationHistory(history, { type: "back" });
      expect(history.entries[history.index]).toBe(value);
    }
    expect(history.entries[history.index]).toBe(destinations[0]);

    history = reduceNavigationHistory(history, { type: "back" });
    expect(history.entries[history.index]).toBe("issues");
    for (const value of destinations) {
      history = reduceNavigationHistory(history, { type: "forward" });
      expect(history.entries[history.index]).toBe(value);
    }
  });

  it("replaces an unavailable destination without creating a new visit", () => {
    const unavailable = channelNavigationLocation(
      "channels",
      "organization-a",
      "deleted",
    );
    const fallback = channelNavigationLocation(
      "channels",
      "organization-a",
      "general",
    );
    let history = createNavigationHistory<string>("issues");
    history = reduceNavigationHistory(history, {
      type: "navigate",
      value: unavailable,
    });
    history = reduceNavigationHistory(history, {
      type: "replace",
      value: fallback,
    });

    expect(history.entries).toEqual(["issues", fallback]);
    expect(history.index).toBe(1);
  });

  it("collapses neighboring duplicates created by replacement", () => {
    let history = createNavigationHistory<string>("a");
    history = reduceNavigationHistory(history, {
      type: "navigate",
      value: "b",
    });
    history = reduceNavigationHistory(history, {
      type: "navigate",
      value: "c",
    });
    history = reduceNavigationHistory(history, { type: "back" });
    history = reduceNavigationHistory(history, {
      type: "replace",
      value: "c",
    });

    expect(history).toEqual({ entries: ["a", "c"], index: 1 });

    history = reduceNavigationHistory(history, {
      type: "navigate",
      value: "b",
    });
    history = reduceNavigationHistory(history, {
      type: "replace",
      value: "c",
    });

    expect(history).toEqual({ entries: ["a", "c"], index: 1 });
  });

  it("keeps only the most recent bounded visit history", () => {
    let history = createNavigationHistory<string>("page-0");
    for (let index = 1; index <= maxNavigationHistoryEntries + 10; index += 1) {
      history = reduceNavigationHistory(history, {
        type: "navigate",
        value: `page-${index}`,
      });
    }

    expect(history.entries).toHaveLength(maxNavigationHistoryEntries);
    expect(history.entries[0]).toBe("page-11");
    expect(history.entries[history.index]).toBe(
      `page-${maxNavigationHistoryEntries + 10}`,
    );
  });
});
