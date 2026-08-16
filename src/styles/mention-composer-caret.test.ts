import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  path.resolve(import.meta.dirname, "../styles.css"),
  "utf8",
);

const ruleBodies = (selector: string) =>
  Array.from(
    styles.matchAll(
      new RegExp(
        `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
        "g",
      ),
    ),
    (match) => match[1] ?? "",
  );

const ruleBody = (selector: string) => {
  const bodies = ruleBodies(selector);
  expect(bodies, `expected CSS rule for ${selector}`).not.toHaveLength(0);
  return bodies[0] ?? "";
};

describe("mention composer caret alignment", () => {
  it("keeps mirrored mention text at the native control's font weight", () => {
    const messageMention = ruleBody(".conversation-mention-button");
    expect(messageMention).toContain("font-weight:650");
    expect(messageMention).toContain("margin:0 .18em 0 0");

    const composerMention = ruleBody(
      ".mention-composer-mirror .conversation-mention-button",
    );
    expect(composerMention).toContain("font-weight:inherit");
    expect(composerMention).toContain("padding:.06em .12em .06em .36em");
    expect(composerMention).toContain("margin:-.06em -.12em -.06em -.36em");
    expect(composerMention).toContain("color:var(--mention-foreground)");
    expect(composerMention).toContain("background:transparent");
  });

  it("uses the channel mirror to grow the textarea grid with wrapped content", () => {
    expect(ruleBody(".channel-composer-field")).toContain("display: grid");

    const mirrorRules = ruleBodies(
      ".channel-composer-field > .mention-composer-mirror",
    );
    expect(mirrorRules.some((rule) => rule.includes("grid-area: 1 / 1")))
      .toBe(true);
    expect(mirrorRules.some((rule) => rule.includes("position: relative")))
      .toBe(true);
    expect(mirrorRules.some((rule) => rule.includes("inset: auto"))).toBe(true);
  });
});
