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
  it("aligns the issue title in a dedicated titlebar", () => {
    const topbarRule = firstRule(".topbar");
    const runTitlebarRule = firstRule(".run-page-shell > .topbar");
    const backButtonRule = firstRule(".run-page-titlebar-back");
    const numberRule = firstRule(".run-page-window-number");
    const titleRule = firstRule(".run-page-window-title");

    expect(topbarRule).toContain("height: 30px");
    expect(topbarRule).toContain("flex: 0 0 30px");
    expect(runTitlebarRule).toContain("height:48px");
    expect(runTitlebarRule).toContain("flex:0 0 48px");
    expect(runTitlebarRule).toContain("gap:10px");
    expect(backButtonRule).toContain("height:28px");
    expect(numberRule).toContain("var(--text-sm)");
    expect(titleRule).toContain("var(--text-lg)");
    expect(titleRule).toContain("line-height:1.25");
  });

  it("fills the parent and gives the properties rail room to align labels", () => {
    const bodyRule = firstRule(".run-page-body");
    const layoutRule = firstRule(".run-page-layout");
    const propertiesRule = firstRule(".run-properties");
    const propertyRule = firstRule(".run-property");
    const propertyIconRule = firstRule(".run-property-icon");
    const statusControlRule = firstRule(
      ".run-properties .run-status-control",
    );
    const statusErrorRule = firstRule(".run-properties .run-status-error");

    expect(bodyRule).toContain("width:100%");
    expect(bodyRule).not.toContain("1180px");
    expect(bodyRule).toContain("margin:0");
    expect(layoutRule).toContain(
      "grid-template-columns:minmax(0,1fr) minmax(280px,320px)",
    );
    expect(layoutRule).toContain("gap:28px");
    expect(styles).toContain(
      "grid-template-columns:minmax(0,1fr) minmax(260px,300px)",
    );
    expect(styles).toContain(
      "grid-template-columns:minmax(0,1fr) minmax(220px,240px)",
    );
    expect(propertiesRule).toContain("padding:4px 8px 18px 26px");
    expect(propertyRule).toContain("min-height:53px");
    expect(propertyRule).toContain("grid-template-columns:36px minmax(0,1fr)");
    expect(propertyIconRule).toContain("width:36px");
    expect(propertyIconRule).toContain("height:36px");
    expect(statusControlRule).toContain(
      "grid-template-columns:36px minmax(0,1fr) 16px",
    );
    expect(statusErrorRule).toContain("margin:0 0 4px 50px");
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
