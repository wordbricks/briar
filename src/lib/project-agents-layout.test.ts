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

describe("project agents layout", () => {
  it("keeps the shared page heading compact and full width", () => {
    expect(styles).toContain(
      ".project-agents-content { min-height:100%; padding:0 0 54px; }",
    );
    expect(styles).toContain(
      ".page-header.app-page-header {\n  height:48px;\n  min-height:48px;\n  flex:0 0 48px;\n  padding:0 22px;",
    );
    expect(styles).toContain(
      ".page-header.app-page-header .page-header-description {\n  display:none;",
    );
    expect(styles).toContain(
      ".page-header.app-page-header h1,\n.page-header.app-page-header .page-header-title {",
    );
    expect(styles).toContain(
      ".run-page-window-title { min-width:0; flex:1; overflow:hidden; color:var(--foreground); font-size:var(--text-lg); font-weight:650;",
    );
  });

  it("uses semantic text colors that remain readable in dark mode", () => {
    expect(firstRule(".project-agents-body > header strong")).toContain(
      "color:var(--foreground)",
    );
    expect(firstRule(".project-agent-card h2")).toContain(
      "color:var(--foreground)",
    );
    expect(firstRule(".project-agent-runtime")).toContain(
      "color:var(--muted-foreground)",
    );
    expect(firstRule(".project-agent-create-card")).toContain(
      "color:var(--foreground)",
    );
    expect(firstRule(".project-agent-create-card p")).toContain(
      "color:var(--muted-foreground)",
    );
  });

  it("keeps agent session details readable in dark mode", () => {
    expect(firstRule(".auto-hunt-session-page")).toContain(
      "color:var(--foreground)",
    );
    expect(firstRule(".auto-hunt-session-page > header")).toContain(
      "display:none",
    );
    expect(styles).toContain(
      ".page-header.app-page-header {\n  height:48px;\n  min-height:48px;",
    );
    expect(firstRule(".auto-hunt-session-request-card > p")).toContain(
      "color:var(--foreground)",
    );
    expect(firstRule(".auto-hunt-session-side-card > header h3")).toContain(
      "color:var(--foreground)",
    );
    expect(
      firstRule(
        ".auto-hunt-session-execution-timeline .auto-hunt-agent-message > p",
      ),
    ).toContain("color:var(--foreground)");
    expect(firstRule(".auto-hunt-session-output-card > div > p.error")).toContain(
      "color:var(--destructive)",
    );
  });

  it("lays out session activity beside durable session context", () => {
    expect(firstRule(".auto-hunt-session-layout")).toContain(
      "grid-template-columns:minmax(0,1fr) minmax(300px,340px)",
    );
    expect(styles).toContain(
      ".auto-hunt-session-layout > .auto-hunt-stop-error,.auto-hunt-session-request-card { grid-column:1/-1; }",
    );
    expect(firstRule(".auto-hunt-session-sidebar")).toContain(
      "display:grid",
    );
    expect(styles).toContain("@media (max-width:1100px)");
    expect(styles).toContain(
      ".auto-hunt-session-layout { grid-template-columns:minmax(0,1fr); }",
    );
  });
});
