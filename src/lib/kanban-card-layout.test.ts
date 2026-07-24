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

describe("kanban card layout", () => {
  it("lets desktop cards grow to fit all title and description content", () => {
    const columnBodyRule = firstRule(".kanban-column > div");
    const cardRule = firstRule(".kanban-card");
    const titleRule = firstRule(".kanban-card-copy > strong");
    const descriptionRule = firstRule(".kanban-card-copy > span");

    expect(columnBodyRule).toContain("grid-auto-rows:max-content");
    expect(cardRule).toContain("min-height:0");
    expect(cardRule).not.toContain("min-height:126px");
    expect(titleRule).not.toContain("line-clamp");
    expect(titleRule).not.toContain("overflow:hidden");
    expect(titleRule).toContain("overflow-wrap:anywhere");
    expect(descriptionRule).not.toContain("line-clamp");
    expect(descriptionRule).not.toContain("overflow:hidden");
    expect(descriptionRule).toContain("overflow-wrap:anywhere");
  });
});
