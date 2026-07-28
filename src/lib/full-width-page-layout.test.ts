import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  new URL("../styles.css", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");

describe("full-width application pages", () => {
  it("uses the Auto Hunt parent area instead of outer cards", () => {
    expect(styles).toMatch(
      /\.auto-hunt-scroll \{[^}]*padding:0;[^}]*display:flex;[^}]*overflow:hidden;/,
    );
    expect(styles).toMatch(
      /\.auto-hunt-session-detail-scroll \{[^}]*padding:0;[^}]*display:block;[^}]*overflow-y:auto;/,
    );
    expect(styles).toMatch(
      /\.auto-hunt-hero \{[^}]*border:0;[^}]*border-bottom:1px solid var\(--border\);[^}]*border-radius:0;[^}]*box-shadow:none;/,
    );
    expect(styles).toMatch(
      /\.auto-hunt-session-panel \{[^}]*flex:1;[^}]*margin:0;[^}]*border:0;[^}]*border-radius:0;[^}]*box-shadow:none;/,
    );
  });

  it("uses the full project-agent area for sessions", () => {
    expect(styles).toMatch(
      /\.project-agent-run-scroll \{[^}]*display:flex;[^}]*flex-direction:column;[^}]*overflow:hidden;/,
    );
    expect(styles).toMatch(
      /\.project-agent-run-hero \{[^}]*flex:0 0 auto;/,
    );
    expect(styles).toMatch(
      /\.project-agent-session-panel \{[^}]*width:100%;[^}]*min-height:0;[^}]*flex:1;[^}]*margin:0;[^}]*border:0;[^}]*border-radius:0;[^}]*box-shadow:none;/,
    );
  });

  it("uses the Inbox parent area instead of a centered card", () => {
    expect(styles).toMatch(
      /\.inbox-scroll \{[^}]*padding:0;[^}]*display:flex;[^}]*overflow:hidden;/,
    );
    expect(styles).toMatch(
      /\.inbox-content \{[^}]*width:100%;[^}]*flex:1;[^}]*margin:0;[^}]*display:flex;/,
    );
    expect(styles).toMatch(
      /\.inbox-panel \{[^}]*flex:1;[^}]*border:0;[^}]*border-radius:0;[^}]*box-shadow:none;/,
    );
  });
});
