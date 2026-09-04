import { describe, expect, it } from "vitest";
import {
  clampSidebarWidth,
  sidebarWidthDefault,
  sidebarWidthMax,
  sidebarWidthMin,
} from "./sidebar-width";

describe("sidebar-width", () => {
  it("has expected default, min, and max limits", () => {
    expect(sidebarWidthDefault).toBe(252);
    expect(sidebarWidthMin).toBe(200);
    expect(sidebarWidthMax).toBe(480);
  });

  it("clamps values correctly", () => {
    expect(clampSidebarWidth(150)).toBe(200);
    expect(clampSidebarWidth(252)).toBe(252);
    expect(clampSidebarWidth(320)).toBe(320);
    expect(clampSidebarWidth(600)).toBe(480);
  });
});
