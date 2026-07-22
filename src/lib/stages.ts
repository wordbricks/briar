import {
  autoHuntWorkflowStageCatalog,
  type AutoHuntRunStatus,
  type AutoHuntWorkflow,
  type AutoHuntWorkflowStageId,
} from "./auto-hunt-contract";

const workflowStageMeta = Object.fromEntries(
  autoHuntWorkflowStageCatalog.map((stage) => [stage.id, stage]),
) as unknown as Record<
  AutoHuntWorkflowStageId,
  { label: string; tone: string }
>;

const statusMeta: Record<
  AutoHuntRunStatus,
  { label: string; tone: string }
> = {
  queued: { label: "대기", tone: "slate" },
  running: { label: "진행 중", tone: "violet" },
  blocked: { label: "차단", tone: "rose" },
  failed: { label: "실패", tone: "red" },
  completed: { label: "완료", tone: "emerald" },
  cancelled: { label: "취소", tone: "slate" },
};

export function runMeta(
  status: AutoHuntRunStatus,
  workflowStage: AutoHuntWorkflowStageId | null,
  workflow?: AutoHuntWorkflow,
) {
  if (status !== "running" && status !== "blocked" && status !== "failed") {
    return statusMeta[status];
  }
  const configured = workflow?.stages.find((stage) => stage.id === workflowStage);
  const catalog = workflowStage ? workflowStageMeta[workflowStage] : null;
  if (status === "running" && (configured || catalog)) {
    return {
      label: configured?.label ?? catalog?.label ?? statusMeta.running.label,
      tone: catalog?.tone ?? statusMeta.running.tone,
    };
  }
  return statusMeta[status];
}

export function eventMeta(
  status: AutoHuntRunStatus,
  workflowStage: AutoHuntWorkflowStageId | null,
  workflow?: AutoHuntWorkflow,
) {
  const configured = workflow?.stages.find((stage) => stage.id === workflowStage);
  const catalog = workflowStage ? workflowStageMeta[workflowStage] : null;
  return configured || catalog
    ? {
        label: configured?.label ?? catalog?.label ?? statusMeta[status].label,
        tone: catalog?.tone ?? statusMeta[status].tone,
      }
    : statusMeta[status];
}

export const sourceLabel = {
  issue: "이슈",
  feedback: "피드백",
  error: "에러",
} as const;
