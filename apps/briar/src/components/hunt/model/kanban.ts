import type { HuntRun, HuntRunPlacement } from "@/types";

/*
  Where a run sits on the board, as ids.

  The column list itself moved to `state/board/columns.ts` when the board
  started drawing itself from the store; what is left here is the placement a
  run reports and the placement a menu option asks for, which the issue detail
  and the context menu both need without a board around them.
*/
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
