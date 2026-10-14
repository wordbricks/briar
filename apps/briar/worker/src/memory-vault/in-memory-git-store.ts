import {
  firstParentHistory,
  hasObject,
  initRepository,
  readCommitInfo,
  readFileAtCommit,
  readFilesAtCommit,
  resolveMain,
  rewriteHistory,
  setMain,
  writeCommitObject,
  writeFileTree,
  type GitDir,
} from "./git-objects";
import {
  VAULT_COMMIT_AUTHOR,
  VaultCommitNotFoundError,
  VaultRepoNotFoundError,
  VaultStoreUnavailableError,
  type VaultCommit,
  type VaultGitStore,
  type VaultRepoListing,
  type VaultRewriteResult,
  type VaultSnapshot,
  type VaultWriteOutcome,
  type VaultWritePlan,
} from "./git-store";

export type InMemoryVaultGitStoreHooks = {
  /** Runs after the plan, before the compare-and-swap. Use it to interleave a competing writer. */
  beforePush?: (repo: string) => Promise<void>;
  /** Runs after `main` moved. Throwing models a push whose response was lost. */
  afterPush?: (repo: string, commit: string) => Promise<void>;
};

/**
 * A faithful stand-in for Artifacts in tests: real Git objects, a `main` ref
 * that only moves by compare-and-swap, history and old commits readable by
 * hash, and repositories whose objects stay readable after a history rewrite
 * until the repository itself is deleted. Counters show which calls a code path
 * made (for "no Artifacts read" assertions).
 */
export class InMemoryVaultGitStore implements VaultGitStore {
  private readonly repos = new Map<string, { dir: GitDir; createdAt: string }>();
  private readonly locks = new Map<string, Promise<void>>();
  hooks: InMemoryVaultGitStoreHooks = {};
  unavailable = false;
  readonly calls = { head: 0, readFile: 0, snapshot: 0, history: 0, write: 0, rewrite: 0, create: 0, delete: 0 };

  private guard() {
    if (this.unavailable) throw new VaultStoreUnavailableError("Artifacts is unavailable (test)");
  }

  private repo(name: string) {
    const repo = this.repos.get(name);
    if (!repo) throw new VaultRepoNotFoundError(name);
    return repo.dir;
  }

  private async locked<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(name) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(name, previous.then(() => current));
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async createRepo(name: string) {
    this.guard();
    this.calls.create += 1;
    if (this.repos.has(name)) return;
    this.repos.set(name, { dir: await initRepository(true), createdAt: new Date().toISOString() });
  }

  async deleteRepo(name: string) {
    this.guard();
    this.calls.delete += 1;
    return this.repos.delete(name);
  }

  async repoExists(name: string) {
    this.guard();
    return this.repos.has(name);
  }

  async head(name: string) {
    this.guard();
    this.calls.head += 1;
    return resolveMain(this.repo(name));
  }

  async readFile(name: string, commit: string, path: string) {
    this.guard();
    this.calls.readFile += 1;
    const dir = this.repo(name);
    if (!await hasObject(dir, commit)) throw new VaultCommitNotFoundError(commit);
    return readFileAtCommit(dir, commit, path);
  }

  async snapshot(name: string, commit?: string): Promise<VaultSnapshot> {
    this.guard();
    this.calls.snapshot += 1;
    const dir = this.repo(name);
    const target = commit ?? await resolveMain(dir);
    if (!target) return { commit: null, files: new Map() };
    if (!await hasObject(dir, target)) throw new VaultCommitNotFoundError(target);
    return { commit: target, files: await readFilesAtCommit(dir, target) };
  }

  async history(name: string, options: { stopAt: string | null; limit: number }): Promise<VaultCommit[]> {
    this.guard();
    this.calls.history += 1;
    const dir = this.repo(name);
    const head = await resolveMain(dir);
    if (!head) return [];
    return (await firstParentHistory(dir, head, options)).map((commit) => ({
      oid: commit.oid,
      parents: commit.parents,
      message: commit.message,
      authoredAt: new Date(commit.author.timestamp * 1000).toISOString(),
    }));
  }

  async write<T>(name: string, plan: (head: VaultSnapshot) => Promise<VaultWritePlan<T>>): Promise<VaultWriteOutcome<T>> {
    this.guard();
    this.calls.write += 1;
    const observed = await this.snapshot(name);
    const decided = await plan(observed);
    if (decided.kind === "skip") return { kind: "skipped", head: observed.commit, value: decided.value };
    await this.hooks.beforePush?.(name);
    this.guard();
    const commit = await this.locked(name, async () => {
      const dir = this.repo(name);
      if (await resolveMain(dir) !== observed.commit) return null;
      const tree = await writeFileTree(dir, decided.files);
      const oid = await writeCommitObject(dir, {
        tree,
        parent: observed.commit,
        message: decided.message,
        author: { ...VAULT_COMMIT_AUTHOR, timestamp: decided.timestamp, timezoneOffset: 0 },
      });
      await setMain(dir, oid);
      return oid;
    });
    if (!commit) return { kind: "conflict" };
    await this.hooks.afterPush?.(name, commit);
    return { kind: "committed", commit, value: decided.value };
  }

  async rewrite(source: string, target: string, input: {
    drops: ReadonlyMap<string, ReadonlySet<string>>;
    scrubMessage: (message: string, dropped: ReadonlySet<string>) => string;
  }): Promise<VaultRewriteResult> {
    this.guard();
    this.calls.rewrite += 1;
    const sourceDir = this.repo(source);
    const sourceHead = await resolveMain(sourceDir);
    this.repos.delete(target);
    const targetDir = await initRepository(true);
    this.repos.set(target, { dir: targetDir, createdAt: new Date().toISOString() });
    if (!sourceHead) {
      return { sourceHead: null, sourceHeadTree: null, head: null, headTree: null, mapping: new Map() };
    }
    const sourceHeadTree = (await readCommitInfo(sourceDir, sourceHead)).tree;
    const result = await rewriteHistory({ source: sourceDir, target: targetDir, head: sourceHead, ...input });
    return { sourceHead, sourceHeadTree, ...result };
  }

  async headTree(name: string) {
    this.guard();
    const dir = this.repo(name);
    const head = await resolveMain(dir);
    return head ? (await readCommitInfo(dir, head)).tree : null;
  }

  async listRepos(): Promise<VaultRepoListing[]> {
    this.guard();
    return [...this.repos].map(([name, repo]) => ({ name, createdAt: repo.createdAt }));
  }

  /** Test inspection: does the repository hold this object at all (reachable or not)? */
  async holdsObject(name: string, oid: string) {
    return hasObject(this.repo(name), oid);
  }

  /** Test setup: backdate a repository's creation for the orphan sweep's grace period. */
  backdate(name: string, createdAt: string) {
    const repo = this.repos.get(name);
    if (repo) this.repos.set(name, { ...repo, createdAt });
  }
}
