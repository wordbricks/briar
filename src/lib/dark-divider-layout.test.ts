import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  new URL("../styles.css", import.meta.url),
  "utf8",
);
const tokens = readFileSync(
  new URL("../styles/tokens.css", import.meta.url),
  "utf8",
);

describe("dark mode dividers", () => {
  it("uses a subdued divider while preserving stronger input borders", () => {
    expect(tokens).toContain("--border: #242428;");
    expect(tokens).toContain("--input: #2a2a30;");
  });

  it("uses semantic borders for status bar dividers", () => {
    expect(styles).toContain(
      ".agent-usage-status-provider + .agent-usage-status-provider { padding-left:12px; border-left:1px solid var(--border); }",
    );
    expect(styles).toContain(
      ".app-version-status { flex:0 0 auto; height:100%; position:relative; display:flex; align-items:stretch; border-left:1px solid var(--border); }",
    );
    expect(styles).toContain(
      ".app-status-bar > .health-menu { flex:0 0 auto; margin-left:0; display:flex; align-items:center; padding:0 8px 0 6px; border-left:1px solid var(--border); }",
    );
  });

  it("keeps calendar dividers and surfaces theme-aware", () => {
    expect(styles).toContain(
      ".project-schedule-summary { height:46px; padding:0 16px; display:flex; align-items:center; gap:15px; flex:0 0 auto; border:1px solid var(--border); border-radius:13px; background:var(--card);",
    );
    expect(styles).toContain(
      ".project-schedule-day-heading { display:flex; align-items:center; justify-content:center; gap:7px; border-right:1px solid var(--border);",
    );
    expect(styles).toContain(
      ".project-schedule-day-column { height:1440px; position:relative; overflow:hidden; border-right:1px solid var(--border); background-color:var(--card);",
    );
    expect(styles).toContain(
      ".project-schedule-day-column.today { background-color:color-mix(in srgb,var(--primary) 4%,var(--card)); }",
    );
    expect(styles).toContain(
      ".project-schedule-empty { width:min(330px,calc(100% - 110px)); min-height:130px;",
    );
    expect(styles).toContain(
      "border:1px solid var(--border); border-radius:15px; color:var(--muted-foreground); background:var(--card);",
    );
  });
});
