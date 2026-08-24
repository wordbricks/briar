import type { HuntRun, HuntRunPlacement } from "@/types";
export type KanbanColumn = {
  id: string;
  label: string;
  tone: string;
  placement: HuntRunPlacement;
  runs: HuntRun[];
  checkpointsBefore: string[];
};
export type KanbanPointerDrag = {
  active: boolean;
  pointerId: number;
  startX: number;
  startY: number;
};
export const kanbanPointerDragThreshold = 6;
export const kanbanAutoScrollEdge = 72;
export const kanbanAutoScrollInterval = 16;
export function kanbanColumnForRun(run: HuntRun, workflowStageIds: string[]) {
  if (run.status === "paused" || run.status === "running") {
    if (run.workflowStage && workflowStageIds.includes(run.workflowStage)) {
      return `stage:${run.workflowStage}`;
    }
    return workflowStageIds[0] ? `stage:${workflowStageIds[0]}` : "status:queued";
  }
  return `status:${run.status}`;
}
export function placementIdForRun(run: HuntRun) {
  return run.status === "running" && run.workflowStage ? `stage:${run.workflowStage}` : `status:${run.status}`;
}
export function placementForId(value: string): HuntRunPlacement | null {
  if (value.startsWith("stage:")) {
    const workflowStage = value.slice("stage:".length);
    return workflowStage ? {
      status: "running",
      workflowStage
    } : null;
  }
  if (!value.startsWith("status:")) return null;
  const status = value.slice("status:".length);
  if (!["backlog", "queued", "blocked", "failed", "completed", "cancelled"].includes(status)) return null;
  return {
    status: status as HuntRunPlacement["status"],
    workflowStage: null
  };
}
export function placementMatchesRun(run: HuntRun, placement: HuntRunPlacement) {
  return run.status === placement.status && (placement.status !== "running" || run.workflowStage === placement.workflowStage);
}
