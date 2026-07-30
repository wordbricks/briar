import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  new URL("../styles.css", import.meta.url),
  "utf8",
);
const darkStyles = readFileSync(
  new URL("../styles/dark.css", import.meta.url),
  "utf8",
);

function firstRule(selector: string) {
  const marker = `\n${selector} {`;
  const markerStart = styles.indexOf(marker);
  const declarationStart = markerStart === -1 ? -1 : markerStart + 1;
  if (declarationStart === -1) return "";
  const bodyStart = declarationStart + selector.length + 2;
  const bodyEnd = styles.indexOf("}", bodyStart);
  return bodyEnd === -1 ? "" : styles.slice(bodyStart, bodyEnd);
}

function darkRule(selector: string) {
  const marker = `\n${selector} {`;
  const markerStart = darkStyles.indexOf(marker);
  const declarationStart = markerStart === -1 ? -1 : markerStart + 1;
  if (declarationStart === -1) return "";
  const bodyStart = declarationStart + selector.length + 2;
  const bodyEnd = darkStyles.indexOf("}", bodyStart);
  return bodyEnd === -1 ? "" : darkStyles.slice(bodyStart, bodyEnd);
}

describe("dark overlay layout", () => {
  it("uses semantic colors for shared select menus", () => {
    expect(firstRule(".select-menu")).toContain("color: var(--foreground)");
    expect(firstRule(".select-menu-trigger")).toContain(
      "border: 1px solid var(--border)",
    );
    expect(firstRule(".select-menu-trigger")).toContain(
      "background: var(--muted)",
    );
    expect(firstRule(".select-menu-popover")).toContain(
      "var(--popover)",
    );
    expect(firstRule(".select-menu-option")).toContain(
      "color: var(--popover-foreground)",
    );
  });

  it("keeps sidebar popovers readable in both themes", () => {
    expect(firstRule(".account-popover")).toContain("var(--popover)");
    expect(firstRule(".language-popover")).toContain("var(--popover)");
    expect(firstRule(".account-popover > a, .account-popover > button")).toContain(
      "color:var(--popover-foreground)",
    );
    expect(firstRule(".language-popover > button")).toContain(
      "color:var(--popover-foreground)",
    );
  });

  it("uses theme borders and surfaces in create dialogs", () => {
    expect(firstRule(".issue-dialog > header")).toContain(
      "border-bottom: 1px solid var(--border)",
    );
    expect(firstRule(".issue-metadata-bar")).toContain(
      "border-top: 1px solid var(--border)",
    );
    expect(firstRule(".project-schedule-dialog")).toContain(
      "background:color-mix(in srgb,var(--card) 98%,transparent)",
    );
    expect(
      firstRule(".project-agent-form input,.project-agent-form textarea"),
    ).toContain("border:1px solid var(--border)");
  });

  it("uses semantic colors for context menus", () => {
    expect(firstRule(".issue-context-menu")).toContain("var(--popover)");
    expect(firstRule(".project-schedule-context-menu")).toContain(
      "var(--popover)",
    );
  });

  it("keeps status-bar popovers readable in dark mode", () => {
    expect(darkRule(".dark .health-item strong")).toContain(
      "color: var(--foreground)",
    );
    expect(darkRule(".dark .health-error,\n.dark .health-issues")).toContain(
      "var(--destructive)",
    );
    expect(
      darkRule(
        ".dark .agent-usage-status-trigger,\n.dark .worker-status-trigger,\n.dark .app-version-trigger,\n.dark .health-trigger",
      ),
    ).toContain("color: var(--muted-foreground)");
  });
});
