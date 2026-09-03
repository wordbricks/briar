import uiDesignerMarkdown from "../data/agent-templates/agency-agents/design/design-ui-designer.md?raw";
import backendArchitectMarkdown from "../data/agent-templates/agency-agents/engineering/engineering-backend-architect.md?raw";
import devopsAutomatorMarkdown from "../data/agent-templates/agency-agents/engineering/engineering-devops-automator.md?raw";
import frontendDeveloperMarkdown from "../data/agent-templates/agency-agents/engineering/engineering-frontend-developer.md?raw";
import mobileAppBuilderMarkdown from "../data/agent-templates/agency-agents/engineering/engineering-mobile-app-builder.md?raw";
import contentCreatorMarkdown from "../data/agent-templates/agency-agents/marketing/marketing-content-creator.md?raw";
import growthHackerMarkdown from "../data/agent-templates/agency-agents/marketing/marketing-growth-hacker.md?raw";
import instagramCuratorMarkdown from "../data/agent-templates/agency-agents/marketing/marketing-instagram-curator.md?raw";
import socialMediaStrategistMarkdown from "../data/agent-templates/agency-agents/marketing/marketing-social-media-strategist.md?raw";
import tiktokStrategistMarkdown from "../data/agent-templates/agency-agents/marketing/marketing-tiktok-strategist.md?raw";
import sprintPrioritizerMarkdown from "../data/agent-templates/agency-agents/product/product-sprint-prioritizer.md?raw";
import ponytailMarkdown from "../data/agent-templates/ponytail/skills/ponytail/SKILL.md?raw";
import ponytailAuditMarkdown from "../data/agent-templates/ponytail/skills/ponytail-audit/SKILL.md?raw";
import ponytailDebtMarkdown from "../data/agent-templates/ponytail/skills/ponytail-debt/SKILL.md?raw";
import ponytailReviewMarkdown from "../data/agent-templates/ponytail/skills/ponytail-review/SKILL.md?raw";
import ponytailAvatar from "../data/agent-templates/ponytail/avatar.webp?inline";
import agencyAgentsLicense from "../../../../third-party/agency-agents-LICENSE.md?raw";
import ponytailLicense from "../../../../third-party/ponytail-LICENSE.md?raw";

import type {
  TeamAgentSkillInput,
  ProjectAgentSkillKind,
} from "../types";
import {
  agentDescriptionMaxLength,
  agentResponsibilityMaxLength,
  agentSkillBodyMaxLength,
  agentSkillDescriptionMaxLength,
  agentSkillsMaxCount,
} from "./agent-limits";
import { isTeamAgentAvatarDataUrl } from "./team-agent-avatar";
import type { AgentProvider, ModelEffort } from "./team-llm";

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
  division: "design" | "engineering" | "marketing" | "product";
  emoji: string;
  avatar?: string;
  name: string;
  description: string;
  responsibility: string;
  calendarColor: string;
  skills: readonly {
    name: string;
    description: string;
    body: string;
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

export function agentTemplateMarkdownDescription(markdown: string) {
  const normalized = markdown.replace(/\r\n?/gu, "\n");
  if (!normalized.startsWith("---\n")) {
    throw new Error("Agent template frontmatter is missing");
  }
  const frontmatterEnd = normalized.indexOf("\n---\n", 4);
  if (frontmatterEnd === -1) {
    throw new Error("Agent template frontmatter is not closed");
  }
  const frontmatterLines = normalized.slice(4, frontmatterEnd).split("\n");
  const descriptionIndex = frontmatterLines.findIndex((line) =>
    line.startsWith("description:"),
  );
  const description = frontmatterLines[descriptionIndex]
    ?.slice("description:".length)
    .trim();
  if (!description) {
    throw new Error("Agent template description is missing");
  }
  if (/^>[+-]?$/u.test(description)) {
    const foldedLines: string[] = [];
    for (const line of frontmatterLines.slice(descriptionIndex + 1)) {
      if (line && !/^\s/u.test(line)) break;
      foldedLines.push(line.replace(/^\s+/u, ""));
    }
    const foldedDescription = foldedLines
      .join("\n")
      .split(/\n{2,}/u)
      .map((paragraph) => paragraph.replace(/\n/gu, " ").trim())
      .filter(Boolean)
      .join("\n");
    if (!foldedDescription) {
      throw new Error("Agent template description is missing");
    }
    return foldedDescription;
  }
  return description;
}

const agencyAgentsRepository = "https://github.com/msitarzewski/agency-agents";
const agencyAgentsCommit = "ebe9c99acb5c96f9468de368d8bead775387d1a7";

function agencyAgentsTemplateSource(path: string) {
  return {
    repository: agencyAgentsRepository,
    commit: agencyAgentsCommit,
    path,
    url: `${agencyAgentsRepository}/blob/${agencyAgentsCommit}/${path}`,
    license: "MIT" as const,
    licenseUrl: `${agencyAgentsRepository}/blob/${agencyAgentsCommit}/LICENSE`,
    licenseNotice: agencyAgentsLicense.trim(),
  };
}

const ponytailRepository = "https://github.com/DietrichGebert/ponytail";
const ponytailCommit = "2ed6c52c9d7e5e56942508591085fd45dea277d3";

function ponytailTemplateSource() {
  const path = "skills";
  return {
    repository: ponytailRepository,
    commit: ponytailCommit,
    path,
    url: `${ponytailRepository}/tree/${ponytailCommit}/${path}`,
    license: "MIT" as const,
    licenseUrl: `${ponytailRepository}/blob/${ponytailCommit}/LICENSE`,
    licenseNotice: ponytailLicense.trim(),
  };
}

export const ponytailDeveloperAgentTemplate = {
  id: "ponytail:developer",
  source: ponytailTemplateSource(),
  division: "engineering",
  emoji: "🐴",
  avatar: ponytailAvatar,
  name: "Ponytail Developer",
  description:
    "Developer who applies Ponytail's minimal implementation discipline while preserving Briar's complete delivery contract.",
  responsibility:
    "Maintain code and deployment. Find the smallest correct implementation only after understanding the end-to-end flow. Explicit acceptance criteria, security, accessibility, required tests, deployments, workflow stages, evidence, and result-output contracts are mandatory and must never be omitted as YAGNI. Complexity-only reviews supplement rather than replace required correctness and security review. Briar workflow and structured result contracts take precedence over Ponytail output rules, including its limits on explanation length.",
  calendarColor: "#EC4899",
  skills: [
    {
      name: "ponytail",
      description: agentTemplateMarkdownDescription(ponytailMarkdown),
      body: agentTemplateMarkdownBody(ponytailMarkdown),
      kind: "custom",
    },
    {
      name: "ponytail-review",
      description: agentTemplateMarkdownDescription(ponytailReviewMarkdown),
      body: agentTemplateMarkdownBody(ponytailReviewMarkdown),
      kind: "custom",
    },
    {
      name: "ponytail-audit",
      description: agentTemplateMarkdownDescription(ponytailAuditMarkdown),
      body: agentTemplateMarkdownBody(ponytailAuditMarkdown),
      kind: "custom",
    },
    {
      name: "ponytail-debt",
      description: agentTemplateMarkdownDescription(ponytailDebtMarkdown),
      body: agentTemplateMarkdownBody(ponytailDebtMarkdown),
      kind: "custom",
    },
  ],
} satisfies ProjectAgentTemplate;

export const frontendDeveloperAgentTemplate = {
  id: "agency-agents:engineering/engineering-frontend-developer",
  source: agencyAgentsTemplateSource(
    "engineering/engineering-frontend-developer.md",
  ),
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
      description: agentTemplateMarkdownDescription(frontendDeveloperMarkdown),
      body: agentTemplateMarkdownBody(frontendDeveloperMarkdown),
      kind: "custom",
    },
  ],
} satisfies ProjectAgentTemplate;

export const backendArchitectAgentTemplate = {
  id: "agency-agents:engineering/engineering-backend-architect",
  source: agencyAgentsTemplateSource(
    "engineering/engineering-backend-architect.md",
  ),
  division: "engineering",
  emoji: "🏗️",
  name: "Backend Architect",
  description:
    "Senior backend architect specializing in scalable system design, database architecture, API development, and cloud infrastructure. Builds robust, secure, performant server-side applications and microservices",
  responsibility:
    "Own scalable backend architecture, data models, APIs, security, reliability, observability, and cloud infrastructure.",
  calendarColor: "#3B82F6",
  skills: [
    {
      name: "Backend Architecture",
      description: agentTemplateMarkdownDescription(backendArchitectMarkdown),
      body: agentTemplateMarkdownBody(backendArchitectMarkdown),
      kind: "custom",
    },
  ],
} satisfies ProjectAgentTemplate;

export const mobileAppBuilderAgentTemplate = {
  id: "agency-agents:engineering/engineering-mobile-app-builder",
  source: agencyAgentsTemplateSource(
    "engineering/engineering-mobile-app-builder.md",
  ),
  division: "engineering",
  emoji: "📲",
  name: "Mobile App Builder",
  description:
    "Specialized mobile application developer with expertise in native iOS/Android development and cross-platform frameworks",
  responsibility:
    "Own native and cross-platform mobile architecture, implementation, testing, performance, accessibility, and release quality across iOS and Android.",
  calendarColor: "#8B5CF6",
  skills: [
    {
      name: "Mobile App Development",
      description: agentTemplateMarkdownDescription(mobileAppBuilderMarkdown),
      body: agentTemplateMarkdownBody(mobileAppBuilderMarkdown),
      kind: "custom",
    },
  ],
} satisfies ProjectAgentTemplate;

export const devopsAutomatorAgentTemplate = {
  id: "agency-agents:engineering/engineering-devops-automator",
  source: agencyAgentsTemplateSource(
    "engineering/engineering-devops-automator.md",
  ),
  division: "engineering",
  emoji: "⚙️",
  name: "DevOps Automator",
  description:
    "Expert DevOps engineer specializing in infrastructure automation, CI/CD pipeline development, and cloud operations",
  responsibility:
    "Own infrastructure automation, CI/CD, cloud operations, observability, reliability, security, and incident readiness.",
  calendarColor: "#F97316",
  skills: [
    {
      name: "DevOps Automation",
      description: agentTemplateMarkdownDescription(devopsAutomatorMarkdown),
      body: agentTemplateMarkdownBody(devopsAutomatorMarkdown),
      kind: "custom",
    },
  ],
} satisfies ProjectAgentTemplate;

export const uiDesignerAgentTemplate = {
  id: "agency-agents:design/design-ui-designer",
  source: agencyAgentsTemplateSource("design/design-ui-designer.md"),
  division: "design",
  emoji: "🎨",
  name: "UI Designer",
  description:
    "Expert UI designer specializing in visual design systems, component libraries, and pixel-perfect interface creation. Creates beautiful, consistent, accessible user interfaces that enhance UX and reflect brand identity",
  responsibility:
    "Own the visual design system, component library, accessibility, consistency, and pixel-perfect interface quality across product surfaces.",
  calendarColor: "#A855F7",
  skills: [
    {
      name: "UI Design",
      description: agentTemplateMarkdownDescription(uiDesignerMarkdown),
      body: agentTemplateMarkdownBody(uiDesignerMarkdown),
      kind: "custom",
    },
  ],
} satisfies ProjectAgentTemplate;

export const sprintPrioritizerAgentTemplate = {
  id: "agency-agents:product/product-sprint-prioritizer",
  source: agencyAgentsTemplateSource(
    "product/product-sprint-prioritizer.md",
  ),
  division: "product",
  emoji: "🎯",
  name: "Sprint Prioritizer",
  description:
    "Expert product manager specializing in agile sprint planning, feature prioritization, and resource allocation. Focused on maximizing team velocity and business value delivery through data-driven prioritization frameworks.",
  responsibility:
    "Own sprint planning and prioritization by balancing customer impact, business value, dependencies, risks, and team capacity.",
  calendarColor: "#22C55E",
  skills: [
    {
      name: "Sprint Prioritization",
      description: agentTemplateMarkdownDescription(sprintPrioritizerMarkdown),
      body: agentTemplateMarkdownBody(sprintPrioritizerMarkdown),
      kind: "custom",
    },
  ],
} satisfies ProjectAgentTemplate;

export const growthHackerAgentTemplate = {
  id: "agency-agents:marketing/marketing-growth-hacker",
  source: agencyAgentsTemplateSource("marketing/marketing-growth-hacker.md"),
  division: "marketing",
  emoji: "🚀",
  name: "Growth Hacker",
  description:
    "Expert growth strategist specializing in rapid user acquisition through data-driven experimentation. Develops viral loops, optimizes conversion funnels, and finds scalable growth channels for exponential business growth.",
  responsibility:
    "Own data-driven growth strategy, experimentation, acquisition funnels, viral loops, retention, and scalable channel discovery.",
  calendarColor: "#10B981",
  skills: [
    {
      name: "Growth Hacking",
      description: agentTemplateMarkdownDescription(growthHackerMarkdown),
      body: agentTemplateMarkdownBody(growthHackerMarkdown),
      kind: "custom",
    },
  ],
} satisfies ProjectAgentTemplate;

export const socialMediaStrategistAgentTemplate = {
  id: "agency-agents:marketing/marketing-social-media-strategist",
  source: agencyAgentsTemplateSource(
    "marketing/marketing-social-media-strategist.md",
  ),
  division: "marketing",
  emoji: "📣",
  name: "Social Media Strategist",
  description:
    "Expert social media strategist for LinkedIn, Twitter, and professional platforms. Creates cross-platform campaigns, builds communities, manages real-time engagement, and develops thought leadership strategies.",
  responsibility:
    "Own cross-platform social strategy, campaign planning, community engagement, thought leadership, and measurable channel performance.",
  calendarColor: "#2563EB",
  skills: [
    {
      name: "Social Media Strategy",
      description: agentTemplateMarkdownDescription(socialMediaStrategistMarkdown),
      body: agentTemplateMarkdownBody(socialMediaStrategistMarkdown),
      kind: "custom",
    },
  ],
} satisfies ProjectAgentTemplate;

export const contentCreatorAgentTemplate = {
  id: "agency-agents:marketing/marketing-content-creator",
  source: agencyAgentsTemplateSource("marketing/marketing-content-creator.md"),
  division: "marketing",
  emoji: "✍️",
  name: "Content Creator",
  description:
    "Expert content strategist and creator for multi-platform campaigns. Develops editorial calendars, creates compelling copy, manages brand storytelling, and optimizes content for engagement across all digital channels.",
  responsibility:
    "Own content strategy, editorial calendars, brand storytelling, multi-format production, distribution, SEO, and performance optimization.",
  calendarColor: "#14B8A6",
  skills: [
    {
      name: "Content Creation",
      description: agentTemplateMarkdownDescription(contentCreatorMarkdown),
      body: agentTemplateMarkdownBody(contentCreatorMarkdown),
      kind: "custom",
    },
  ],
} satisfies ProjectAgentTemplate;

export const instagramCuratorAgentTemplate = {
  id: "agency-agents:marketing/marketing-instagram-curator",
  source: agencyAgentsTemplateSource(
    "marketing/marketing-instagram-curator.md",
  ),
  division: "marketing",
  emoji: "📸",
  name: "Instagram Curator",
  description:
    "Expert Instagram marketing specialist focused on visual storytelling, community building, and multi-format content optimization. Masters aesthetic development and drives meaningful engagement.",
  responsibility:
    "Own Instagram visual strategy, multi-format content, community growth, social commerce, creator partnerships, and performance optimization.",
  calendarColor: "#E4405F",
  skills: [
    {
      name: "Instagram Marketing",
      description: agentTemplateMarkdownDescription(instagramCuratorMarkdown),
      body: agentTemplateMarkdownBody(instagramCuratorMarkdown),
      kind: "custom",
    },
  ],
} satisfies ProjectAgentTemplate;

export const tiktokStrategistAgentTemplate = {
  id: "agency-agents:marketing/marketing-tiktok-strategist",
  source: agencyAgentsTemplateSource("marketing/marketing-tiktok-strategist.md"),
  division: "marketing",
  emoji: "🎵",
  name: "TikTok Strategist",
  description:
    "Expert TikTok marketing specialist focused on viral content creation, algorithm optimization, and community building. Masters TikTok's unique culture and features for brand growth.",
  responsibility:
    "Own TikTok content strategy, trend and algorithm adaptation, creator partnerships, community growth, paid campaigns, and measurable performance.",
  calendarColor: "#111827",
  skills: [
    {
      name: "TikTok Marketing",
      description: agentTemplateMarkdownDescription(tiktokStrategistMarkdown),
      body: agentTemplateMarkdownBody(tiktokStrategistMarkdown),
      kind: "custom",
    },
  ],
} satisfies ProjectAgentTemplate;

export const projectAgentTemplates: readonly ProjectAgentTemplate[] = [
  ponytailDeveloperAgentTemplate,
  frontendDeveloperAgentTemplate,
  backendArchitectAgentTemplate,
  mobileAppBuilderAgentTemplate,
  devopsAutomatorAgentTemplate,
  uiDesignerAgentTemplate,
  sprintPrioritizerAgentTemplate,
  growthHackerAgentTemplate,
  socialMediaStrategistAgentTemplate,
  contentCreatorAgentTemplate,
  instagramCuratorAgentTemplate,
  tiktokStrategistAgentTemplate,
];

export function projectAgentTemplateSkillInputs(
  template: ProjectAgentTemplate,
  runtime: {
    provider: AgentProvider;
    model: string | null;
    effort: ModelEffort | null;
  },
): TeamAgentSkillInput[] {
  return template.skills.map((skill, position) => ({
    ...skill,
    ...runtime,
    executionMode: "task",
    approvalPolicy: "explicit",
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
  if (template.avatar && !isTeamAgentAvatarDataUrl(template.avatar)) {
    errors.push("avatar must be a supported square image data URL");
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
      !skill.description.trim() ||
      skill.description.length > agentSkillDescriptionMaxLength
    ) {
      errors.push(
        `skill ${index + 1} description must contain 1 to ${agentSkillDescriptionMaxLength} characters`,
      );
    }
    if (!skill.body.trim() || skill.body.length > agentSkillBodyMaxLength) {
      errors.push(
        `skill ${index + 1} body must contain 1 to ${agentSkillBodyMaxLength} characters`,
      );
    }
  });
  return errors;
}

for (const template of projectAgentTemplates) {
  const errors = projectAgentTemplateValidationErrors(template);
  if (errors.length > 0) {
    throw new Error(
      `Invalid ${template.name} Agent template: ${errors.join(", ")}`,
    );
  }
}
