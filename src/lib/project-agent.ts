import type { AutoHuntWorkflow } from "./auto-hunt-contract";

export type ProjectAgentLocale = "ko" | "en" | "zh";

export const defaultProjectAgentCalendarColor = "#3275d5";
export const projectAgentCalendarColorPattern = /^#[0-9a-f]{6}$/iu;

type DefaultProjectAgentCopy = {
  name: string;
  responsibility: string;
};

export type ProjectAgentSkillInput = DefaultProjectAgentCopy & {
  kind: "auto_hunt" | "custom";
};

const defaultProjectAgentCopyByLocale: Record<
  ProjectAgentLocale,
  DefaultProjectAgentCopy
> = {
  ko: {
    name: "자동 사냥 에이전트",
    responsibility: "모든 대기중인 이슈에 대해서 자동사냥을 수행하는것",
  },
  en: {
    name: "Auto Hunt agent",
    responsibility: "Perform Auto Hunt for every queued issue.",
  },
  zh: {
    name: "自动狩猎智能体",
    responsibility: "对所有排队中的问题执行自动狩猎。",
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
  kind,
}: ProjectAgentSkillInput) {
  const execution = kind === "auto_hunt"
    ? `- Load the installed \`briar-workflow\` guide with \`briar skills get briar-workflow\`.
- Work only on the run and worktree allocated by the Briar host runtime; never claim another run or create another worktree.
- Read the claimed run's workflow snapshot before acting and use explicit \`--run\` arguments for every run and evidence command.
- Record every required stage and its evidence before completing a run.`
    : `- Read the attached project workflow before acting.
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
