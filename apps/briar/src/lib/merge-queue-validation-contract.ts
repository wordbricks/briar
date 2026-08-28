export const MERGE_QUEUE_VALIDATION_CONTEXT = "merge-queue" as const;
export const MERGE_QUEUE_GITHUB_STATUS_CONTEXT = "briar/merge-queue" as const;
export const MERGE_QUEUE_VALIDATION_SOURCE_REF_PREFIX =
  "refs/briar/merge-group-validation";
export const MERGE_QUEUE_VALIDATION_BASE_REF_PREFIX =
  "refs/briar/merge-group-validation-base";
export const MERGE_QUEUE_VALIDATION_COMMAND_TIMEOUT_MS = 20 * 60_000;
export const MERGE_QUEUE_VALIDATION_MAX_COMMANDS = 20;
