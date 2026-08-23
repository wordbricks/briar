import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve("src", "styles.css"), "utf8");
const darkStyles = readFileSync(resolve("src", "styles", "dark.css"), "utf8");
const tokens = readFileSync(resolve("src", "styles", "tokens.css"), "utf8");

describe("sidebar frosted glass styles", () => {
  it("defines translucent and opaque surfaces for both themes", () => {
    expect(tokens.match(/--sidebar: rgba\([^;]+\);/g)).toHaveLength(2);
    expect(tokens.match(/--sidebar-fallback: #[0-9a-f]+;/gi)).toHaveLength(2);
    expect(tokens.match(/--sidebar-glass-highlight: rgba\([^;]+\);/g)).toHaveLength(
      2,
    );
    expect(tokens.match(/--sidebar-border-strong: #[0-9a-f]+;/gi)).toHaveLength(
      2,
    );
  });

  it("uses the opaque fallback unless backdrop blur is supported", () => {
    expect(styles).toContain("background:var(--sidebar-fallback)");
    expect(styles).toContain(
      "@supports ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px)))",
    );
    expect(styles).toContain("var(--sidebar-glass-highlight)");
    expect(styles).toContain("backdrop-filter:blur(24px) saturate(155%)");
    expect(styles).toContain("-webkit-backdrop-filter:blur(24px) saturate(155%)");
  });

  it("uses the themed opaque surface for accessibility preferences", () => {
    const reducedTransparency = styles.match(
      /@media \(prefers-reduced-transparency: reduce\) \{[^\n]+\}/,
    )?.[0];
    const increasedContrast = styles.match(
      /@media \(prefers-contrast: more\) \{[^\n]+\}/,
    )?.[0];

    expect(reducedTransparency).toContain(
      ".sidebar { background:var(--sidebar-fallback); }",
    );
    expect(increasedContrast).toContain(
      "background:var(--sidebar-fallback); backdrop-filter:none; -webkit-backdrop-filter:none",
    );
  });

  it("does not bypass feature detection with a dark-mode background override", () => {
    const darkSidebarRule = darkStyles.match(/\.dark \.sidebar \{[^}]+\}/)?.[0];

    expect(darkSidebarRule).toBeDefined();
    expect(darkSidebarRule).not.toContain("background:");
  });
});
