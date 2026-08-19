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

describe("issue markdown list presentation", () => {
  it("restores visible markers removed by the Tailwind base reset", () => {
    expect(ruleBody(".issue-description-markdown ul")).toContain(
      "list-style:disc",
    );
    expect(ruleBody(".issue-description-markdown ol")).toContain(
      "list-style:decimal",
    );
  });
});
