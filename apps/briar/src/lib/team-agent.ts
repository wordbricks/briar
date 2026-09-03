import type { Locale } from "../i18n/locale";
import type {
  ChannelAgentEffort as ModelEffort,
  ChannelAgentProvider as AgentProvider,
  ChannelAgentSkill as TeamAgentSkill,
} from "./channels-contract";

export type TeamAgentLocale = Locale;

export const defaultTeamAgentCalendarColor = "#3275d5";

type DefaultTeamAgentCopy = {
  name: string;
  description: string;
  responsibility: string;
};

export type DefaultTeamAgentSkillCopy = {
  name: string;
  description: string;
  body: string;
};

export type TeamAgentSkillInput = Pick<
  DefaultTeamAgentCopy,
  "name" | "responsibility"
>;

type TeamAgentRuntimeProfile = {
  name: string;
  provider: AgentProvider;
  model: string | null;
  effort: ModelEffort | null;
  responsibility: string;
  skill: string;
  skills: TeamAgentSkill[];
};

const defaultTeamAgentCopyByLocale = {
  ko: {
    name: "개발자 에이전트",
    description: "프로젝트의 개발과 코드 관련 작업을 수행하는 에이전트입니다.",
    responsibility: "프로젝트의 개발과 코드 관련 작업을 책임집니다.",
  },
  en: {
    name: "Developer agent",
    description: "Handles development and code-related work for the project.",
    responsibility: "Owns the project's development and code-related work.",
  },
  zh: {
    name: "开发者智能体",
    description: "负责项目开发和代码相关工作的智能体。",
    responsibility: "负责项目的开发和代码相关工作。",
  },
} satisfies Record<TeamAgentLocale, DefaultTeamAgentCopy>;

const defaultTeamAgentSkillCopyByLocale = {
  ko: {
    name: "이슈 처리",
    description: "프로젝트의 이슈를 구현하고 검증해야 할 때 사용합니다.",
    body: "프로젝트의 개발과 코드 관련 작업을 책임집니다.",
  },
  en: {
    name: "Issue processing",
    description: "Use when a project issue needs to be implemented and verified.",
    body: "Owns the project's development and code-related work.",
  },
  zh: {
    name: "问题处理",
    description: "当需要实现并验证项目问题时使用。",
    body: "负责项目的开发和代码相关工作。",
  },
} satisfies Record<TeamAgentLocale, DefaultTeamAgentSkillCopy>;

export function normalizeTeamAgentLocale(
  value: string | null | undefined,
): TeamAgentLocale {
  const locale = value?.trim().toLowerCase();
  if (locale?.startsWith("ko")) return "ko";
  if (locale?.startsWith("zh")) return "zh";
  return "en";
}

export function defaultTeamAgentCopy(
  locale: TeamAgentLocale,
): DefaultTeamAgentCopy {
  return defaultTeamAgentCopyByLocale[locale];
}

export function defaultTeamAgentSkillCopy(
  locale: TeamAgentLocale,
): DefaultTeamAgentSkillCopy {
  return defaultTeamAgentSkillCopyByLocale[locale];
}

export function defaultTeamAgentSkill(input: {
  id: string;
  agentId: string;
  locale: TeamAgentLocale;
  provider?: AgentProvider;
  model?: string | null;
  effort?: ModelEffort | null;
  createdAt: string;
  updatedAt?: string;
}): TeamAgentSkill {
  const copy = defaultTeamAgentSkillCopy(input.locale);
  return {
    id: input.id,
    agentId: input.agentId,
    name: copy.name,
    description: copy.description,
    body: copy.body,
    provider: input.provider ?? "codex",
    model: input.model ?? null,
    effort: input.effort ?? null,
    kind: "issue_processing",
    executionMode: "task",
    approvalPolicy: "explicit",
    position: 0,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt ?? input.createdAt,
  };
}

export function teamAgentSkill({
  name,
  responsibility,
}: TeamAgentSkillInput) {
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

function teamAgentSkillRoster(
  agent: Pick<
    TeamAgentRuntimeProfile,
    "name" | "responsibility" | "skills"
  >,
  activeSkill: TeamAgentSkill | null,
) {
  const skills = [...agent.skills]
    .sort((left, right) => left.position - right.position)
    .map(
      (skill) => `### ${skill.name.trim()}${
        skill.id === activeSkill?.id ? " (active)" : ""
      }

${skill.description.trim()}

${skill.body.trim()}`,
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
  T extends TeamAgentRuntimeProfile,
>(agent: T): T {
  return {
    ...agent,
    skill: teamAgentSkillRoster(agent, null),
  } as T;
}

export function agentWithSkillRuntime<
  T extends TeamAgentRuntimeProfile,
>(
  agent: T,
  activeSkill: TeamAgentSkill,
): T {
  return {
    ...agent,
    provider: activeSkill.provider,
    model: activeSkill.model,
    effort: activeSkill.effort,
    skill: teamAgentSkillRoster(agent, activeSkill),
  } as T;
}
