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

describe("agent session execution log layout", () => {
  it("uses the shared work log list as the scrolling session timeline", () => {
    const timeline = ruleBody(
      ".auto-hunt-session-main-column .auto-hunt-agent-messages",
    );
    expect(timeline).toContain("flex:1");
    expect(timeline).toContain("min-height:0");
    expect(timeline).toContain("max-height:none");
  });
});
