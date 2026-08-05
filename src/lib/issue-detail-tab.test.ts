import { describe, expect, it } from "vitest";
import { defaultIssueDetailTab } from "./issue-detail-tab";

describe("defaultIssueDetailTab", () => {
  it("opens completed and paused runs on the result tab", () => {
    expect(defaultIssueDetailTab("completed")).toBe("result");
    expect(defaultIssueDetailTab("paused")).toBe("result");
  });

  it("opens every other status on the issue description tab", () => {
    for (const status of [
      "backlog",
      "queued",
      "running",
      "blocked",
      "failed",
      "cancelled",
    ]) {
      expect(defaultIssueDetailTab(status)).toBe("description");
    }
  });
});
