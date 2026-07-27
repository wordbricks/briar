export type ProjectAgentLocale = "ko" | "en" | "zh";

type DefaultProjectAgentCopy = {
  name: string;
  responsibility: string;
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
