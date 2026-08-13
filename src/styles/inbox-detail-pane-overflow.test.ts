import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  path.resolve(import.meta.dirname, "../styles.css"),
  "utf8",
);

const ruleBody = (selector: string) => {
  const match = styles.match(
    new RegExp(
      `${selector.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
    ),
  );
  expect(match, `expected CSS rule for ${selector}`).not.toBeNull();
  return match?.[1] ?? "";
};

describe("inbox issue detail pane overflow containment", () => {
  it("constrains the detail pane to the inbox layout instead of content height", () => {
    const inboxLayout = ruleBody(".inbox-layout");

    expect(inboxLayout).toContain("min-height:0");
    expect(inboxLayout).toContain("grid-template-rows:minmax(0,1fr)");
  });

  it("lets the nested issue page shrink so its result and conversation panes can scroll", () => {
    const detailPage = ruleBody(".inbox-detail-pane > .main-content");

    expect(detailPage).toContain("min-width:0");
    expect(detailPage).toContain("min-height:0");
    expect(detailPage).toContain("height:100%");
    expect(detailPage).toContain("overflow:hidden");
  });
});
