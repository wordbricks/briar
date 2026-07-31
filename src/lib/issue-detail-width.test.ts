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

  it("fills the parent and keeps the value-only properties rail compact", () => {
    const bodyRule = firstRule(".run-page-body");
    const layoutRule = firstRule(".run-page-layout");
    const propertiesRule = firstRule(".run-properties");
    const propertiesHeadingRule = firstRule(".run-properties h2");
    const propertyRule = firstRule(".run-property");
    const propertyIconRule = firstRule(".run-property-icon");
    const propertyCopyRule = firstRule(".run-property-copy strong");
    const statusControlRule = firstRule(
      ".run-properties .run-status-control",
    );
    const nativeStatusSelectRule = firstRule(
      ".run-properties .run-status-control select",
    );
    const statusSelectRule = firstRule(
      ".run-properties .run-status-select .select-menu-trigger",
    );
    const statusErrorRule = firstRule(".run-properties .run-status-error");

    expect(bodyRule).toContain("width:100%");
    expect(bodyRule).not.toContain("1180px");
    expect(bodyRule).toContain("margin:0");
    expect(layoutRule).toContain(
      "grid-template-columns:minmax(0,1fr) minmax(210px,240px)",
    );
    expect(layoutRule).toContain("gap:20px");
    expect(styles).toContain(
      "grid-template-columns:minmax(0,1fr) minmax(190px,215px)",
    );
    expect(styles).toContain(
      "grid-template-columns:minmax(0,1fr) minmax(180px,195px)",
    );
    expect(propertiesRule).toContain("padding:4px 4px 18px 18px");
    expect(propertiesHeadingRule).toContain("font-size:var(--text-base)");
    expect(propertyRule).toContain("min-height:40px");
    expect(propertyRule).toContain("grid-template-columns:24px minmax(0,1fr)");
    expect(propertyIconRule).toContain("width:24px");
    expect(propertyIconRule).toContain("height:24px");
    expect(propertyCopyRule).toContain("font-size:var(--text-sm)");
    expect(statusControlRule).toContain(
      "grid-template-columns:24px minmax(0,1fr) 14px",
    );
    expect(nativeStatusSelectRule).toContain("font-size:var(--text-sm)");
    expect(statusSelectRule).toContain("font-size:var(--text-sm)");
    expect(statusErrorRule).toContain("margin:0 0 4px 34px");
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
