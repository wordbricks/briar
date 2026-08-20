import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  path.resolve(import.meta.dirname, "../styles.css"),
  "utf8",
);

describe("project workflow dark mode", () => {
  it("uses semantic theme surfaces throughout the workflow page", () => {
    expect(styles).toMatch(
      /\.project-settings-workflow-revision\s*{[^}]*border:1px solid var\(--border\);[^}]*background:var\(--muted\);/,
    );
    expect(styles).toMatch(
      /\.project-settings-checkpoints\s*{[^}]*border:1px solid var\(--border\);[^}]*background:var\(--card\);/,
    );
    expect(styles).toMatch(
      /\.checkpoint-options label\s*{[^}]*border:1px solid var\(--input\);[^}]*background:var\(--card\);/,
    );
    expect(styles).toMatch(
      /\.project-workflow-stage\s*{[^}]*border:1px solid var\(--border\);[^}]*background:var\(--card\);/,
    );
    expect(styles).toMatch(
      /\.project-workflow-summary > div\s*{[^}]*background:var\(--accent\);/,
    );
  });
});
