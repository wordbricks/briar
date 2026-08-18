import frontendDeveloperMarkdown from "../data/agent-templates/agency-agents/engineering/engineering-frontend-developer.md?raw";
import agencyAgentsLicense from "../../third-party/agency-agents-LICENSE.md?raw";

import type {
  ProjectAgentSkillInput,
  ProjectAgentSkillKind,
} from "../types";
import {
  agentDescriptionMaxLength,
  agentResponsibilityMaxLength,
  agentSkillInstructionsMaxLength,
  agentSkillsMaxCount,
} from "./agent-limits";
import type { AgentProvider, ModelEffort } from "./project-llm";

export type ProjectAgentTemplate = {
  id: string;
  source: {
    repository: string;
    commit: string;
    path: string;
    url: string;
    license: "MIT";
    licenseUrl: string;
    licenseNotice: string;
  };
  division: "engineering";
  emoji: string;
  name: string;
  description: string;
  responsibility: string;
  calendarColor: string;
  skills: readonly {
    name: string;
    instructions: string;
    kind: ProjectAgentSkillKind;
  }[];
};

export function agentTemplateMarkdownBody(markdown: string) {
  const normalized = markdown.replace(/\r\n?/gu, "\n");
  if (!normalized.startsWith("---\n")) return normalized.trim();
  const frontmatterEnd = normalized.indexOf("\n---\n", 4);
  if (frontmatterEnd === -1) {
    throw new Error("Agent template frontmatter is not closed");
  }
  return normalized.slice(frontmatterEnd + "\n---\n".length).trim();
}

export const frontendDeveloperAgentTemplate = {
  id: "agency-agents:engineering/engineering-frontend-developer",
  source: {
    repository: "https://github.com/msitarzewski/agency-agents",
    commit: "ebe9c99acb5c96f9468de368d8bead775387d1a7",
    path: "engineering/engineering-frontend-developer.md",
    url: "https://github.com/msitarzewski/agency-agents/blob/ebe9c99acb5c96f9468de368d8bead775387d1a7/engineering/engineering-frontend-developer.md",
    license: "MIT",
    licenseUrl:
      "https://github.com/msitarzewski/agency-agents/blob/ebe9c99acb5c96f9468de368d8bead775387d1a7/LICENSE",
    licenseNotice: agencyAgentsLicense.trim(),
  },
  division: "engineering",
  emoji: "🖥️",
  name: "Frontend Developer",
  description:
    "Expert frontend developer specializing in modern web technologies, React/Vue/Angular frameworks, UI implementation, and performance optimization",
  responsibility:
    "Own the architecture, implementation, accessibility, performance, testing, and delivery quality of the project's frontend experience.",
  calendarColor: "#06B6D4",
  skills: [
    {
      name: "Frontend Development",
      instructions: agentTemplateMarkdownBody(frontendDeveloperMarkdown),
      kind: "custom",
    },
  ],
} satisfies ProjectAgentTemplate;

export const projectAgentTemplates = [
  frontendDeveloperAgentTemplate,
] as const satisfies readonly ProjectAgentTemplate[];

export function projectAgentTemplateSkillInputs(
  template: ProjectAgentTemplate,
  runtime: {
    provider: AgentProvider;
    model: string | null;
    effort: ModelEffort | null;
  },
): ProjectAgentSkillInput[] {
  return template.skills.map((skill, position) => ({
    ...skill,
    ...runtime,
    position,
  }));
}

export function projectAgentTemplateValidationErrors(
  template: ProjectAgentTemplate,
) {
  const errors: string[] = [];
  if (!template.name.trim() || template.name.length > 100) {
    errors.push("name must contain 1 to 100 characters");
  }
  if (template.description.length > agentDescriptionMaxLength) {
    errors.push(`description exceeds ${agentDescriptionMaxLength} characters`);
  }
  if (
    !template.responsibility.trim() ||
    template.responsibility.length > agentResponsibilityMaxLength
  ) {
    errors.push(
      `responsibility must contain 1 to ${agentResponsibilityMaxLength} characters`,
    );
  }
  if (template.skills.length > agentSkillsMaxCount) {
    errors.push(`template exceeds ${agentSkillsMaxCount} skills`);
  }
  if (!/^#[0-9a-f]{6}$/iu.test(template.calendarColor)) {
    errors.push("calendar color must be a six-digit hex value");
  }
  const skillNames = new Set<string>();
  template.skills.forEach((skill, index) => {
    if (!skill.name.trim() || skill.name.length > 100) {
      errors.push(`skill ${index + 1} name must contain 1 to 100 characters`);
    }
    const skillName = skill.name.trim().normalize("NFKC").toLocaleLowerCase();
    if (skillNames.has(skillName)) {
      errors.push(`skill ${index + 1} name must be unique`);
    }
    skillNames.add(skillName);
    if (
      !skill.instructions.trim() ||
      skill.instructions.length > agentSkillInstructionsMaxLength
    ) {
      errors.push(
        `skill ${index + 1} instructions must contain 1 to ${agentSkillInstructionsMaxLength} characters`,
      );
    }
  });
  return errors;
}

const frontendDeveloperTemplateErrors = projectAgentTemplateValidationErrors(
  frontendDeveloperAgentTemplate,
);
if (frontendDeveloperTemplateErrors.length > 0) {
  throw new Error(
    `Invalid Frontend Developer Agent template: ${frontendDeveloperTemplateErrors.join(", ")}`,
  );
}
