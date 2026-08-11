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

describe("mention composer caret alignment", () => {
  it("keeps mirrored mention text at the native control's font weight", () => {
    const messageMention = ruleBody(".conversation-mention-button");
    expect(messageMention).toContain("font-weight:650");

    const composerMention = ruleBody(
      ".mention-composer-mirror .conversation-mention-button",
    );
    expect(composerMention).toContain("font-weight:inherit");
    expect(composerMention).toContain("margin:-.06em -.36em");
  });
});
