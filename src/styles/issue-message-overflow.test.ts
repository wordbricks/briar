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
      `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
    ),
  );
  expect(match, `expected CSS rule for ${selector}`).not.toBeNull();
  return match?.[1] ?? "";
};

describe("issue conversation message overflow containment", () => {
  it("keeps the message list and body within the conversation pane width", () => {
    const list = ruleBody(".issue-message-list");
    expect(list).toContain("min-width:0");
    expect(list).toContain("overflow-x:hidden");
    expect(list).toContain("overflow-y:auto");

    const group = ruleBody(".issue-message-group");
    expect(group).toContain("min-width:0");
    expect(group).toContain("max-width:100%");

    const message = ruleBody(".issue-message");
    expect(message).toContain("min-width:0");
    expect(message).toContain("max-width:100%");
    expect(message).toContain("grid-template-columns:34px minmax(0,1fr)");

    const body = ruleBody(".issue-message-body");
    expect(body).toContain("min-width:0");
    expect(body).toContain("max-width:100%");
    expect(body).toContain("overflow-wrap:anywhere");

    const pre = ruleBody(".issue-message-body pre");
    expect(pre).toContain("max-width:100%");
    expect(pre).toContain("overflow-x:auto");

    const table = ruleBody(".issue-message-body table");
    expect(table).toContain("max-width:100%");
    expect(table).toContain("overflow-x:auto");

    const paragraph = ruleBody(".issue-message-body p");
    expect(paragraph).toContain("overflow-wrap:anywhere");
    expect(paragraph).toContain("white-space:pre-wrap");
  });
});
