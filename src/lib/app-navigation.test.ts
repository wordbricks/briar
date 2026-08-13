import { describe, expect, it } from "vitest";
import {
  issueNavigationLocation,
  pageFromNavigationLocation,
  runIdFromNavigationLocation,
} from "./app-navigation";

describe("app navigation locations", () => {
  it("keeps top-level pages unchanged", () => {
    expect(pageFromNavigationLocation("inbox")).toBe("inbox");
    expect(runIdFromNavigationLocation("inbox")).toBeNull();
  });

  it("stores and restores an issue detail location", () => {
    const location = issueNavigationLocation("run/with special:value");

    expect(location).toBe("issues/run%2Fwith%20special%3Avalue");
    expect(pageFromNavigationLocation(location)).toBe("issues");
    expect(runIdFromNavigationLocation(location)).toBe(
      "run/with special:value",
    );
  });

  it("does not expose an invalid encoded issue id", () => {
    expect(runIdFromNavigationLocation("issues/%E0%A4%A")).toBeNull();
  });
});
