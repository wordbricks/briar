export const MERGE_GROUP_CI_PROTOCOL = 1;
export const MERGE_GROUP_CI_IMAGE_REPOSITORY =
  "ghcr.io/wordbricks/briar-merge-group-ci";
export const MERGE_GROUP_CI_SOURCE_REF_PREFIX =
  "refs/briar/merge-group-validation";
export const MERGE_GROUP_CI_PROTECTED_BASE_REF_PREFIX =
  "refs/briar/merge-group-validation-base";

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

// Every phase receives a fresh exact-head checkout in a new container. Keep
// candidate-executing phases separate so one successful command cannot rewrite
// the tools or workspace used by a later required command.
export const MERGE_GROUP_CI_PHASES = {
  "app-worker": [
    "app-check",
    "app-d1-prepare",
    "app-test",
    "app-shell",
    "app-ios-verify",
    "app-build",
    "app-release-build",
    "app-worker-check",
    "app-worker-build",
    "app-worker-startup",
  ],
  "d1-migrations": ["d1-apply", "d1-test"],
  rust: ["rust-fmt", "rust-clippy", "rust-test"],
  security: [
    "security-bun-audit",
    "security-rust-audit",
    "security-encrypted-env",
    "security-gitleaks",
  ],
} as const satisfies Record<MergeGroupCiContext, readonly string[]>;

export type MergeGroupCiPhase =
  typeof MERGE_GROUP_CI_PHASES[MergeGroupCiContext][number];

export const MERGE_GROUP_CI_PROFILE_PATH = "scripts/ci-merge-group.sh";
export const MERGE_GROUP_CI_LOCAL_PROFILE_PATH = "scripts/ci-local.sh";
export const MERGE_GROUP_CI_BUN_CONFIG_PATH =
  "config/merge-group-bunfig.toml";

export const MERGE_GROUP_CI_TRUSTED_FILES = [
  [MERGE_GROUP_CI_PROFILE_PATH, "ci-merge-group.sh"],
  [MERGE_GROUP_CI_LOCAL_PROFILE_PATH, "ci-local.sh"],
  [MERGE_GROUP_CI_BUN_CONFIG_PATH, "bunfig.toml"],
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
