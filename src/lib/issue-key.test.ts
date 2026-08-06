import { describe, expect, it } from "vitest";

import {
  formatIssueKey,
  isIssueKeyPrefix,
  normalizeIssueKeyPrefix,
} from "./issue-key";

describe("issue keys", () => {
  it("normalizes project prefixes and formats issue keys", () => {
    expect(normalizeIssueKeyPrefix(" br ")).toBe("BR");
    expect(formatIssueKey("BR", 42)).toBe("BR-42");
  });

  it("accepts one to three ASCII letters or numbers", () => {
    expect(isIssueKeyPrefix("B1")).toBe(true);
    expect(isIssueKeyPrefix("LONG")).toBe(false);
    expect(isIssueKeyPrefix("B-R")).toBe(false);
  });

  it("falls back to the legacy AH prefix for missing or invalid data", () => {
    expect(formatIssueKey(undefined, 7)).toBe("AH-7");
    expect(formatIssueKey("invalid", 7)).toBe("AH-7");
  });
});
