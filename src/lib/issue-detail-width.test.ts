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

describe("issue detail width", () => {
  it("keeps the issue titlebar only slightly taller than its contents", () => {
    const topbarRule = firstRule(".topbar");
    const runTitlebarRule = firstRule(".run-page-shell > .topbar");
    const backButtonRule = firstRule(".run-page-titlebar-back");

    expect(topbarRule).toContain("height: 30px");
    expect(topbarRule).toContain("flex: 0 0 30px");
    expect(runTitlebarRule).toContain("gap:10px");
    expect(backButtonRule).toContain("height:24px");
  });

  it("fills the parent and keeps the properties rail compact", () => {
    const bodyRule = firstRule(".run-page-body");
    const layoutRule = firstRule(".run-page-layout");

    expect(bodyRule).toContain("width:100%");
    expect(bodyRule).not.toContain("1180px");
    expect(bodyRule).toContain("margin:0");
    expect(layoutRule).toContain(
      "grid-template-columns:minmax(0,1fr) minmax(180px,220px)",
    );
    expect(layoutRule).toContain("gap:28px");
    expect(styles).toContain(
      "grid-template-columns:minmax(0,1fr) minmax(165px,195px)",
    );
    expect(styles).toContain(
      "grid-template-columns:minmax(0,1fr) minmax(145px,170px)",
    );
  });

  it("uses the full content width without a description card", () => {
    const contentRule = firstRule(".run-page-content");
    const descriptionRule = firstRule(".issue-description-pane");
    const dividerRule = firstRule(".issue-content-divider");

    expect(contentRule).toContain("width:100%");
    expect(descriptionRule).toContain("width:100%");
    expect(descriptionRule).not.toContain("border:");
    expect(descriptionRule).not.toContain("background:");
    expect(dividerRule).toContain("cursor:row-resize");
    expect(dividerRule).toContain("touch-action:none");
  });
});
