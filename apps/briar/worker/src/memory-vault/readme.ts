// Wrangler matches module-rule globs against the import specifier, not the
// resolved path; the Text rule in wrangler.jsonc names this file
// (scripts/worker-module-rules.test.ts).
import readme from "./memory-vault-readme.md";

/**
 * The application-owned README, served byte for byte from the copy the user
 * wrote (docs/plans/memory-vault-spec.md). Never edit the Markdown file to
 * "improve" it; `readme.test.ts` pins its sha256.
 */
export const MEMORY_VAULT_README: string = readme;
export const MEMORY_VAULT_README_PATH = "README.md";
