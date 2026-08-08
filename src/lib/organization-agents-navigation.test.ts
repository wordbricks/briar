import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const settings = readFileSync(
  new URL("../components/OrganizationSettings.tsx", import.meta.url),
  "utf8",
);

describe("organization agent navigation", () => {
  it("routes the channel welcome action to organization agent settings", () => {
    const createAgentHandler = app.match(
      /onCreateAgent=\{\(\) => \{([\s\S]*?)\n\s*\}\}\n\s*onIssueCreated=/u,
    )?.[1];

    expect(createAgentHandler).toContain('scope: "organization"');
    expect(createAgentHandler).toContain('section: "agents"');
    expect(createAgentHandler).toContain('navigateToPage("settings")');
    expect(createAgentHandler).not.toContain('navigateToPage("agents")');
  });

  it("keeps organization agents separate from project schedules", () => {
    expect(settings).toContain('| "agents"');
    expect(settings).toContain('activeSection === "agents"');
    expect(settings).toContain("<OrganizationAgentsSettings");
  });
});
