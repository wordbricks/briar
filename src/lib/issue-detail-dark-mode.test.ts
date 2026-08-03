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

describe("issue detail dark mode", () => {
  it("uses theme surfaces and readable text throughout the detail layout", () => {
    expect(firstRule(".run-page > header")).toContain(
      "background:var(--card)",
    );
    expect(firstRule(".issue-description-markdown")).toContain(
      "color:var(--foreground)",
    );
    expect(firstRule(".run-properties h2")).toContain(
      "color:var(--foreground)",
    );
    expect(firstRule(".run-property-copy strong")).toContain(
      "color:var(--foreground)",
    );
  });

  it("keeps recovery states legible without a light-only alert card", () => {
    const recoveryRule = firstRule(".recovery-panel");
    const pausedRecoveryRule = firstRule(".recovery-panel.paused");

    expect(recoveryRule).toContain("var(--destructive)");
    expect(recoveryRule).toContain("var(--card)");
    expect(pausedRecoveryRule).toContain("var(--warning)");
    expect(pausedRecoveryRule).toContain("var(--card)");
    expect(firstRule(".recovery-panel.paused > div:first-child")).toContain(
      "color:var(--warning)",
    );
    expect(firstRule(".recovery-panel strong")).toContain(
      "color:var(--foreground)",
    );
  });

  it("uses theme-aware borders and controls for the conversation", () => {
    expect(firstRule(".issue-content-divider::before")).toContain(
      "background:var(--border)",
    );
    expect(firstRule(".issue-message-empty")).toContain(
      "border:1px dashed var(--border)",
    );
    expect(firstRule(".issue-message-composer")).toContain(
      "border:1px solid var(--border)",
    );
    expect(firstRule(".issue-message-composer textarea")).toContain(
      "color:var(--foreground)",
    );
    expect(firstRule(".issue-message-replies")).toContain(
      "border-left:1px solid var(--border)",
    );
  });

  it("keeps status history timeline text readable in the detail tab", () => {
    expect(firstRule(".issue-status-history-panel")).toContain(
      "overflow-y:auto",
    );
    expect(firstRule(".issue-activity-history .timeline-event strong em")).toContain(
      "color:var(--muted-foreground)",
    );
    expect(firstRule(".issue-activity-empty")).toContain(
      "color:var(--muted-foreground)",
    );
  });
});
