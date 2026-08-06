import type { AutoHuntWorkflow } from "./auto-hunt-contract";

export type ProjectAgentLocale = "ko" | "en" | "zh";

export const defaultProjectAgentCalendarColor = "#3275d5";
export const projectAgentCalendarColorPattern = /^#[0-9a-f]{6}$/iu;

type DefaultProjectAgentCopy = {
  name: string;
  responsibility: string;
};

export type ProjectAgentSkillInput = DefaultProjectAgentCopy;

const defaultProjectAgentCopyByLocale: Record<
  ProjectAgentLocale,
  DefaultProjectAgentCopy
> = {
  ko: {
    name: "이슈 처리 에이전트",
    responsibility: "대기 중인 모든 이슈를 처리합니다.",
  },
  en: {
    name: "Issue processing agent",
    responsibility: "Process every queued issue.",
  },
  zh: {
    name: "问题处理智能体",
    responsibility: "处理所有排队中的问题。",
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
