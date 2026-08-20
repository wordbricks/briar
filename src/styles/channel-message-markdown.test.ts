import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  path.resolve(import.meta.dirname, "../styles.css"),
  "utf8",
);

const ruleBody = (selector: string) => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  expect(match, `expected CSS rule for ${selector}`).not.toBeNull();
  return (match?.[1] ?? "").replace(/\s+/g, "");
};

describe("shared markdown presentation", () => {
  it("keeps links and inline code visually distinct", () => {
    const link = ruleBody(".markdown-content a:not(.conversation-mention-button)");
    expect(link).toContain("text-decoration:underline");
    expect(link).toContain("text-underline-offset:2px");

    const inlineCode = ruleBody(".markdown-content code");
    expect(inlineCode).toContain("padding:.14em.38em");
    expect(inlineCode).toContain("border:1pxsolidvar(--border)");
    expect(inlineCode).toContain("background:var(--accent)");
  });

  it("contains long code and tables inside independently scrollable surfaces", () => {
    const pre = ruleBody(".markdown-content pre");
    expect(pre).toContain("max-width:100%");
    expect(pre).toContain("overflow-x:auto");
    expect(pre).toContain("padding:12px14px");

    const code = ruleBody(".markdown-content pre code");
    expect(code).toContain("min-width:max-content");
    expect(code).toContain("white-space:pre");

    const tableWrap = ruleBody(".markdown-table-wrap");
    expect(tableWrap).toContain("max-width:100%");
    expect(tableWrap).toContain("overflow-x:auto");

    const table = ruleBody(".markdown-table-wrap table");
    expect(table).toContain("width:max-content");
    expect(table).toContain("min-width:100%");
  });

  it("gives lists and blockquotes readable spacing and hierarchy", () => {
    const unorderedList = ruleBody(".markdown-content ul");
    expect(unorderedList).toContain("margin:.65em0");
    expect(unorderedList).toContain("padding-left:1.65em");
    expect(unorderedList).toContain("list-style:disc");

    const orderedList = ruleBody(".markdown-content ol");
    expect(orderedList).toContain("padding-left:1.65em");
    expect(orderedList).toContain("list-style:decimal");

    const quote = ruleBody(".markdown-content blockquote");
    expect(quote).toContain("border-left:3pxsolidvar(--accent-foreground)");
    expect(quote).toContain("background:color-mix(");
  });
});
