import { describe, expect, it } from "vitest";
import { ideaIssuePlanItemsSchema } from "./ideas-contract";

const item = (key: string, prerequisiteKeys: string[] = []) => ({
  key,
  title: `Issue ${key}`,
  description: `Implement ${key}`,
  priority: null,
  provider: null,
  model: null,
  effort: null,
  prerequisiteKeys,
});

describe("idea issue plan contract", () => {
  it("accepts one to five issues with an acyclic dependency graph", () => {
    expect(
      ideaIssuePlanItemsSchema.parse([
        item("foundation"),
        item("api", ["foundation"]),
        item("ui", ["api"]),
      ]),
    ).toHaveLength(3);
  });

  it("rejects external, self, duplicate, and cyclic dependencies", () => {
    expect(() =>
      ideaIssuePlanItemsSchema.parse([item("ui", ["missing"])]),
    ).toThrow(/this plan/iu);
    expect(() =>
      ideaIssuePlanItemsSchema.parse([item("ui", ["ui"])]),
    ).toThrow(/itself/iu);
    expect(() =>
      ideaIssuePlanItemsSchema.parse([item("same"), item("same")]),
    ).toThrow(/unique/iu);
    expect(() =>
      ideaIssuePlanItemsSchema.parse([item("a", ["b"]), item("b", ["a"])]),
    ).toThrow(/acyclic/iu);
  });

  it("enforces the one-to-five issue boundary", () => {
    expect(() => ideaIssuePlanItemsSchema.parse([])).toThrow();
    expect(() =>
      ideaIssuePlanItemsSchema.parse(
        Array.from({ length: 6 }, (_, index) => item(`issue-${index}`)),
      ),
    ).toThrow();
  });
});
