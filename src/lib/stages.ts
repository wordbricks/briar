import type { HuntStage } from "../types";

export const stageMeta: Record<
  HuntStage,
  { label: string; progress: number; tone: string }
> = {
  queued: { label: "대기", progress: 10, tone: "slate" },
  analyzing: { label: "분석", progress: 25, tone: "blue" },
  implementing: { label: "구현", progress: 45, tone: "violet" },
  pr_open: { label: "PR 검증", progress: 65, tone: "indigo" },
  staging_qa: { label: "Stage QA", progress: 80, tone: "amber" },
  production_qa: { label: "Production QA", progress: 92, tone: "orange" },
  completed: { label: "완료", progress: 100, tone: "emerald" },
  blocked: { label: "차단", progress: 50, tone: "rose" },
  failed: { label: "실패", progress: 50, tone: "red" },
  cancelled: { label: "취소", progress: 0, tone: "slate" },
};

export const sourceLabel = {
  issue: "이슈",
  feedback: "피드백",
  error: "에러",
} as const;
