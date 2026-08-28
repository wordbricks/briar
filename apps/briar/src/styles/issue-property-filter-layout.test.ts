import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve("src", "styles.css"), "utf8");

describe("issue property filter option layout", () => {
  it("keeps option labels in the flexible second grid column", () => {
    expect(styles).toMatch(
      /\.issue-property-filter-choice\s*\{[^}]*grid-template-columns:18px minmax\(0,1fr\);[^}]*\}/u,
    );
    expect(styles).toMatch(
      /\.issue-property-filter-choice-label\s*\{[^}]*grid-column:2;[^}]*\}/u,
    );
  });

  it("only truncates option labels after they use the available width", () => {
    expect(styles).toMatch(
      /\.issue-property-filter-choice-label\s*\{[^}]*min-width:0;[^}]*overflow:hidden;[^}]*text-overflow:ellipsis;[^}]*white-space:nowrap;[^}]*\}/u,
    );
  });
});
