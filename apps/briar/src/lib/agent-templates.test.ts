import { describe, expect, it } from "vitest";

import {
  agentTemplateMarkdownBody,
  agentTemplateMarkdownDescription,
  frontendDeveloperAgentTemplate,
  projectAgentTemplateSkillInputs,
} from "./agent-templates";

describe("project Agent templates", () => {
  it("removes source frontmatter without changing the Markdown body", () => {
    expect(
      agentTemplateMarkdownBody("---\nname: Example\n---\n\n# Body\n\nText\n"),
    ).toBe("# Body\n\nText");
  });

  it("reads the discovery description from source frontmatter", () => {
    expect(
      agentTemplateMarkdownDescription(
        "---\nname: Example\ndescription: Use for examples.\n---\n\n# Body\n",
      ),
    ).toBe("Use for examples.");
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
        description: frontendDeveloperAgentTemplate.skills[0]?.description,
        body: frontendDeveloperAgentTemplate.skills[0]?.body,
        kind: "custom",
        provider: "claude",
        model: "claude-sonnet-4-6",
        effort: "high",
        position: 0,
      },
    ]);
  });
});
