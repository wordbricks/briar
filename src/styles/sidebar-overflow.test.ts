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

describe("project sidebar overflow containment", () => {
  it("keeps horizontal overflow from becoming a second scrollbar", () => {
    const projectList = ruleBody(".sidebar-project-list");
    const channelButton = ruleBody(".sidebar-channel-list button");

    expect(projectList).toContain("overflow-x: hidden");
    expect(projectList).toContain("overflow-y: auto");
    expect(channelButton).toContain("min-width:0");
  });
});
