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
    const titlebarRule = firstRule(".run-page-shell > .topbar");
    const backButtonRule = firstRule(".run-page-titlebar-back");

    expect(titlebarRule).toContain("height:40px");
    expect(titlebarRule).toContain("flex-basis:40px");
    expect(backButtonRule).toContain("height:28px");
  });

  it("fills the parent and keeps the properties rail compact", () => {
    const bodyRule = firstRule(".run-page-body");
    const layoutRule = firstRule(".run-page-layout");

    expect(bodyRule).toContain("width:100%");
    expect(bodyRule).not.toContain("1180px");
    expect(bodyRule).toContain("margin:0");
    expect(layoutRule).toContain(
      "grid-template-columns:minmax(0,1fr) minmax(220px,260px)",
    );
    expect(styles).toContain(
      "grid-template-columns:minmax(0,1fr) minmax(180px,220px)",
    );
    expect(styles).toContain(
      "grid-template-columns:minmax(0,1fr) minmax(150px,180px)",
    );
  });
});
