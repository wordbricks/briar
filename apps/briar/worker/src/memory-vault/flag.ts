/**
 * The deployment switch (wrangler var `MEMORY_VAULT_ENABLED`, "false" until
 * rollout). On, the vault serves memory for every run that has one and the
 * legacy D1 DM memory path stops: no legacy descriptor, brief, lookup or
 * learning, and the owner's DM memory dialog is served from the vault
 * (docs/operations/memory-vault.md). Off, everything behaves as before the
 * vault existed. Dependency-free so claim, completion and channel code can
 * read it without importing the vault.
 */
export type MemoryVaultEnv = { readonly MEMORY_VAULT_ENABLED?: string };

export const memoryVaultEnabled = (env: MemoryVaultEnv) =>
  String(env.MEMORY_VAULT_ENABLED) === "true";
