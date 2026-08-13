import type { Locale } from "../i18n/locale";
import type {
  ChannelAgentEffort as ModelEffort,
  ChannelAgentProvider as AgentProvider,
  ChannelAgentSkill as ProjectAgentSkill,
} from "./channels-contract";

export type ProjectAgentLocale = Locale;

export const defaultProjectAgentCalendarColor = "#3275d5";

type DefaultProjectAgentCopy = {
  name: string;
  responsibility: string;
};

export type DefaultProjectAgentSkillCopy = {
  name: string;
  instructions: string;
};

export type ProjectAgentSkillInput = DefaultProjectAgentCopy;

type ProjectAgentRuntimeProfile = {
  name: string;
  provider: AgentProvider;
  model: string | null;
  effort: ModelEffort | null;
  responsibility: string;
  skill: string;
  skills: ProjectAgentSkill[];
};

const defaultProjectAgentCopyByLocale: Record<
  ProjectAgentLocale,
  DefaultProjectAgentCopy
> = {
  ko: {
    name: "개발자 에이전트",
    responsibility: "프로젝트의 개발과 코드 관련 작업을 책임집니다.",
  },
  en: {
    name: "Developer agent",
    responsibility: "Owns the project's development and code-related work.",
  },
  zh: {
    name: "开发者智能体",
    responsibility: "负责项目的开发和代码相关工作。",
  },
};

const defaultProjectAgentSkillCopyByLocale: Record<
  ProjectAgentLocale,
  DefaultProjectAgentSkillCopy
> = {
  ko: {
    name: "이슈 처리",
    instructions: "프로젝트의 개발과 코드 관련 작업을 책임집니다.",
  },
  en: {
    name: "Issue processing",
    instructions: "Owns the project's development and code-related work.",
  },
  zh: {
    name: "问题处理",
    instructions: "负责项目的开发和代码相关工作。",
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

function projectAgentSkillRoster(
  agent: Pick<
    ProjectAgentRuntimeProfile,
    "name" | "responsibility" | "skills"
  >,
  activeSkill: ProjectAgentSkill | null,
) {
  const skills = [...agent.skills]
    .sort((left, right) => left.position - right.position)
    .map(
      (skill) => `### ${skill.name.trim()}${
        skill.id === activeSkill?.id ? " (active)" : ""
      }

${skill.instructions.trim()}`,
    )
    .join("\n\n");
  return `# ${agent.name.trim()}

## Responsibility

${agent.responsibility.trim()}

## Available skills

${skills || "No skills are configured for this Agent."}

${activeSkill
    ? `## Active skill

Use **${activeSkill.name.trim()}** for this invocation. Follow its instructions while remaining aware of the other skills you can perform.`
    : `## Skill selection

No Skill was preselected for this invocation. Choose the one available Skill that best matches the request. Apply only that Skill's instructions while staying within the Agent's responsibility. If none applies, act only within the responsibility.`}

## Execution

- Read the attached project workflow before acting.
- Follow its required stages, checks, evidence, and completion rules when they apply.
- Follow the invocation's workspace and execution-mode instructions; do not infer queue work.
- Report only results that were actually observed.
`;
}

export function agentWithSkillsRuntime<
  T extends ProjectAgentRuntimeProfile,
>(agent: T): T {
  return {
    ...agent,
    skill: projectAgentSkillRoster(agent, null),
  } as T;
}

export function agentWithSkillRuntime<
  T extends ProjectAgentRuntimeProfile,
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
