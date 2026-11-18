import { describe, expect, it } from "vitest";
import { ArtifactsVaultGitStore } from "./artifacts-git-store";
import { VaultRepoNotFoundError, VaultStoreUnavailableError } from "./git-store";

/** A binding whose `get` always fails with `error`. */
const failingGet = (error: unknown) => ({
  get: async () => { throw error; },
}) as unknown as Artifacts;

const name = "mv-0123456789abcdef0123456789abcdef-g1";

describe("ArtifactsVaultGitStore repository lookup", () => {
  it("reads a NOT_FOUND code as a missing repository", async () => {
    const store = new ArtifactsVaultGitStore(failingGet(Object.assign(new Error("gone"), { code: "NOT_FOUND" })));
    expect(await store.repoExists(name)).toBe(false);
  });

  it("reads the message as a missing repository when a wrangler dev remote binding dropped the code", async () => {
    // Exactly what the 2026-10-14 memory vault e2e run saw after a purge deleted generation 1.
    const store = new ArtifactsVaultGitStore(failingGet(new Error(`ArtifactsError: Repository not found: ${name}.`)));
    expect(await store.repoExists(name)).toBe(false);
    await expect(store.readFile(name, "0".repeat(40), "README.md")).rejects.toBeInstanceOf(VaultRepoNotFoundError);
  });

  it("does not read another repository's not-found message, or any other failure, as missing", async () => {
    const other = new ArtifactsVaultGitStore(failingGet(new Error("ArtifactsError: Repository not found: mv-other-g1.")));
    await expect(other.repoExists(name)).rejects.toBeInstanceOf(VaultStoreUnavailableError);
    const outage = new ArtifactsVaultGitStore(failingGet(new Error("Network connection lost.")));
    await expect(outage.repoExists(name)).rejects.toBeInstanceOf(VaultStoreUnavailableError);
  });
});
