import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const darkStyles = readFileSync(
  path.resolve(import.meta.dirname, "dark.css"),
  "utf8",
);

describe("inbox dark mode", () => {
  it("uses dark theme surfaces for the filter toolbar and controls", () => {
    expect(darkStyles).toMatch(
      /\.dark \.inbox-filter-bar\s*{[^}]*border-color: var\(--border\);[^}]*background: var\(--card\);/,
    );
    expect(darkStyles).toMatch(
      /\.dark \.inbox-filter-bar > span\s*{[^}]*color: var\(--muted-foreground\);/,
    );
    expect(darkStyles).toMatch(
      /\.dark \.inbox-project-filter\.select-menu \.select-menu-trigger,[\s\S]*?\.dark \.inbox-filter\s*{[^}]*border-color: var\(--input\);[^}]*background: var\(--secondary\);/,
    );
  });

  it("keeps active category filters meaningful without light surfaces", () => {
    expect(darkStyles).toMatch(
      /\.dark \.inbox-filter\[aria-pressed="true"\]\.urgent\s*{[^}]*var\(--destructive\)/,
    );
    expect(darkStyles).toMatch(
      /\.dark \.inbox-filter\[aria-pressed="true"\]\.action_required\s*{[^}]*var\(--warning\)/,
    );
    expect(darkStyles).toMatch(
      /\.dark \.inbox-filter\[aria-pressed="true"\]\.important\s*{[^}]*var\(--primary\)/,
    );
    expect(darkStyles).toMatch(
      /\.dark \.inbox-filter\[aria-pressed="true"\]\.activity\s*{[^}]*background: var\(--secondary\);/,
    );
  });
});
