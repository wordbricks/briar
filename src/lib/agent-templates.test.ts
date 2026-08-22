import { describe, expect, it } from "vitest";

import {
  agentSkillBodyMaxLength,
  agentSkillsMaxCount,
} from "./agent-limits";
import {
  agentTemplateMarkdownBody,
  agentTemplateMarkdownDescription,
  backendArchitectAgentTemplate,
  contentCreatorAgentTemplate,
  devopsAutomatorAgentTemplate,
  frontendDeveloperAgentTemplate,
  growthHackerAgentTemplate,
  instagramCuratorAgentTemplate,
  mobileAppBuilderAgentTemplate,
  projectAgentTemplates,
  projectAgentTemplateSkillInputs,
  projectAgentTemplateValidationErrors,
  sprintPrioritizerAgentTemplate,
  socialMediaStrategistAgentTemplate,
  tiktokStrategistAgentTemplate,
  uiDesignerAgentTemplate,
} from "./agent-templates";

describe("project Agent templates", () => {
  it.each([
    {
      template: frontendDeveloperAgentTemplate,
      path: "engineering/engineering-frontend-developer.md",
      heading: "# Frontend Developer Agent Personality",
      instructionsLength: 8_961,
    },
    {
      template: backendArchitectAgentTemplate,
      path: "engineering/engineering-backend-architect.md",
      heading: "# Backend Architect Agent Personality",
      instructionsLength: 10_545,
    },
    {
      template: mobileAppBuilderAgentTemplate,
      path: "engineering/engineering-mobile-app-builder.md",
      heading: "# Mobile App Builder Agent Personality",
      instructionsLength: 16_682,
    },
    {
      template: devopsAutomatorAgentTemplate,
      path: "engineering/engineering-devops-automator.md",
      heading: "# DevOps Automator Agent Personality",
      instructionsLength: 12_525,
    },
    {
      template: uiDesignerAgentTemplate,
      path: "design/design-ui-designer.md",
      heading: "# UI Designer Agent Personality",
      instructionsLength: 12_906,
    },
    {
      template: sprintPrioritizerAgentTemplate,
      path: "product/product-sprint-prioritizer.md",
      heading: "# Product Sprint Prioritizer Agent",
      instructionsLength: 9_035,
    },
    {
      template: growthHackerAgentTemplate,
      path: "marketing/marketing-growth-hacker.md",
      heading: "# Marketing Growth Hacker Agent",
      instructionsLength: 2_647,
    },
    {
      template: socialMediaStrategistAgentTemplate,
      path: "marketing/marketing-social-media-strategist.md",
      heading: "# Social Media Strategist Agent",
      instructionsLength: 6_994,
    },
    {
      template: contentCreatorAgentTemplate,
      path: "marketing/marketing-content-creator.md",
      heading: "# Marketing Content Creator Agent",
      instructionsLength: 2_729,
    },
    {
      template: instagramCuratorAgentTemplate,
      path: "marketing/marketing-instagram-curator.md",
      heading: "# Marketing Instagram Curator",
      instructionsLength: 6_215,
    },
    {
      template: tiktokStrategistAgentTemplate,
      path: "marketing/marketing-tiktok-strategist.md",
      heading: "# Marketing TikTok Strategist",
      instructionsLength: 7_222,
    },
  ])(
    "vendors $template.name from the pinned agency-agents source",
    ({ template, path, heading, instructionsLength }) => {
      expect(template.source).toMatchObject({
        commit: "ebe9c99acb5c96f9468de368d8bead775387d1a7",
        license: "MIT",
        path,
      });
      expect(template.source.licenseNotice).toContain(
        "Copyright (c) 2025 AgentLand Contributors",
      );
      expect(template.skills).toHaveLength(1);
      expect(template.skills.length).toBeLessThanOrEqual(agentSkillsMaxCount);
      expect(template.skills[0]?.body).toMatch(
        new RegExp(`^${heading}`, "u"),
      );
      expect(template.skills[0]?.body).toHaveLength(instructionsLength);
      expect(template.skills[0]?.body.length).toBeLessThanOrEqual(
        agentSkillBodyMaxLength,
      );
      expect(template.skills[0]?.description).not.toBe("");
      expect(projectAgentTemplateValidationErrors(template)).toEqual([]);
    },
  );

  it("keeps the Frontend Developer accessibility guidance", () => {
    expect(frontendDeveloperAgentTemplate.skills[0]?.body).toContain(
      "WCAG 2.1 AA guidelines",
    );
  });

  it("publishes eleven templates with unique IDs", () => {
    expect(projectAgentTemplates).toHaveLength(11);
    expect(new Set(projectAgentTemplates.map((template) => template.id)).size)
      .toBe(projectAgentTemplates.length);
  });

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
        description:
          frontendDeveloperAgentTemplate.skills[0]?.description,
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
