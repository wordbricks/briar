import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const component = readFileSync(
  resolve("src", "components", "CompanionBottomNavigation.tsx"),
  "utf8",
);
const styles = readFileSync(resolve("src", "styles.css"), "utf8");

describe("companion bottom navigation styles", () => {
  it("keeps platform safe areas in Tailwind utilities", () => {
    expect(component).toContain("env(safe-area-inset-left)");
    expect(component).toContain("env(safe-area-inset-right)");
    expect(component).toContain("env(safe-area-inset-bottom)");
    expect(component).toContain("[.platform-ios_&]");
    expect(component).toContain("[.platform-android_&]");
  });

  it("keeps focus and touch feedback beside the interactive elements", () => {
    expect(component).toContain("active:scale-[.94]");
    expect(component).toContain("focus-visible:outline-2");
    expect(component).toContain("min-h-14");
    expect(component).toContain("[.platform-android_&]:min-h-[62px]");
  });

  it("removes the dedicated visual CSS while preserving layout exceptions", () => {
    expect(styles).not.toMatch(/(?:^|\n)\.companion-bottom-chrome\s*\{/u);
    expect(styles).not.toMatch(/(?:^|\n)\.companion-bottom-nav\s*\{/u);
    expect(styles).not.toMatch(/(?:^|\n)\.companion-fab\s*\{/u);
    expect(styles).toContain(
      ".companion-shell:has(.companion-channel-detail) .companion-bottom-chrome { display:none; }",
    );
    expect(styles).toContain("prefers-reduced-transparency: reduce");
  });
});
