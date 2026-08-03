import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  new URL("../styles.css", import.meta.url),
  "utf8",
);

function firstRule(selector: string) {
  const declarationStart = styles.indexOf(`${selector} {`);
  if (declarationStart === -1) return "";
  const bodyStart = declarationStart + selector.length + 2;
  const bodyEnd = styles.indexOf("}", bodyStart);
  return bodyEnd === -1 ? "" : styles.slice(bodyStart, bodyEnd);
}

describe("issue conversation layout", () => {
  it("keeps the comment composer compact", () => {
    expect(firstRule(".issue-message-composer textarea")).toContain(
      "min-height:68px",
    );
  });

  it("keeps mention suggestions and the composer visible in short panels", () => {
    const messageListRule = firstRule(".issue-message-list");
    const composerRule = firstRule(".issue-message-composer");

    expect(messageListRule).toContain("margin:0 8px");
    expect(
      firstRule(
        ".issue-message-list::before,.issue-message-list::after",
      ),
    ).toContain('content:""');
    expect(styles).toContain(".issue-message-list::after { height:12px; }");
    expect(composerRule).toContain("z-index:1");
    expect(composerRule).toContain("overflow:visible");
  });

  it("keeps replies at the same visual level as root messages", () => {
    const parentQuoteRule = firstRule(".issue-message-parent-quote");
    const composerRule = firstRule(".issue-inline-reply-composer");
    const agentStateRule = firstRule(
      ".issue-message-group > .issue-agent-reply-state",
    );

    expect(styles).not.toContain(".issue-message-replies");
    expect(parentQuoteRule).toContain("display:flex");
    expect(parentQuoteRule).toContain("border-radius:8px");
    expect(composerRule).toContain("margin:7px 10px 7px 54px");
    expect(agentStateRule).toContain("margin-left:54px");
  });

  it("keeps hover actions out of the message flow", () => {
    const messageRule = firstRule(".issue-message");
    const actionsRule = firstRule(".issue-message-actions");

    expect(messageRule).toContain("position:relative");
    expect(messageRule).toContain("padding:6px 10px");
    expect(actionsRule).toContain("position:absolute");
    expect(actionsRule).toContain("top:4px");
    expect(actionsRule).toContain("opacity:0");
    expect(actionsRule).toContain("pointer-events:none");
    expect(styles).toContain(
      ".issue-message:hover .issue-message-actions,.issue-message:focus-within .issue-message-actions",
    );
  });

  it("uses a compact composer for an inline reply", () => {
    expect(firstRule(".issue-message-composer.compact")).toContain(
      "box-shadow:0 4px 14px",
    );
    expect(
      firstRule(".issue-inline-reply-composer .issue-message-composer textarea"),
    ).toContain("min-height:52px");
  });
});
