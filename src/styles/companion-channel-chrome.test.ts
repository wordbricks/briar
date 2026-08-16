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

describe("companion channel chrome", () => {
  it("presents channel identity as a floating capsule", () => {
    const identity = ruleBody(".companion-channel-bar-identity");
    expect(identity).toContain("border-radius:27px");
    expect(identity).toContain("backdrop-filter:blur(22px)");
    expect(identity).toContain("box-shadow:");
  });

  it("keeps composer controls in one continuous pill surface", () => {
    const composer = ruleBody(".companion-channel-composer");
    expect(composer).toContain("border-radius:27px");
    expect(composer).toContain("background:color-mix");
    expect(composer).toContain("padding:6px");

    const addButton = ruleBody(".companion-channel-composer-add");
    expect(addButton).toContain("border-radius:50%");
    expect(addButton).toContain("background:color-mix");
  });

  it("anchors the latest-message control above the composer", () => {
    const region = ruleBody(".conversation-scroll-region");
    expect(region).toContain("position:relative");
    expect(region).toContain("flex:1");

    const button = ruleBody(".conversation-scroll-to-bottom");
    expect(button).toContain("position:absolute");
    expect(button).toContain("bottom:12px");
    expect(button).toContain("border-radius:50%");
  });

  it("keeps the mobile issue conversation scrollable above its composer", () => {
    const panel = ruleBody(
      ".companion-shell .issue-conversation-tab-panel",
    );
    expect(panel).toContain("height:min(560px,calc(100dvh - 160px))");

    const conversation = ruleBody(".companion-shell .issue-conversation");
    expect(conversation).toContain("height:100%");
    expect(conversation).toContain("min-height:0");
  });
});
