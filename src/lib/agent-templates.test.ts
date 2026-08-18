import { describe, expect, it } from "vitest";

import {
  agentSkillInstructionsMaxLength,
  agentSkillsMaxCount,
} from "./agent-limits";
import {
  agentTemplateMarkdownBody,
  frontendDeveloperAgentTemplate,
  projectAgentTemplateSkillInputs,
  projectAgentTemplateValidationErrors,
} from "./agent-templates";

describe("project Agent templates", () => {
  it("vendors the pinned agency-agents Frontend Developer as a valid template", () => {
    expect(frontendDeveloperAgentTemplate.source).toMatchObject({
      commit: "ebe9c99acb5c96f9468de368d8bead775387d1a7",
      license: "MIT",
      path: "engineering/engineering-frontend-developer.md",
    });
    expect(frontendDeveloperAgentTemplate.source.licenseNotice).toContain(
      "Copyright (c) 2025 AgentLand Contributors",
    );
    expect(frontendDeveloperAgentTemplate.skills).toHaveLength(1);
    expect(frontendDeveloperAgentTemplate.skills.length).toBeLessThanOrEqual(
      agentSkillsMaxCount,
    );
    expect(frontendDeveloperAgentTemplate.skills[0]?.instructions).toMatch(
      /^# Frontend Developer Agent Personality/u,
    );
    expect(frontendDeveloperAgentTemplate.skills[0]?.instructions).toContain(
      "WCAG 2.1 AA guidelines",
    );
    expect(frontendDeveloperAgentTemplate.skills[0]?.instructions).toHaveLength(
      8_961,
    );
    expect(
      frontendDeveloperAgentTemplate.skills[0]?.instructions.length,
    ).toBeLessThanOrEqual(agentSkillInstructionsMaxLength);
    expect(projectAgentTemplateValidationErrors(frontendDeveloperAgentTemplate))
      .toEqual([]);
  });

  it("removes source frontmatter without changing the Markdown body", () => {
    expect(
      agentTemplateMarkdownBody("---\nname: Example\n---\n\n# Body\n\nText\n"),
    ).toBe("# Body\n\nText");
  });

  it("applies the final form runtime to every generated Skill", () => {
    expect(
      projectAgentTemplateSkillInputs(frontendDeveloperAgentTemplate, {
        provider: "claude",
        model: "claude-sonnet-4-6",
        effort: "high",
      }),
    ).toEqual([
      {
        name: "Frontend Development",
        instructions:
          frontendDeveloperAgentTemplate.skills[0]?.instructions,
        kind: "custom",
        provider: "claude",
        model: "claude-sonnet-4-6",
        effort: "high",
        position: 0,
      },
    ]);
  });
});
