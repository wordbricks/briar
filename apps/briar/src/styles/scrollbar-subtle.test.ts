import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve("src", "styles.css"), "utf8");
const tokens = readFileSync(resolve("src", "styles", "tokens.css"), "utf8");
const settingsLayout = readFileSync(
  resolve("src", "components", "settings", "layout.tsx"),
  "utf8",
);

describe("subtle scrollbar design system", () => {
  it("defines light and dark semantic colors", () => {
    expect(tokens.match(/--scrollbar-track:/g)).toHaveLength(2);
    expect(tokens.match(/--scrollbar-thumb:/g)).toHaveLength(2);
    expect(tokens.match(/--scrollbar-thumb-hover:/g)).toHaveLength(2);
  });

  it("uses one shared thin, rounded, five-pixel scrollbar treatment", () => {
    expect(styles).toContain(".scrollbar-subtle,");
    expect(styles).toContain(
      "scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);",
    );
    expect(styles.match(/scrollbar-width:\s*thin/g)).toHaveLength(1);
    expect(styles).toContain("&::-webkit-scrollbar {");
    expect(styles).toContain("width: 5px;");
    expect(styles).toContain("height: 5px;");
    expect(styles).toContain("border-radius: 999px;");
    expect(styles).toContain("background: var(--scrollbar-thumb-hover);");
    expect(styles).not.toMatch(
      /::-webkit-scrollbar\s*\{[^}]*width:\s*6px/u,
    );
  });

  it("keeps system-colored thumbs visible in forced color mode", () => {
    expect(styles).toContain("@media (forced-colors: active)");
    expect(styles).toContain("scrollbar-color: ButtonText Canvas;");
    expect(styles).toContain("background: ButtonText;");
  });

  it("applies the utility to settings without duplicating arbitrary values", () => {
    expect(settingsLayout.match(/scrollbar-subtle/g)).toHaveLength(2);
    expect(settingsLayout).not.toContain("[scrollbar-color:");
    expect(settingsLayout).not.toContain("[scrollbar-width:");
    expect(settingsLayout).toContain("[scrollbar-gutter:stable]");
  });

  it("preserves intentional hidden horizontal scrollbar exceptions", () => {
    expect(styles).toMatch(/\.status-tabs \{[^}]+scrollbar-width:none;/u);
    expect(styles).toMatch(/\.inbox-filters \{[^}]+scrollbar-width:none;/u);
    expect(styles).toMatch(/\.issue-metadata-bar \{[^}]+scrollbar-width: none;/u);
  });
});
