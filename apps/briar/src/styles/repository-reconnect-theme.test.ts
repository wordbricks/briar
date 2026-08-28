import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve("src", "styles.css"), "utf8");
const tokens = readFileSync(resolve("src", "styles", "tokens.css"), "utf8");

function rule(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escapedSelector} \\{([^}]+)\\}`))?.[1] ?? "";
}

describe("repository reconnect theme", () => {
  it("uses shared semantic tokens for the repository card content", () => {
    expect(rule(".setup-section")).toContain("border:1px solid var(--border)");
    expect(rule(".setup-section")).toContain("color:var(--card-foreground)");
    expect(rule(".setup-section")).toContain("background:var(--muted)");
    expect(rule(".setup-section-heading")).toContain("color:var(--accent-foreground)");
    expect(rule(".setup-section-heading strong")).toContain("color:var(--card-foreground)");
    expect(rule(".setup-section-heading span")).toContain("color:var(--muted-foreground)");
  });

  it("keeps connected repository feedback legible in both themes", () => {
    const connected = rule(".repository-setup.connected");
    expect(connected).toContain("border-color:var(--status-success-border)");
    expect(connected).toContain("background:var(--status-success-surface)");
    expect(rule(".repository-setup.connected .setup-section-heading > svg")).toContain(
      "color:var(--status-success-foreground)",
    );
    expect(rule(".setup-section-heading .repository-path")).toContain(
      "color:var(--card-foreground)",
    );

    const darkTokens = tokens.slice(tokens.indexOf(".dark {"));
    for (const token of [
      "--card-foreground:",
      "--muted:",
      "--muted-foreground:",
      "--accent:",
      "--accent-foreground:",
      "--border:",
      "--ring:",
    ]) {
      expect(tokens.slice(0, tokens.indexOf(".dark {")).includes(token)).toBe(true);
      expect(darkTokens.includes(token)).toBe(true);
    }
  });

  it("defines contrasting repository button interaction states", () => {
    const button = rule(".setup-repository-action");
    expect(button).toContain("color:var(--accent-foreground)");
    expect(button).toContain("background:var(--card)");
    expect(rule(".setup-repository-action:hover:not(:disabled)")).toContain(
      "background:var(--accent)",
    );
    expect(rule(".setup-repository-action:active:not(:disabled)")).toContain(
      "border-color:var(--ring)",
    );
    expect(rule(".setup-repository-action:focus-visible")).toContain("var(--ring)");

    const disabled = rule(".setup-repository-action:disabled");
    expect(disabled).toContain("color:var(--muted-foreground)");
    expect(disabled).toContain("background:var(--secondary)");
    expect(disabled).toContain("opacity:1");
  });
});
