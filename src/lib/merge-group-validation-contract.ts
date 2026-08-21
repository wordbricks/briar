export const MERGE_GROUP_CI_PROTOCOL = 1;
export const MERGE_GROUP_CI_IMAGE_REPOSITORY =
  "ghcr.io/wordbricks/briar-merge-group-ci";

// Publishing and enabling an independently reproduced digest is a separate
// rollout step. No production path may run a mutable tag or an unverified
// digest from this foundation PR.
export const MERGE_GROUP_CI_AUDITED_IMAGE: string | null = null;

export const MERGE_GROUP_CI_CONTEXTS = [
  "app-worker",
  "d1-migrations",
  "rust",
  "security",
] as const;

export type MergeGroupCiContext = typeof MERGE_GROUP_CI_CONTEXTS[number];

export const MERGE_GROUP_CI_PROFILE_PATH = "scripts/ci-local.sh";
export const MERGE_GROUP_CI_BUN_CONFIG_PATH =
  "config/merge-group-bunfig.toml";
export const MERGE_GROUP_CI_VITEST_CONFIG_PATH =
  "config/merge-group-vitest.config.ts";
export const MERGE_GROUP_CI_VITEST_SETUP_PATH =
  "config/merge-group-vitest.setup.ts";

export const MERGE_GROUP_CI_TRUSTED_FILES = [
  [MERGE_GROUP_CI_PROFILE_PATH, "ci-local.sh"],
  [MERGE_GROUP_CI_BUN_CONFIG_PATH, "bunfig.toml"],
  [MERGE_GROUP_CI_VITEST_CONFIG_PATH, "vitest.config.ts"],
  [MERGE_GROUP_CI_VITEST_SETUP_PATH, "vitest.setup.ts"],
] as const;

export const MERGE_GROUP_CI_DEFAULT_DEADLINE_MS = 20 * 60_000;
export const MERGE_GROUP_CI_MAX_DEADLINE_MS = 25 * 60_000;
export const MERGE_GROUP_CI_CONTEXT_CONCURRENCY = 2;
export const MERGE_GROUP_CI_RETAINED_LOG_BYTES = 256 * 1_024;
export const MERGE_GROUP_CI_MAX_OUTPUT_BYTES = 2 * 1_024 * 1_024;

export const MERGE_GROUP_CI_CONTAINER_LIMITS = {
  cpus: "2",
  memory: "8g",
  pids: "512",
  scratch: "6g",
  tmp: "1g",
} as const;
