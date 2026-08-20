import type { AutoHuntWorkflow } from "./auto-hunt-contract";

export const MERGE_GROUP_CI_CAPABILITY = "merge_group_ci";
export const MERGE_GROUP_CI_PROTOCOL = 1;
export const MERGE_GROUP_VALIDATION_COMMAND = [
  "bun",
  "run",
  "ci:local",
] as const;
export const MERGE_GROUP_STATUS_CONTEXTS = [
  "signoff/app-worker",
  "signoff/d1-migrations",
  "signoff/rust",
  "signoff/security",
] as const;
export const MERGE_WAIT_CHECKPOINT = {
  key: "issue-before-merged",
  stage: "merged",
  position: "before",
} as const;
export const MERGE_WAIT_CHECKPOINT_KEYS = [
  "issue-before-merged",
  "project-before-merged",
] as const;

export function hasCanonicalMergeWaitCheckpoint(
  workflow: Pick<AutoHuntWorkflow, "stages" | "execution">,
) {
  return workflow.stages.some((stage) => stage.id === MERGE_WAIT_CHECKPOINT.stage) &&
    workflow.execution.checkpoints.some((checkpoint) =>
      MERGE_WAIT_CHECKPOINT_KEYS.some((key) => checkpoint.key === key) &&
      checkpoint.stage === MERGE_WAIT_CHECKPOINT.stage &&
      checkpoint.position === MERGE_WAIT_CHECKPOINT.position
    );
}

export function assertCanonicalMergeWaitCheckpoint(
  workflow: Pick<AutoHuntWorkflow, "stages" | "execution">,
) {
  if (!hasCanonicalMergeWaitCheckpoint(workflow)) {
    throw new Error(
      "Merge queue requires the canonical before-merged checkpoint",
    );
  }
}
