import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  new URL("../styles.css", import.meta.url),
  "utf8",
);
const appSource = readFileSync(
  new URL("../App.tsx", import.meta.url),
  "utf8",
);

function firstRule(selector: string) {
  const declarationStart = styles.indexOf(`${selector} {`);
  if (declarationStart === -1) return "";
  const bodyStart = declarationStart + selector.length + 2;
  const bodyEnd = styles.indexOf("}", bodyStart);
  return bodyEnd === -1 ? "" : styles.slice(bodyStart, bodyEnd);
}

describe("mobile issue detail cardless layout", () => {
  it("shares the companion layout overrides across iOS and Android", () => {
    expect(appSource).toContain(
      "app-shell companion-shell platform-${mobilePlatform}",
    );
  });

  it("removes the result summary card chrome and inset spacing on mobile", () => {
    const rule = firstRule(
      ".companion-shell .run-result-panel .completed-issue-card",
    );

    expect(rule).toContain("padding:0");
    expect(rule).toContain("border:0");
    expect(rule).toContain("border-radius:0");
    expect(rule).toContain("background:transparent");
    expect(rule).toContain("box-shadow:none");
  });

  it("separates result screenshots without wrapping them in another card", () => {
    const rule = firstRule(".companion-shell .run-result-screenshots");

    expect(rule).toContain("padding:20px 0 0");
    expect(rule).toContain("border-width:1px 0 0");
    expect(rule).toContain("border-radius:0");
    expect(rule).toContain("background:transparent");
  });

  it("keeps desktop result cards unchanged", () => {
    const summaryRule = firstRule(".completed-issue-card");
    const screenshotsRule = firstRule(".run-result-screenshots");

    expect(summaryRule).toContain("border:1px solid");
    expect(summaryRule).toContain("border-radius:12px");
    expect(screenshotsRule).toContain("border:1px solid");
    expect(screenshotsRule).toContain("border-radius:12px");
  });
});
