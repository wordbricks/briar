import type { HuntRun } from "@/types";
export type IssueWorkflowProgressState = "complete" | "active" | "paused" | "blocked" | "failed" | "cancelled" | "upcoming";
export function issueWorkflowProgressState(run: HuntRun, stageIndex: number): IssueWorkflowProgressState {
  if (run.status === "completed") return "complete";
  const currentStageId = run.status === "paused" ? run.checkpoint?.stage ?? run.workflowStage : run.workflowStage;
  const currentStageIndex = run.workflow.stages.findIndex(stage => stage.id === currentStageId);
  if (currentStageIndex < 0 || stageIndex > currentStageIndex) {
    return "upcoming";
  }
  if (stageIndex < currentStageIndex) return "complete";
  if (run.status === "running") return "active";
  if (run.status === "paused") return "paused";
  if (run.status === "blocked") return "blocked";
  if (run.status === "failed") return "failed";
  if (run.status === "cancelled") return "cancelled";
  return "upcoming";
}
