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

  it("uses a three-step card layout for repository setup", () => {
    expect(styles).toMatch(
      /\.project-onboarding-card \{[^}]*width:min\(700px,/u,
    );
    expect(styles).toMatch(
      /\.project-onboarding-progress \{[^}]*grid-template-columns:repeat\(3,1fr\);/u,
    );
    expect(styles).toMatch(
      /\.onboarding-process \{[^}]*min-height:430px;[^}]*align-items:center;/u,
    );
  });
});
