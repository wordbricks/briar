import { checkpointKeyForBoundary, type AutoHuntWorkflow, type AutoHuntWorkflowCheckpoint, type AutoHuntWorkflowCheckpointPosition } from "@/lib/auto-hunt-contract";
import type { HuntRun } from "@/types";
export const checkpointBoundaryKey = (checkpoint: Pick<AutoHuntWorkflowCheckpoint, "stage" | "position">) => `${checkpoint.stage}:${checkpoint.position}`;
export const issueCheckpoint = (stage: string, position: AutoHuntWorkflowCheckpointPosition): AutoHuntWorkflowCheckpoint => ({
  key: checkpointKeyForBoundary("issue", {
    stage,
    position
  }),
  stage,
  position
});
export function toggleIssueCheckpoint(checkpoints: AutoHuntWorkflowCheckpoint[], stage: string, position: AutoHuntWorkflowCheckpointPosition) {
  const boundary = `${stage}:${position}`;
  return checkpoints.some(checkpoint => checkpointBoundaryKey(checkpoint) === boundary) ? checkpoints.filter(checkpoint => checkpointBoundaryKey(checkpoint) !== boundary) : [...checkpoints, issueCheckpoint(stage, position)];
}
export function inheritedCheckpointBoundaries(workflow: AutoHuntWorkflow, issueCheckpoints: AutoHuntWorkflowCheckpoint[]) {
  const issueBoundaries = new Set(issueCheckpoints.map(checkpointBoundaryKey));
  return new Set(workflow.execution.checkpoints.filter(checkpoint => !issueBoundaries.has(checkpointBoundaryKey(checkpoint))).map(checkpointBoundaryKey));
}
export function canEditIssueCheckpoints(run: HuntRun) {
  return ["backlog", "queued"].includes(run.status) && !run.claimedAt && !(run.leaseExpiresAt && Date.parse(run.leaseExpiresAt) > Date.now());
}
