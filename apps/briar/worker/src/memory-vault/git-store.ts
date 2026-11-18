/**
 * The storage contract the memory vault domain needs from a Git host. The
 * production implementation talks to Cloudflare Artifacts
 * (`artifacts-git-store.ts`); tests use `InMemoryVaultGitStore`, which runs the
 * same object code over in-memory repositories.
 *
 * Every write is a compare-and-swap on `main`: `write` hands the plan the head
 * it observed, and a push that would not fast-forward from that head is
 * reported as `conflict`, never forced.
 */
export type VaultSnapshot = {
  readonly commit: string | null;
  readonly files: ReadonlyMap<string, string>;
};

export type VaultWritePlan<T> =
  | {
      readonly kind: "commit";
      /** The complete file set of the new commit. */
      readonly files: ReadonlyMap<string, string>;
      readonly message: string;
      /** Unix seconds. */
      readonly timestamp: number;
      readonly value: T;
    }
  | { readonly kind: "skip"; readonly value: T };

export type VaultWriteOutcome<T> =
  | { readonly kind: "committed"; readonly commit: string; readonly value: T }
  | { readonly kind: "skipped"; readonly head: string | null; readonly value: T }
  | { readonly kind: "conflict" };

export type VaultCommit = {
  readonly oid: string;
  readonly parents: readonly string[];
  readonly message: string;
  /** ISO 8601 author time. */
  readonly authoredAt: string;
};

export type VaultRewriteResult = {
  /** The source head the rewrite started from. */
  readonly sourceHead: string | null;
  readonly sourceHeadTree: string | null;
  readonly head: string | null;
  readonly headTree: string | null;
  readonly mapping: ReadonlyMap<string, string>;
};

export type VaultRepoListing = { readonly name: string; readonly createdAt: string };

export interface VaultGitStore {
  /** Creates the repository; an existing one is left as it is. */
  createRepo(name: string): Promise<void>;
  /** Deletes the repository; false when it did not exist. */
  deleteRepo(name: string): Promise<boolean>;
  repoExists(name: string): Promise<boolean>;
  /** Current `main` commit; null for an empty repository. */
  head(name: string): Promise<string | null>;
  readFile(name: string, commit: string, path: string): Promise<string | null>;
  /** All files at `commit` (default: head). */
  snapshot(name: string, commit?: string): Promise<VaultSnapshot>;
  /** First-parent history from head, newest first, excluding `stopAt`. */
  history(name: string, options: { readonly stopAt: string | null; readonly limit: number }): Promise<VaultCommit[]>;
  write<T>(name: string, plan: (head: VaultSnapshot) => Promise<VaultWritePlan<T>>): Promise<VaultWriteOutcome<T>>;
  /**
   * Rebuilds the full history of `source` without the dropped paths into a new
   * repository `target`. A leftover `target` from an interrupted attempt is
   * deleted first.
   */
  rewrite(source: string, target: string, input: {
    readonly drops: ReadonlyMap<string, ReadonlySet<string>>;
    readonly scrubMessage: (message: string, dropped: ReadonlySet<string>) => string;
  }): Promise<VaultRewriteResult>;
  /** Tree id of the head commit; null for an empty repository. */
  headTree(name: string): Promise<string | null>;
  listRepos(): Promise<VaultRepoListing[]>;
}

/** The repository does not exist (Artifacts `NOT_FOUND`). */
export class VaultRepoNotFoundError extends Error {
  constructor(readonly repo: string) {
    super(`Memory repository ${repo} does not exist`);
    this.name = "VaultRepoNotFoundError";
  }
}

/** A requested commit is not part of the repository. */
export class VaultCommitNotFoundError extends Error {
  constructor(readonly commit: string) {
    super(`Commit ${commit} is not in the memory repository`);
    this.name = "VaultCommitNotFoundError";
  }
}

/** The Git host failed or timed out; callers report `memory_unavailable`. */
export class VaultStoreUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "VaultStoreUnavailableError";
  }
}

export const VAULT_COMMIT_AUTHOR = { name: "Briar", email: "memory@briar.invalid" } as const;
