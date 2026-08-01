import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  new URL("../styles.css", import.meta.url),
  "utf8",
);

describe("project onboarding layout", () => {
  it("keeps the Briar mark and wordmark together", () => {
    expect(styles).toMatch(
      /\.brand \{[^}]*display:inline-flex;[^}]*align-items:center;/u,
    );
    expect(styles).toMatch(
      /\.brand-mark \{[^}]*width:24px;[^}]*height:24px;/u,
    );
  });

  it("gives long onboarding content its own viewport scroll area", () => {
    expect(styles).toMatch(
      /\.login-shell,\.onboarding-shell \{[^}]*height:100%;[^}]*min-height:0;[^}]*overflow:auto;/u,
    );
    expect(styles).toMatch(
      /\.onboarding-shell \{[^}]*align-items:start;[^}]*overflow-y:auto;/u,
    );
  });

  it("uses the compact, cardless layout from the repository setup design", () => {
    expect(styles).toMatch(
      /\.repository-connect-card \{[^}]*width:min\(470px,[^}]*border:0;[^}]*background:transparent;[^}]*box-shadow:none;/u,
    );
    expect(styles).toMatch(
      /\.repository-connect-panel \{[^}]*overflow:hidden;[^}]*border:1px solid #dedede;[^}]*border-radius:12px;/u,
    );
    expect(styles).toMatch(
      /\.repository-connect-progress \{[^}]*grid-template-columns:1fr 1fr;/u,
    );
  });
});
