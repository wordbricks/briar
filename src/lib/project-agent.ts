import type { AutoHuntWorkflow } from "./auto-hunt-contract";
import type { AgentProvider, ModelEffort } from "./project-llm";
import type { ProjectAgent, ProjectAgentSkill } from "../types";

export type ProjectAgentLocale = "ko" | "en" | "zh";

export const defaultProjectAgentCalendarColor = "#3275d5";
export const projectAgentCalendarColorPattern = /^#[0-9a-f]{6}$/iu;

type DefaultProjectAgentCopy = {
  name: string;
  responsibility: string;
};

export type DefaultProjectAgentSkillCopy = {
  name: string;
  instructions: string;
};

export type ProjectAgentSkillInput = DefaultProjectAgentCopy;

const defaultProjectAgentCopyByLocale: Record<
  ProjectAgentLocale,
  DefaultProjectAgentCopy
> = {
  ko: {
    name: "개발자 에이전트",
    responsibility: "대기 중인 모든 이슈를 처리합니다.",
  },
  en: {
    name: "Developer agent",
    responsibility: "Process every queued issue.",
  },
  zh: {
    name: "开发者智能体",
    responsibility: "处理所有排队中的问题。",
  },
};

const defaultProjectAgentSkillCopyByLocale: Record<
  ProjectAgentLocale,
  DefaultProjectAgentSkillCopy
> = {
  ko: {
    name: "이슈 처리",
    instructions: "대기 중인 모든 이슈를 처리합니다.",
  },
  en: {
    name: "Issue processing",
    instructions: "Process every queued issue.",
  },
  zh: {
    name: "问题处理",
    instructions: "处理所有排队中的问题。",
  },
};

export function normalizeProjectAgentLocale(
  value: string | null | undefined,
): ProjectAgentLocale {
  const locale = value?.trim().toLowerCase();
  if (locale?.startsWith("ko")) return "ko";
  if (locale?.startsWith("zh")) return "zh";
  return "en";
}

export function defaultProjectAgentCopy(
  locale: ProjectAgentLocale,
): DefaultProjectAgentCopy {
  return defaultProjectAgentCopyByLocale[locale];
}

export function defaultProjectAgentSkillCopy(
  locale: ProjectAgentLocale,
): DefaultProjectAgentSkillCopy {
  return defaultProjectAgentSkillCopyByLocale[locale];
}

export function defaultProjectAgentSkill(input: {
  id: string;
  agentId: string;
  locale: ProjectAgentLocale;
  provider?: AgentProvider;
  model?: string | null;
  effort?: ModelEffort | null;
  createdAt: string;
  updatedAt?: string;
}): ProjectAgentSkill {
  const copy = defaultProjectAgentSkillCopy(input.locale);
  return {
    id: input.id,
    agentId: input.agentId,
    name: copy.name,
    instructions: copy.instructions,
    provider: input.provider ?? "codex",
    model: input.model ?? null,
    effort: input.effort ?? null,
    kind: "issue_processing",
    isDefault: true,
    position: 0,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt ?? input.createdAt,
  };
}

export function projectAgentSkill({
  name,
  responsibility,
}: ProjectAgentSkillInput) {
  const execution = `- Read the attached project workflow before acting.
- Follow its required stages, checks, evidence, and completion rules when they apply.
- Follow the invocation's workspace and execution-mode instructions; do not infer queue work.
- Report only results that were actually observed.`;
  return `# ${name.trim()}

## Responsibility

${responsibility.trim()}

## Execution

${execution}
`;
}

export function defaultAgentSkill(
  agent: Pick<ProjectAgent, "skills">,
): ProjectAgentSkill | null {
  return (
    agent.skills.find((skill) => skill.isDefault) ?? agent.skills[0] ?? null
  );
}

export function issueProcessingAgentSkill(
  agent: Pick<ProjectAgent, "skills">,
): ProjectAgentSkill | null {
  return (
    agent.skills.find((skill) => skill.kind === "issue_processing") ??
    defaultAgentSkill(agent)
  );
}

function projectAgentSkillRoster(
  agent: Pick<ProjectAgent, "name" | "responsibility" | "skills">,
  activeSkill: ProjectAgentSkill,
) {
  const skills = [...agent.skills]
    .sort((left, right) => left.position - right.position)
    .map(
      (skill) => `### ${skill.name.trim()}${
        skill.id === activeSkill.id ? " (active)" : ""
      }

${skill.instructions.trim()}`,
    )
    .join("\n\n");
  return `# ${agent.name.trim()}

## Responsibility

${agent.responsibility.trim()}

## Available skills

${skills}

## Active skill

Use **${activeSkill.name.trim()}** for this invocation. Follow its instructions while remaining aware of the other skills you can perform.

## Execution

- Read the attached project workflow before acting.
- Follow its required stages, checks, evidence, and completion rules when they apply.
- Follow the invocation's workspace and execution-mode instructions; do not infer queue work.
- Report only results that were actually observed.
`;
}

export function agentWithSkillRuntime<
  T extends Pick<
    ProjectAgent,
    | "name"
    | "provider"
    | "model"
    | "effort"
    | "responsibility"
    | "skill"
    | "skills"
  >,
>(
  agent: T,
  activeSkill: ProjectAgentSkill,
): T {
  return {
    ...agent,
    provider: activeSkill.provider,
    model: activeSkill.model,
    effort: activeSkill.effort,
    skill: projectAgentSkillRoster(agent, activeSkill),
  } as T;
}

export function projectAgentRuntimeInstructions(input: {
  skill: string;
  workflow: AutoHuntWorkflow;
  invocation: string;
}) {
  return `${input.invocation.trim()}

## Agent skill

${input.skill.trim()}

## Project workflow

Follow these stages in order. A claimed run's workflow snapshot overrides this project-level snapshot.

${JSON.stringify(input.workflow, null, 2)}
`;
}
