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

  it("pins the thread layer to the viewport", () => {
    const layerRule = firstRule(".issue-thread-layer");
    const drawerRule = firstRule(".issue-thread-drawer");

    expect(layerRule).toContain("position:fixed");
    expect(layerRule).toContain("inset:0");
    expect(drawerRule).toContain("margin-left:auto");
    expect(drawerRule).toContain("50vw");
  });

  it("keeps hover actions out of the message flow", () => {
    const messageRule = firstRule(".issue-message");
    const actionsRule = firstRule(".issue-message-actions");

    expect(messageRule).toContain("position:relative");
    expect(messageRule).toContain("padding:6px 10px");
    expect(actionsRule).toContain("position:absolute");
    expect(actionsRule).toContain("opacity:0");
    expect(actionsRule).toContain("pointer-events:none");
    expect(styles).toContain(
      ".issue-message:hover .issue-message-actions,.issue-message:focus-within .issue-message-actions",
    );
  });

  it("makes the existing thread summary a full-width click target", () => {
    const summaryRule = firstRule(".issue-thread-summary");

    expect(summaryRule).toContain("width:100%");
    expect(summaryRule).toContain("min-height:38px");
    expect(summaryRule).toContain("display:flex");
  });
});
