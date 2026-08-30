import { describe, expect, it } from "vitest";
import { decodeInboxReadVersions } from "./inbox-contract";

describe("API response contracts", () => {
  it("validates inbox read-state record keys and values", () => {
    expect(decodeInboxReadVersions({ issue: "v2" })).toEqual({ issue: "v2" });
    expect(() => decodeInboxReadVersions({ "": "v2" })).toThrow();
    expect(() => decodeInboxReadVersions({ issue: "" })).toThrow();
  });
});
