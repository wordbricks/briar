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

function ruleAfter(marker: string, selector: string) {
  const markerStart = styles.indexOf(marker);
  if (markerStart === -1) return "";
  const declarationStart = styles.indexOf(`${selector} {`, markerStart);
  if (declarationStart === -1) return "";
  const bodyStart = declarationStart + selector.length + 2;
  const bodyEnd = styles.indexOf("}", bodyStart);
  return bodyEnd === -1 ? "" : styles.slice(bodyStart, bodyEnd);
}

describe("kanban card layout", () => {
  it("keeps full titles and clamps descriptions to three lines", () => {
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
    expect(descriptionRule).toContain("display:-webkit-box");
    expect(descriptionRule).toContain("overflow:hidden");
    expect(descriptionRule).toContain("overflow-wrap:anywhere");
    expect(descriptionRule).toContain("-webkit-box-orient:vertical");
    expect(descriptionRule).toContain("-webkit-line-clamp:3");
  });

  it("keeps the active agent badge clear of the scroll edge and issue label", () => {
    const columnBodyRule = firstRule(".kanban-column > div");
    const badgeRule = firstRule(".kanban-card-agent-badge");
    const activeCardKickerRule = firstRule(
      ".kanban-card.has-agent .kanban-card-kicker",
    );

    expect(columnBodyRule).toContain("padding:10px");
    expect(columnBodyRule).toContain("gap:10px");
    expect(badgeRule).toContain("top:-9px");
    expect(badgeRule).toContain("right:-7px");
    expect(activeCardKickerRule).toContain("padding-right:34px");
  });

  it("truncates long assignee labels without widening the card", () => {
    const cardRule = firstRule(".kanban-card");
    const footerRule = ruleAfter(
      ".kanban-card-badges .kanban-priority {",
      ".kanban-card-footer",
    );
    const assigneeRule = firstRule(".kanban-card-footer small");

    expect(cardRule).toContain("min-width:0");
    expect(footerRule).toContain("min-width:0");
    expect(assigneeRule).toContain("min-width:0");
    expect(assigneeRule).toContain("overflow:hidden");
    expect(assigneeRule).toContain("flex:1 1 auto");
    expect(assigneeRule).toContain("text-overflow:ellipsis");
    expect(assigneeRule).toContain("white-space:nowrap");
  });

  it("stacks columns without horizontal scrolling on narrow screens", () => {
    const narrowScreenMarker = "@media (max-width:760px) { .sidebar";
    const boardRule = ruleAfter(narrowScreenMarker, ".kanban-board");
    const columnRule = ruleAfter(narrowScreenMarker, ".kanban-column");
    const columnBodyRule = ruleAfter(
      narrowScreenMarker,
      ".kanban-column > div",
    );

    expect(boardRule).toContain("grid-auto-flow:row");
    expect(boardRule).toContain("grid-auto-columns:auto");
    expect(boardRule).toContain("grid-auto-rows:max-content");
    expect(boardRule).toContain("grid-template-columns:minmax(0,1fr)");
    expect(boardRule).toContain("align-items:start");
    expect(boardRule).toContain("overflow-x:hidden");
    expect(boardRule).toContain("overflow-y:auto");
    expect(columnRule).toContain("height:auto");
    expect(columnBodyRule).toContain("overflow-y:visible");
  });
});
