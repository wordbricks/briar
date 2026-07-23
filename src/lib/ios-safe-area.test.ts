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
      "max(8px, calc(env(safe-area-inset-bottom, 0px) - 8px)) max(12px, env(safe-area-inset-left))",
    );
  });

  it("lets the queue scroll behind the lowered iOS chrome with end clearance", () => {
    expect(styles).toContain(
      ".platform-ios.companion-shell .dashboard-scroll { padding-bottom: 128px; }",
    );
    expect(styles).toMatch(
      /\.platform-ios \.companion-bottom-chrome \{[\s\S]*?background: transparent;/u,
    );
  });
});
