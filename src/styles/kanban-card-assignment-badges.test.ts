import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  path.resolve(import.meta.dirname, "../styles.css"),
  "utf8",
);

const ruleBodies = (selector: string) => [
  ...styles.matchAll(
    new RegExp(
      `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
      "g",
    ),
  ),
].map((match) => match[1] ?? "");

const lastRuleBody = (selector: string) => {
  const bodies = ruleBodies(selector);
  expect(bodies, `expected CSS rule for ${selector}`).not.toHaveLength(0);
  return bodies.at(-1) ?? "";
};

describe("kanban card assignment badges", () => {
  it("pins unshadowed, bordered badges to the card corner", () => {
    const group = lastRuleBody(".kanban-card-assignee-badges");
    expect(group).toContain("top:6px");
    expect(group).toContain("right:6px");

    const badge = lastRuleBody(".kanban-card-assignee-badges > span");
    expect(badge).toContain("padding:0");
    expect(badge).toContain("border:1px solid var(--border)");
    expect(badge).toContain("box-shadow:none");

    const workerIcon = lastRuleBody(
      ".kanban-card-worker-badge .worker-icon",
    );
    expect(workerIcon).toContain("border:0");
    expect(workerIcon).toContain("border-radius:50%");
  });

  it("reserves title space for provider, Agent, and Worker badges", () => {
    expect(
      lastRuleBody(".kanban-card.has-three-assignees .kanban-card-kicker"),
    ).toContain("padding-right:56px");
    expect(
      lastRuleBody(
        ".companion-shell .kanban-card.has-three-assignees .kanban-card-copy",
      ),
    ).toContain("padding-right: 58px");
  });
});
