import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  path.resolve(import.meta.dirname, "../styles.css"),
  "utf8",
);

const ruleBody = (selector: string) => {
  const match = styles.match(
    new RegExp(
      `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
    ),
  );
  expect(match, `expected CSS rule for ${selector}`).not.toBeNull();
  return match?.[1] ?? "";
};

describe("update control styles", () => {
  it("stops the availability pulse while the pointer hover style is active", () => {
    expect(
      ruleBody(".sidebar-update-trigger.is-available:hover:not(:disabled)"),
    ).toContain("animation: none");

    const hover = ruleBody(".sidebar-update-trigger:hover:not(:disabled)");
    expect(hover).toContain("background: #b91c1c");
    expect(hover).toContain("box-shadow:");
  });
});
