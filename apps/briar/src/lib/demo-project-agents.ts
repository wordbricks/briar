import type { ProjectAgent } from "../types";
import {
  defaultProjectAgentCopy,
  defaultProjectAgentCalendarColor,
  defaultProjectAgentSkill,
  projectAgentSkill,
  type ProjectAgentLocale,
} from "./project-agent";

export function demoProjectAgents(
  projectId: string,
  locale: ProjectAgentLocale,
): ProjectAgent[] {
  const createdAt = new Date("2026-07-26T09:00:00.000Z").toISOString();
  const defaultAgent = defaultProjectAgentCopy(locale);
  const customSkill = (input: {
    id: string;
    agentId: string;
    name: string;
    description: string;
    body: string;
    provider: ProjectAgent["provider"];
    model: string | null;
  }): ProjectAgent["skills"][number] => ({
    ...input,
    effort: null,
    kind: "custom",
    position: 0,
    createdAt,
    updatedAt: createdAt,
  });
  return [
    {
      id: "demo-agent-auto-hunt",
      projectId,
      name: defaultAgent.name,
      avatar: null,
      codexPet: null,
      provider: "codex",
      model: null,
      effort: null,
      description: defaultAgent.description,
      responsibility: defaultAgent.responsibility,
      skill: projectAgentSkill(defaultAgent),
      skills: [
        defaultProjectAgentSkill({
          id: "demo-skill-issue-processing",
          agentId: "demo-agent-auto-hunt",
          locale,
          createdAt,
        }),
      ],
      calendarColor: defaultProjectAgentCalendarColor,
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "demo-agent-sentry",
      projectId,
      name: "Sentry 오류 탐지 에이전트",
      avatar: null,
      codexPet: null,
      provider: "claude",
      model: "opus",
      effort: null,
      description: "Sentry 오류를 분석해 실행 가능한 이슈로 정리합니다.",
      responsibility:
        "Sentry의 에러 내역들을 보고 issue를 만들어서 배정하는 에이전트",
      skill: projectAgentSkill({
        name: "Sentry 오류 탐지 에이전트",
        responsibility:
          "Sentry의 에러 내역들을 보고 issue를 만들어서 배정하는 에이전트",
      }),
      skills: [
        customSkill({
          id: "demo-skill-sentry",
          agentId: "demo-agent-sentry",
          name: "Sentry 오류 탐지",
          description: "Sentry 오류를 분석해 실행 가능한 이슈로 정리해야 할 때 사용합니다.",
          body:
            "Sentry의 에러 내역을 확인하고 필요한 이슈를 만들어 배정합니다.",
          provider: "claude",
          model: "opus",
        }),
      ],
      calendarColor: "#8b5cf6",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "demo-agent-feedback",
      projectId,
      name: "Feedback 분석 에이전트",
      avatar: null,
      codexPet: null,
      provider: "grok",
      model: "grok-4.5",
      effort: null,
      description: "사용자 피드백을 분석해 제품 액션 아이템을 도출합니다.",
      responsibility:
        "유저 피드백 채널에 들어오는 피드백을 취합하고 분석해서 액션아이템을 만들어 이슈를 만드는 에이전트",
      skill: projectAgentSkill({
        name: "Feedback 분석 에이전트",
        responsibility:
          "유저 피드백 채널에 들어오는 피드백을 취합하고 분석해서 액션아이템을 만들어 이슈를 만드는 에이전트",
      }),
      skills: [
        customSkill({
          id: "demo-skill-feedback",
          agentId: "demo-agent-feedback",
          name: "Feedback 분석",
          description: "사용자 피드백에서 제품 액션 아이템을 도출해야 할 때 사용합니다.",
          body:
            "채널 피드백을 취합하고 분석해 액션 아이템을 이슈로 만듭니다.",
          provider: "grok",
          model: "grok-4.5",
        }),
      ],
      calendarColor: "#0f9f76",
      createdAt,
      updatedAt: createdAt,
    },
  ];
}
