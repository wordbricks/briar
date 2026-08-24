import { describe, expect, it } from "vitest";

import {
  agentTemplateMarkdownBody,
  agentTemplateMarkdownDescription,
  frontendDeveloperAgentTemplate,
  ponytailDeveloperAgentTemplate,
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

  it("folds multiline YAML descriptions into display text", () => {
    expect(
      agentTemplateMarkdownDescription(
        "---\nname: Example\ndescription: >\n  Use for complex\n  examples.\n\n  Keep the paragraph.\nargument-hint: example\n---\n\n# Body\n",
      ),
    ).toBe("Use for complex examples.\nKeep the paragraph.");
  });

  it("bundles the pinned Ponytail Skills and Briar delivery boundary", () => {
    expect(ponytailDeveloperAgentTemplate.source).toMatchObject({
      repository: "https://github.com/DietrichGebert/ponytail",
      commit: "2ed6c52c9d7e5e56942508591085fd45dea277d3",
      license: "MIT",
    });
    expect(
      ponytailDeveloperAgentTemplate.skills.map(({ name }) => name),
    ).toEqual([
      "ponytail",
      "ponytail-review",
      "ponytail-audit",
      "ponytail-debt",
    ]);
    expect(
      ponytailDeveloperAgentTemplate.skills.every(
        ({ body, description }) =>
          body.length > 0 && description.length > 0 && description !== ">",
      ),
    ).toBe(true);
    expect(ponytailDeveloperAgentTemplate.responsibility).toContain(
      "must never be omitted as YAGNI",
    );
    expect(ponytailDeveloperAgentTemplate.responsibility).toContain(
      "Briar workflow and structured result contracts take precedence",
    );
    expect(ponytailDeveloperAgentTemplate.source.licenseNotice).toContain(
      "Copyright (c) 2026 DietrichGebert",
    );
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
