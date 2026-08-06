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
  it("uses a slim translucent scrollbar inside desktop columns", () => {
    const columnScrollbarRule = ruleAfter(
      ".kanban-column > div { scrollbar-width",
      ".kanban-column > div",
    );
    const webkitScrollbarRule = firstRule(
      ".kanban-column > div::-webkit-scrollbar",
    );
    const webkitTrackRule = firstRule(
      ".kanban-column > div::-webkit-scrollbar-track",
    );
    const webkitThumbRule = firstRule(
      ".kanban-column > div::-webkit-scrollbar-thumb",
    );

    expect(columnScrollbarRule).toContain("scrollbar-width:thin");
    expect(columnScrollbarRule).toContain(
      "scrollbar-color:rgba(82,83,77,.18) transparent",
    );
    expect(webkitScrollbarRule).toContain("width:6px");
    expect(webkitTrackRule).toContain("background:transparent");
    expect(webkitThumbRule).toContain("background:rgba(82,83,77,.18)");
  });

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

  it("keeps assignee badges inside the card as circular badges", () => {
    const columnBodyRule = firstRule(".kanban-column > div");
    const badgeGroupRule = firstRule(".kanban-card-assignee-badges");
    const assignedCardKickerRule = firstRule(
      ".kanban-card.has-assignees .kanban-card-kicker",
    );
    const multipleAssigneesKickerRule = firstRule(
      ".kanban-card.has-multiple-assignees .kanban-card-kicker",
    );

    expect(columnBodyRule).toContain("padding:10px");
    expect(columnBodyRule).toContain("gap:10px");
    expect(badgeGroupRule).toContain("top:10px");
    expect(badgeGroupRule).toContain("right:10px");
    expect(badgeGroupRule).not.toContain("top:-");
    expect(badgeGroupRule).not.toContain("right:-");
    expect(badgeGroupRule).toContain("display:flex");
    expect(styles).toContain(
      ".kanban-card-assignee-badges > span { width:22px; height:22px;",
    );
    expect(firstRule(".kanban-card-assignee-badges > span")).toContain(
      "border-radius:50%",
    );
    expect(firstRule(".kanban-card-agent-badge .project-agent-avatar")).toContain(
      "border-radius:50%",
    );
    expect(firstRule(".kanban-card-agent-badge")).toContain(
      "position:relative",
    );
    expect(
      firstRule(".kanban-card-provider-badge"),
    ).toContain("position:absolute");
    expect(firstRule(".kanban-card-provider-badge")).toContain(
      "border-radius:50%",
    );
    expect(firstRule(".kanban-card-worker-badge .worker-icon")).toContain(
      "border-radius:50%",
    );
    expect(assignedCardKickerRule).toContain("padding-right:22px");
    expect(multipleAssigneesKickerRule).toContain("padding-right:39px");
  });

  it("fills the human assignee avatar to the badge without padding", () => {
    // Must beat `.kanban-card-badges > i:not(.status-pill)` (0,2,1) which sets
    // padding:0 7px; a weaker `.kanban-card-badges .kanban-assignee` override
    // loses and clips the avatar inside the fixed-size badge.
    const assigneeBadgeRule = firstRule(".kanban-card-badges > i.kanban-assignee");
    const assigneeAvatarRule = firstRule(".kanban-assignee .issue-assignee-avatar");
    const genericBadgeRule = firstRule(".kanban-card-badges > i:not(.status-pill)");

    expect(styles).not.toContain(".kanban-card-badges .kanban-assignee {");
    expect(assigneeBadgeRule).toContain("width:22px");
    expect(assigneeBadgeRule).toContain("height:22px");
    expect(assigneeBadgeRule).toContain("padding:0");
    expect(assigneeBadgeRule).not.toContain("padding:0 7px");
    expect(assigneeBadgeRule).not.toContain("padding:2px");
    expect(assigneeBadgeRule).toContain("overflow:hidden");
    expect(genericBadgeRule).toContain("padding:0 7px");
    expect(assigneeAvatarRule).toContain("width:100%");
    expect(assigneeAvatarRule).toContain("height:100%");
    expect(assigneeAvatarRule).toContain("border-radius:inherit");
    expect(assigneeAvatarRule).not.toContain("width:16px");
    expect(assigneeAvatarRule).not.toContain("border-radius:50%");
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

  it("constrains desktop columns to the board height so each column scrolls", () => {
    const boardRule = firstRule(".kanban-board");
    const columnBodyRule = firstRule(".kanban-column > div");

    expect(boardRule).toContain("grid-auto-rows:minmax(0,1fr)");
    expect(boardRule).toContain("overflow-x:auto");
    expect(boardRule).toContain("overflow-y:hidden");
    expect(columnBodyRule).toContain("overflow-y:auto");
    expect(columnBodyRule).toContain("flex:1");
    expect(columnBodyRule).toContain("min-height:0");
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
    expect(columnBodyRule).toContain("overflow-y:auto");
    expect(columnBodyRule).toContain("max-height:min(50vh,420px)");
  });
});
