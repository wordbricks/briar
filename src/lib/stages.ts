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
  backlog: { label: "백로그", tone: "slate" },
  queued: { label: "대기", tone: "slate" },
  running: { label: "진행 중", tone: "violet" },
  paused: { label: "검토 대기", tone: "amber" },
  blocked: { label: "차단", tone: "rose" },
  failed: { label: "실패", tone: "red" },
  completed: { label: "완료", tone: "emerald" },
  cancelled: { label: "취소", tone: "slate" },
};

type DisplayStatus = AutoHuntRunStatus | AutoHuntWorkflowStageId;

function displayMetaForStatus(status: DisplayStatus) {
  const runStatus = statusMeta[status as AutoHuntRunStatus];
  if (runStatus) return runStatus;

  const matchingStage = workflowStageMeta[status as AutoHuntWorkflowStageId];
  return matchingStage
    ? { label: matchingStage.label, tone: matchingStage.tone }
    : { label: status, tone: "slate" };
}

export function runMeta(
  status: DisplayStatus,
  workflowStage: AutoHuntWorkflowStageId | null | undefined,
  workflow?: AutoHuntWorkflow,
) {
  const statusDisplay = displayMetaForStatus(status);
  if (status !== "running" && status !== "blocked" && status !== "failed") {
    return statusDisplay;
  }
  const configured = workflow?.stages.find((stage) => stage.id === workflowStage);
  const catalog = workflowStage ? workflowStageMeta[workflowStage] : null;
  if (status === "running" && (configured || catalog)) {
    return {
      label: configured?.label ?? catalog?.label ?? statusMeta.running.label,
      tone: catalog?.tone ?? statusMeta.running.tone,
    };
  }
  return statusDisplay;
}

export function eventMeta(
  status: DisplayStatus,
  workflowStage: AutoHuntWorkflowStageId | null | undefined,
  workflow?: AutoHuntWorkflow,
) {
  const statusDisplay = displayMetaForStatus(status);
  const configured = workflow?.stages.find((stage) => stage.id === workflowStage);
  const catalog = workflowStage ? workflowStageMeta[workflowStage] : null;
  return configured || catalog
    ? {
        label: configured?.label ?? catalog?.label ?? statusDisplay.label,
        tone: catalog?.tone ?? statusDisplay.tone,
      }
    : statusDisplay;
}

export const sourceLabel = {
  issue: "이슈",
  feedback: "피드백",
  error: "에러",
} as const;
