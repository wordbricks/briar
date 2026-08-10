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
  it("keeps each message at its content height inside the scrolling timeline", () => {
    const timeline = ruleBody(".auto-hunt-session-execution-timeline");
    expect(timeline).toContain("overflow-y:auto");
    expect(timeline).toContain("flex-direction:column");

    const message = ruleBody(
      ".auto-hunt-session-execution-timeline .auto-hunt-agent-message",
    );
    expect(message).toContain("flex:0 0 auto");
  });
});
