import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const indexMarkup = readFileSync(
  new URL("../../index.html", import.meta.url),
  "utf8",
);

describe("iOS safe area layout", () => {
  it("allows the native shell to extend through the physical safe area", () => {
    expect(indexMarkup).toContain("viewport-fit=cover");
  });
});
