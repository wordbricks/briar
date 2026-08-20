import type { AutoHuntWorkflow } from "./auto-hunt-contract";

export const MERGE_GROUP_CI_CAPABILITY = "merge_group_ci";
export const MERGE_GROUP_CI_PROTOCOL = 2;
export const MERGE_GROUP_VALIDATION_COMMAND = [
  "docker",
  "run",
  "--network=none",
] as const;
export const MERGE_GROUP_VALIDATION_PROFILE_PATH = "scripts/ci-local.sh";
export const MERGE_GROUP_VALIDATION_DEFINITION_PATHS = [
  "package.json",
  "bun.lock",
  "tsconfig.json",
  "worker/tsconfig.json",
  "vite.config.ts",
  "wrangler.jsonc",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
  ".gitleaks.toml",
  MERGE_GROUP_VALIDATION_PROFILE_PATH,
  "scripts/audit-dependencies.sh",
  "scripts/audit-rust-dependencies.sh",
  "scripts/generate-skill-guides.ts",
  "scripts/ios-release-config.ts",
  "scripts/prepare-bun-sidecar.ts",
  "scripts/verify-encrypted-env.ts",
  "scripts/verify-release-config.sh",
  "scripts/with-release-env.sh",
] as const;
export const MERGE_GROUP_MAX_ENTRIES_TO_BUILD = 5;
export const MERGE_GROUP_MIN_ENTRIES_TO_MERGE = 2;
export const MERGE_GROUP_MAX_ENTRIES_TO_MERGE = 5;
export const MERGE_GROUP_MIN_WAIT_MINUTES = 5;
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
