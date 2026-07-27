import type { ProjectAgent } from "../types";
import {
  defaultProjectAgentCopy,
  type ProjectAgentLocale,
} from "./project-agent";

export function demoProjectAgents(
  projectId: string,
  locale: ProjectAgentLocale,
): ProjectAgent[] {
  const createdAt = new Date("2026-07-26T09:00:00.000Z").toISOString();
  const defaultAgent = defaultProjectAgentCopy(locale);
  return [
    {
      id: "demo-agent-auto-hunt",
      projectId,
      name: defaultAgent.name,
      provider: "codex",
      model: null,
      responsibility: defaultAgent.responsibility,
      kind: "auto_hunt",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "demo-agent-sentry",
      projectId,
      name: "Sentry 오류 탐지 에이전트",
      provider: "claude",
      model: "opus",
      responsibility:
        "Sentry의 에러 내역들을 보고 issue를 만들어서 배정하는 에이전트",
      kind: "custom",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "demo-agent-feedback",
      projectId,
      name: "Feedback 분석 에이전트",
      provider: "grok",
      model: "grok-4.5",
      responsibility:
        "유저 피드백 채널에 들어오는 피드백을 취합하고 분석해서 액션아이템을 만들어 이슈를 만드는 에이전트",
      kind: "custom",
      createdAt,
      updatedAt: createdAt,
    },
  ];
}
