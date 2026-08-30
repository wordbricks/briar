import { describe, expect, it } from "vitest";
import { dashboardListPatch } from "./app-connect-dashboard";

describe("app Dashboard Connect adapter", () => {
  it("distinguishes an omitted list patch from a present empty list", () => {
    expect(dashboardListPatch(null, String)).toBeUndefined();
    expect(dashboardListPatch([], String)).toEqual({ values: [] });
    expect(dashboardListPatch([1, 2], String)).toEqual({
      values: ["1", "2"],
    });
  });
});
