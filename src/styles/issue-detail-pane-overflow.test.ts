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
      `${selector.replace(/[.*+?^${}()|[\\]\\]/g, "\\\\$&")}\\s*\\{([^}]*)\\}`,
    ),
  );
  expect(match, `expected CSS rule for ${selector}`).not.toBeNull();
  return match?.[1] ?? "";
};

describe("desktop issue detail pane height containment", () => {
  it("lets the content parent allocate its remaining height to the active pane", () => {
    const content = ruleBody(".run-page-content");
    const pane = ruleBody(".issue-description-pane");

    expect(content).toContain("display:flex");
    expect(content).toContain("flex-direction:column");
    expect(content).toContain("min-height:0");
    expect(pane).toContain("flex:1 1 auto");
    expect(pane).toContain("min-height:0");
  });

  it("keeps overflowing issue content inside its own vertical scroller", () => {
    const scroll = ruleBody(".issue-description-scroll");

    expect(scroll).toContain("flex:1");
    expect(scroll).toContain("overflow-y:auto");
  });
});
