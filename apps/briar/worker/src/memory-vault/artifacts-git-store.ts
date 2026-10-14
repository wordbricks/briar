import * as git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import {
  MAIN_BRANCH,
  MAIN_REF,
  firstParentHistory,
  readCommitInfo,
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
import { MemoryFS } from "./memory-fs";

/**
 * Repository methods the Artifacts runtime exposes but the generated
 * `ArtifactsRepo` type (Wrangler 4.127) does not declare yet. Verified live on
 * 2026-10-13 (docs/plans/memory-vault-spec.md §1): `readFile` accepts a commit
 * id as ref, and `info()` is the only way to get the remote URL.
 */
type ArtifactsRepoReader = {
  readFile(input: { ref: string; path: string }): Promise<Blob | null>;
  info(): Promise<{ remote: string }>;
};

/** Write tokens live at most five minutes and serve one clone/push. */
const WRITE_TOKEN_TTL_SECONDS = 300;
const READ_TOKEN_TTL_SECONDS = 120;

const errorCode = (error: unknown) =>
  error && typeof error === "object" && "code" in error ? String(error.code) : "";

const describe = (error: unknown) => error instanceof Error ? `${error.name}: ${error.message}` : String(error);

/**
 * `get` of a repository that does not exist. A deployed Worker sees
 * `code: "NOT_FOUND"`; a remote binding in `wrangler dev` drops the code and
 * keeps only the message ("ArtifactsError: Repository not found: <name>.",
 * seen 2026-10-14), which made every purge fail its "old generation is gone"
 * check locally. The message must name this repository.
 */
const repoNotFound = (error: unknown, name: string) =>
  errorCode(error) === "NOT_FOUND" ||
  (error instanceof Error && error.message.includes(`Repository not found: ${name}`));

type Remote = { readonly url: string; readonly secret: string };

/**
 * Production `VaultGitStore` over the `MEMORY_ARTIFACTS` binding. Writes are
 * Git pushes from an in-memory clone (the binding cannot write files). Tokens
 * are minted per operation and only ever handed to isomorphic-git's `onAuth`;
 * they are never returned, logged or stored.
 */
export class ArtifactsVaultGitStore implements VaultGitStore {
  constructor(private readonly artifacts: Artifacts) {}

  private async withRepo<T>(name: string, fn: (repo: ArtifactsRepo) => Promise<T>): Promise<T> {
    let repo: ArtifactsRepo;
    try {
      repo = await this.artifacts.get(name);
    } catch (error) {
      if (repoNotFound(error, name)) throw new VaultRepoNotFoundError(name);
      throw new VaultStoreUnavailableError(`Artifacts get failed: ${describe(error)}`, { cause: error });
    }
    try {
      return await fn(repo);
    } finally {
      const disposable = repo as Partial<Disposable>;
      disposable[Symbol.dispose]?.();
    }
  }

  private remote(name: string, scope: "read" | "write"): Promise<Remote> {
    return this.withRepo(name, async (repo) => {
      try {
        // The handle is an RPC stub: `repo.remote` is a pending RPC property,
        // not a string (verified live 2026-10-13). `info()` returns the URL.
        const [info, token] = await Promise.all([
          (repo as unknown as ArtifactsRepoReader).info(),
          repo.createToken(scope, scope === "write" ? WRITE_TOKEN_TTL_SECONDS : READ_TOKEN_TTL_SECONDS),
        ]);
        return { url: info.remote, secret: token.plaintext.split("?expires=")[0] };
      } catch (error) {
        throw new VaultStoreUnavailableError(`Artifacts token failed: ${describe(error)}`, { cause: error });
      }
    });
  }

  private static auth(remote: Remote) {
    return () => ({ username: "x", password: remote.secret });
  }

  private async remoteHead(remote: Remote): Promise<string | null> {
    try {
      const info = await git.getRemoteInfo2({
        http,
        url: remote.url,
        onAuth: ArtifactsVaultGitStore.auth(remote),
        protocolVersion: 1,
      });
      return info.refs?.find((ref) => ref.ref === MAIN_REF)?.oid ?? null;
    } catch (error) {
      throw new VaultStoreUnavailableError(`Artifacts ref discovery failed: ${describe(error)}`, { cause: error });
    }
  }

  /** Clones `main`; null when the repository is still empty. */
  private async clone(remote: Remote, depth: number | undefined): Promise<GitDir | null> {
    if (await this.remoteHead(remote) === null) return null;
    const dir: GitDir = { fs: new MemoryFS(), gitdir: "/repo/.git" };
    try {
      await git.clone({
        fs: dir.fs,
        http,
        dir: "/repo",
        gitdir: dir.gitdir,
        url: remote.url,
        ref: MAIN_BRANCH,
        singleBranch: true,
        noCheckout: true,
        noTags: true,
        depth,
        onAuth: ArtifactsVaultGitStore.auth(remote),
      });
      // Clone writes refs/remotes/origin/main; the object code reads refs/heads/main.
      const head = await git.resolveRef({ fs: dir.fs, gitdir: dir.gitdir, ref: `refs/remotes/origin/${MAIN_BRANCH}` })
        .catch(() => resolveMain(dir));
      if (!head) throw new Error("The clone has no main branch");
      await setMain(dir, head);
      return dir;
    } catch (error) {
      throw new VaultStoreUnavailableError(`Artifacts clone failed: ${describe(error)}`, { cause: error });
    }
  }

  private async push(dir: GitDir, remote: Remote) {
    await git.push({
      fs: dir.fs,
      http,
      gitdir: dir.gitdir,
      url: remote.url,
      ref: MAIN_BRANCH,
      remoteRef: MAIN_BRANCH,
      onAuth: ArtifactsVaultGitStore.auth(remote),
    });
  }

  async createRepo(name: string) {
    try {
      await this.artifacts.create(name, {
        setDefaultBranch: MAIN_BRANCH,
        description: "Briar memory vault",
      });
    } catch (error) {
      if (errorCode(error) === "ALREADY_EXISTS") return;
      // A remote binding in `wrangler dev` drops the error code (seen
      // 2026-10-13: "ArtifactsError: repo already exists"), so ask directly.
      if (await this.repoExists(name).catch(() => false)) return;
      throw new VaultStoreUnavailableError(`Artifacts create failed: ${describe(error)}`, { cause: error });
    }
  }

  async deleteRepo(name: string) {
    try {
      return await this.artifacts.delete(name);
    } catch (error) {
      throw new VaultStoreUnavailableError(`Artifacts delete failed: ${describe(error)}`, { cause: error });
    }
  }

  async repoExists(name: string) {
    try {
      await this.withRepo(name, async () => undefined);
      return true;
    } catch (error) {
      if (error instanceof VaultRepoNotFoundError) return false;
      throw error;
    }
  }

  async head(name: string) {
    return this.remoteHead(await this.remote(name, "read"));
  }

  async readFile(name: string, commit: string, path: string) {
    return this.withRepo(name, async (repo) => {
      try {
        const blob = await (repo as unknown as ArtifactsRepoReader).readFile({ ref: commit, path });
        return blob ? new TextDecoder("utf-8", { fatal: true }).decode(await blob.arrayBuffer()) : null;
      } catch (error) {
        if (errorCode(error) === "NOT_FOUND") throw new VaultCommitNotFoundError(commit);
        throw new VaultStoreUnavailableError(`Artifacts readFile failed: ${describe(error)}`, { cause: error });
      }
    });
  }

  async snapshot(name: string, commit?: string): Promise<VaultSnapshot> {
    const remote = await this.remote(name, "read");
    const shallow = await this.clone(remote, 1);
    if (!shallow) {
      if (commit) throw new VaultCommitNotFoundError(commit);
      return { commit: null, files: new Map() };
    }
    const head = (await resolveMain(shallow))!;
    if (!commit || commit === head) return { commit: head, files: await readFilesAtCommit(shallow, head) };
    const full = await this.clone(remote, undefined);
    try {
      return { commit, files: await readFilesAtCommit(full!, commit) };
    } catch (error) {
      if (errorCode(error) === "NotFoundError") throw new VaultCommitNotFoundError(commit);
      throw error;
    }
  }

  async history(name: string, options: { stopAt: string | null; limit: number }): Promise<VaultCommit[]> {
    const full = await this.clone(await this.remote(name, "read"), undefined);
    if (!full) return [];
    const head = (await resolveMain(full))!;
    return (await firstParentHistory(full, head, options)).map((commit) => ({
      oid: commit.oid,
      parents: commit.parents,
      message: commit.message,
      authoredAt: new Date(commit.author.timestamp * 1000).toISOString(),
    }));
  }

  async write<T>(name: string, plan: (head: VaultSnapshot) => Promise<VaultWritePlan<T>>): Promise<VaultWriteOutcome<T>> {
    const remote = await this.remote(name, "write");
    const dir = await this.clone(remote, 1) ?? await this.initLocal();
    const base = await resolveMain(dir);
    const decided = await plan({ commit: base, files: base ? await readFilesAtCommit(dir, base) : new Map() });
    if (decided.kind === "skip") return { kind: "skipped", head: base, value: decided.value };
    const tree = await writeFileTree(dir, decided.files);
    const commit = await writeCommitObject(dir, {
      tree,
      parent: base,
      message: decided.message,
      author: { ...VAULT_COMMIT_AUTHOR, timestamp: decided.timestamp, timezoneOffset: 0 },
    });
    await setMain(dir, commit);
    try {
      await this.push(dir, remote);
      return { kind: "committed", commit, value: decided.value };
    } catch (error) {
      if (errorCode(error) === "PushRejectedError") return { kind: "conflict" };
      // The receive-pack may have refused the ref update (another writer moved
      // `main` between discovery and update) or the response may have been
      // lost after the update landed. The remote head tells which.
      const head = await this.remoteHead(remote);
      if (head === commit) return { kind: "committed", commit, value: decided.value };
      if (head !== base) return { kind: "conflict" };
      throw new VaultStoreUnavailableError(`Artifacts push failed: ${describe(error)}`, { cause: error });
    }
  }

  private async initLocal(): Promise<GitDir> {
    const dir: GitDir = { fs: new MemoryFS(), gitdir: "/repo/.git" };
    await git.init({ fs: dir.fs, dir: "/repo", gitdir: dir.gitdir, defaultBranch: MAIN_BRANCH });
    return dir;
  }

  async rewrite(source: string, target: string, input: {
    drops: ReadonlyMap<string, ReadonlySet<string>>;
    scrubMessage: (message: string, dropped: ReadonlySet<string>) => string;
  }): Promise<VaultRewriteResult> {
    const full = await this.clone(await this.remote(source, "read"), undefined);
    await this.deleteRepo(target);
    await this.createRepo(target);
    if (!full) return { sourceHead: null, sourceHeadTree: null, head: null, headTree: null, mapping: new Map() };
    const sourceHead = (await resolveMain(full))!;
    const sourceHeadTree = (await readCommitInfo(full, sourceHead)).tree;
    const local = await this.initLocal();
    const result = await rewriteHistory({ source: full, target: local, head: sourceHead, ...input });
    if (result.head) {
      try {
        await this.push(local, await this.remote(target, "write"));
      } catch (error) {
        throw new VaultStoreUnavailableError(`Artifacts purge push failed: ${describe(error)}`, { cause: error });
      }
    }
    return { sourceHead, sourceHeadTree, ...result };
  }

  async headTree(name: string) {
    const shallow = await this.clone(await this.remote(name, "read"), 1);
    if (!shallow) return null;
    return (await readCommitInfo(shallow, (await resolveMain(shallow))!)).tree;
  }

  async listRepos(): Promise<VaultRepoListing[]> {
    const repos: VaultRepoListing[] = [];
    let cursor: string | undefined;
    try {
      do {
        const page = await this.artifacts.list({ limit: 200, cursor });
        repos.push(...page.repos.map((repo) => ({ name: repo.name, createdAt: repo.createdAt })));
        cursor = page.cursor;
      } while (cursor);
    } catch (error) {
      throw new VaultStoreUnavailableError(`Artifacts list failed: ${describe(error)}`, { cause: error });
    }
    return repos;
  }
}

/** The configured store, or null when this deployment has no Artifacts binding. */
export const memoryVaultStoreFromEnv = (env: Env): VaultGitStore | null => {
  const binding = (env as Partial<Pick<Env, "MEMORY_ARTIFACTS">>).MEMORY_ARTIFACTS;
  return binding ? new ArtifactsVaultGitStore(binding) : null;
};
