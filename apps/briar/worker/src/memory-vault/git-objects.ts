import * as git from "isomorphic-git";
import { MemoryFS } from "./memory-fs";

/**
 * Git object operations over an in-memory repository. Both the Artifacts store
 * (after a clone) and the in-memory test store run these exact functions, so
 * the tree building, history walking and purge rewrite that production relies
 * on are the code the tests exercise. Only clone and push differ.
 */
export type GitDir = { readonly fs: MemoryFS; readonly gitdir: string };

export const MAIN_BRANCH = "main";
export const MAIN_REF = `refs/heads/${MAIN_BRANCH}`;

export type GitSignature = {
  readonly name: string;
  readonly email: string;
  readonly timestamp: number;
  readonly timezoneOffset: number;
};

export type GitCommitInfo = {
  readonly oid: string;
  readonly tree: string;
  readonly parents: readonly string[];
  readonly message: string;
  readonly author: GitSignature;
  readonly committer: GitSignature;
};

const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

const errorCode = (error: unknown) =>
  error && typeof error === "object" && "code" in error ? String(error.code) : "";

export async function initRepository(bare = true): Promise<GitDir> {
  const dir: GitDir = { fs: new MemoryFS(), gitdir: bare ? "/repo.git" : "/repo/.git" };
  await git.init({ fs: dir.fs, gitdir: dir.gitdir, bare, defaultBranch: MAIN_BRANCH });
  return dir;
}

export async function resolveMain(dir: GitDir): Promise<string | null> {
  try {
    return await git.resolveRef({ fs: dir.fs, gitdir: dir.gitdir, ref: MAIN_REF });
  } catch (error) {
    if (errorCode(error) === "NotFoundError") return null;
    throw error;
  }
}

export async function setMain(dir: GitDir, oid: string) {
  await git.writeRef({ fs: dir.fs, gitdir: dir.gitdir, ref: MAIN_REF, value: oid, force: true });
}

export async function readCommitInfo(dir: GitDir, oid: string): Promise<GitCommitInfo> {
  const { commit } = await git.readCommit({ fs: dir.fs, gitdir: dir.gitdir, oid });
  return {
    oid,
    tree: commit.tree,
    parents: commit.parent,
    message: commit.message,
    author: commit.author,
    committer: commit.committer,
  };
}

/** Every blob reachable from the commit's tree, keyed by repository path. */
export async function readFilesAtCommit(dir: GitDir, commit: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const { tree } = await readCommitInfo(dir, commit);
  const walk = async (treeOid: string, prefix: string) => {
    const { tree: entries } = await git.readTree({ fs: dir.fs, gitdir: dir.gitdir, oid: treeOid });
    for (const entry of entries) {
      const path = `${prefix}${entry.path}`;
      if (entry.type === "tree") {
        await walk(entry.oid, `${path}/`);
      } else if (entry.type === "blob") {
        const { blob } = await git.readBlob({ fs: dir.fs, gitdir: dir.gitdir, oid: entry.oid });
        files.set(path, decoder.decode(blob));
      }
    }
  };
  await walk(tree, "");
  return files;
}

export async function readFileAtCommit(dir: GitDir, commit: string, path: string): Promise<string | null> {
  try {
    const { blob } = await git.readBlob({ fs: dir.fs, gitdir: dir.gitdir, oid: commit, filepath: path });
    return decoder.decode(blob);
  } catch (error) {
    if (errorCode(error) === "NotFoundError") return null;
    throw error;
  }
}

type TreeNode = { files: Map<string, string>; dirs: Map<string, TreeNode> };

/** Writes blobs and trees for a complete file map and returns the root tree id. */
export async function writeFileTree(dir: GitDir, files: ReadonlyMap<string, string>): Promise<string> {
  const root: TreeNode = { files: new Map(), dirs: new Map() };
  for (const [path, content] of files) {
    const parts = path.split("/");
    const name = parts.pop()!;
    let node = root;
    for (const part of parts) {
      let child = node.dirs.get(part);
      if (!child) {
        child = { files: new Map(), dirs: new Map() };
        node.dirs.set(part, child);
      }
      node = child;
    }
    node.files.set(name, content);
  }
  const write = async (node: TreeNode): Promise<string> => {
    const entries: { mode: string; path: string; oid: string; type: "blob" | "tree" }[] = [];
    for (const [name, content] of node.files) {
      const oid = await git.writeBlob({ fs: dir.fs, gitdir: dir.gitdir, blob: encoder.encode(content) });
      entries.push({ mode: "100644", path: name, oid, type: "blob" });
    }
    for (const [name, child] of node.dirs) {
      entries.push({ mode: "040000", path: name, oid: await write(child), type: "tree" });
    }
    return git.writeTree({ fs: dir.fs, gitdir: dir.gitdir, tree: entries });
  };
  return write(root);
}

export async function writeCommitObject(dir: GitDir, input: {
  readonly tree: string;
  readonly parent: string | null;
  readonly message: string;
  readonly author: GitSignature;
  readonly committer?: GitSignature;
}): Promise<string> {
  return git.writeCommit({
    fs: dir.fs,
    gitdir: dir.gitdir,
    commit: {
      tree: input.tree,
      parent: input.parent ? [input.parent] : [],
      message: input.message,
      author: input.author,
      committer: input.committer ?? input.author,
    },
  });
}

/** First-parent history from `head`, newest first, stopping before `stopAt`. */
export async function firstParentHistory(
  dir: GitDir,
  head: string,
  options: { readonly stopAt?: string | null; readonly limit?: number } = {},
): Promise<GitCommitInfo[]> {
  const commits: GitCommitInfo[] = [];
  let next: string | undefined = head;
  while (next && next !== options.stopAt) {
    if (options.limit !== undefined && commits.length >= options.limit) break;
    let info: GitCommitInfo;
    try {
      info = await readCommitInfo(dir, next);
    } catch (error) {
      // A shallow clone ends at its boundary commit's missing parent.
      if (errorCode(error) === "NotFoundError" && commits.length > 0) break;
      throw error;
    }
    commits.push(info);
    next = info.parents[0];
  }
  return commits;
}

export type RewriteResult = {
  readonly head: string | null;
  readonly headTree: string | null;
  /** Old commit → the rewritten commit that now carries its content. */
  readonly mapping: ReadonlyMap<string, string>;
};

/**
 * Replays the first-parent history of `head` from `source` into `target`
 * without the forgotten paths. `drops` maps each path to the commits that
 * forgot it: the path is removed from every commit up to the last of those,
 * and kept in later commits (a record re-created after its forget survives);
 * an empty set drops the path everywhere. A commit whose rewritten tree equals
 * its rewritten parent's (it only touched dropped paths) is omitted and maps to
 * that parent. `scrubMessage` removes references to the paths still being
 * dropped at that commit.
 */
export async function rewriteHistory(input: {
  readonly source: GitDir;
  readonly target: GitDir;
  readonly head: string;
  readonly drops: ReadonlyMap<string, ReadonlySet<string>>;
  readonly scrubMessage: (message: string, dropped: ReadonlySet<string>) => string;
}): Promise<RewriteResult> {
  const history = (await firstParentHistory(input.source, input.head)).reverse();
  const mapping = new Map<string, string>();
  const active = new Set(input.drops.keys());
  const pending = new Map([...input.drops].map(([path, commits]) => [path, new Set(commits)]));
  let previous: { oid: string; tree: string } | null = null;
  for (const commit of history) {
    const files = await readFilesAtCommit(input.source, commit.oid);
    for (const path of active) files.delete(path);
    const tree = await writeFileTree(input.target, files);
    const message = input.scrubMessage(commit.message, active);
    for (const [path, commits] of pending) {
      if (commits.delete(commit.oid) && commits.size === 0) active.delete(path);
    }
    if (previous && previous.tree === tree) {
      mapping.set(commit.oid, previous.oid);
      continue;
    }
    const oid = await writeCommitObject(input.target, {
      tree,
      parent: previous?.oid ?? null,
      message,
      author: commit.author,
      committer: commit.committer,
    });
    mapping.set(commit.oid, oid);
    previous = { oid, tree };
  }
  if (previous) await setMain(input.target, previous.oid);
  return { head: previous?.oid ?? null, headTree: previous?.tree ?? null, mapping };
}

/** True when the object store holds an object with this id. */
export async function hasObject(dir: GitDir, oid: string): Promise<boolean> {
  try {
    await git.readObject({ fs: dir.fs, gitdir: dir.gitdir, oid, format: "deflated" });
    return true;
  } catch (error) {
    if (errorCode(error) === "NotFoundError") return false;
    throw error;
  }
}

export async function blobId(content: string): Promise<string> {
  const { oid } = await git.hashBlob({ object: encoder.encode(content) });
  return oid;
}
