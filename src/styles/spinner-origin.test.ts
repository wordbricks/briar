import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  path.resolve(import.meta.dirname, "../styles.css"),
  "utf8",
);

const originRule = styles.match(
  /\.spin\s*\{([^}]*)\}/,
)?.[1];

describe("spinner rotation origin", () => {
  it("pins spinning icons to the element center without unscaled view-box offsets", () => {
    expect(originRule, "expected a shared spinner origin rule").toBeDefined();
    expect(originRule).not.toContain("transform-box: view-box");
    expect(originRule).toContain("transform-origin: center");
    expect(originRule).toContain("display: inline-block");
  });

  it("defines one shared spin rule and does not override Tailwind spin keyframes", () => {
    expect(styles.match(/\.spin\s*\{/g)).toHaveLength(1);
    expect(styles).not.toContain(".animate-spin");
    expect(styles).not.toContain(".spinning");
    expect(styles).not.toMatch(/@keyframes\s+spin\s*\{/);
  });
});
