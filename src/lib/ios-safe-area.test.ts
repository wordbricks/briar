import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const indexMarkup = readFileSync(
  new URL("../../index.html", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../styles.css", import.meta.url),
  "utf8",
);

describe("iOS safe area layout", () => {
  it("extends the viewport and bottom chrome through the physical safe area", () => {
    expect(indexMarkup).toContain("viewport-fit=cover");
    expect(styles).toContain(
      "max(8px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left))",
    );
  });
});
