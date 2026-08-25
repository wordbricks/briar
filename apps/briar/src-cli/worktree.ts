/**
 * Per-issue git worktrees for Auto Hunt.
 *
 * Every claimed issue gets its own worktree cut from the freshly fetched
 * remote base branch, so concurrent runs never share a checkout and no run
 * inherits another run's uncommitted state. The main checkout is never
 * modified: it only lends its object database.
 *
 * Allocation is deliberately derived from git state (worktree list and branch
 * existence) rather than only from CLI config, so interrupted or concurrent
 * runs can recover without trusting stale bookkeeping.
 */

import {
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { realpathSync } from "node:fs";
import type { Dirent } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** Project-level list of gitignored paths to copy into each new worktree. */
export const WORKTREE_INCLUDE_FILE = ".worktreeinclude";

/** Bound on the suffix search for a free worktree name. */
export const MAX_WORKTREE_NAME_ATTEMPTS = 50;

/** `git worktree add` checks out a full tree; keep it bounded but generous. */
const WORKTREE_ADD_TIMEOUT_MS = 180_000;
const FETCH_TIMEOUT_MS = 120_000;
const WORKTREE_INCLUDE_MAX_BYTES = 256 * 1024;
const WORKTREE_INCLUDE_MAX_ENTRIES = 200;
const MAX_SLUG_LENGTH = 40;

/**
 * Reproducible directories that can dominate an issue worktree after a run.
 * A matching name is only removed after Git confirms that exact path is
 * ignored, so a tracked `build` or `target` directory is never compacted.
 */
export const RECLAIMABLE_ARTIFACT_DIRECTORY_NAMES = new Set([
  ".cache",
  ".next",
  ".turbo",
  ".vite",
  ".vite-plus",
  "DerivedData",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
]);

/** Keep completed worktrees available briefly for inspection and fast rework. */
export const COMPLETED_WORKTREE_RETENTION_MS = 24 * 60 * 60 * 1_000;
const COMPLETED_WORKTREE_REGISTRY_DIRECTORY = ".briar-completed-worktrees";

/** Reuse read-only conversation checkouts briefly before reclaiming their disk space. */
export const ANALYSIS_WORKTREE_IDLE_TTL_MS = 30 * 60 * 1_000;
const ANALYSIS_WORKTREE_REGISTRY_DIRECTORY = ".briar-analysis-worktrees";

export type CompletedWorktreeRecord = {
  runId: string;
  path: string;
  branch: string;
  completedAt: string;
};

export type CachedAnalysisWorktreeRecord = {
  runId: string;
  path: string;
  baseRef: string;
  baseSha: string;
  lastUsedAt: string;
  /** Explicit conversation retention overrides the short default cache TTL. */
  retainedUntil?: string;
};

function completedWorktreeRecordPath(root: string, runId: string): string {
  if (!/^[0-9a-f-]{36}$/iu.test(runId)) {
    throw new Error("완료된 워크트리의 run ID가 올바르지 않습니다.");
  }
  return join(resolve(root), COMPLETED_WORKTREE_REGISTRY_DIRECTORY, `${runId}.json`);
}

/** Persist cleanup eligibility outside the disposable worktree itself. */
export async function recordCompletedWorktree(
  root: string,
  record: CompletedWorktreeRecord,
): Promise<void> {
  assertPathWithinRoot(record.path, root);
  if (!Number.isFinite(Date.parse(record.completedAt))) {
    throw new Error("완료된 워크트리의 완료 시각이 올바르지 않습니다.");
  }
  const path = completedWorktreeRecordPath(root, record.runId);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export async function listCompletedWorktrees(root: string): Promise<CompletedWorktreeRecord[]> {
  const directory = join(resolve(root), COMPLETED_WORKTREE_REGISTRY_DIRECTORY);
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const records: CompletedWorktreeRecord[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const candidate = JSON.parse(await readFile(join(directory, entry.name), "utf8"));
      if (
        candidate &&
        typeof candidate.runId === "string" &&
        typeof candidate.path === "string" &&
        typeof candidate.branch === "string" &&
        typeof candidate.completedAt === "string" &&
        Number.isFinite(Date.parse(candidate.completedAt)) &&
        isPathWithinRoot(candidate.path, root)
      ) {
        records.push(candidate as CompletedWorktreeRecord);
      }
    } catch {
      // A malformed record must not prevent cleanup of the remaining runs.
    }
  }
  return records.sort((left, right) => left.completedAt.localeCompare(right.completedAt));
}

export async function removeCompletedWorktreeRecord(root: string, runId: string): Promise<void> {
  await rm(completedWorktreeRecordPath(root, runId), { force: true });
}

function cachedAnalysisWorktreeRecordPath(root: string, runId: string): string {
  if (!/^[0-9a-f-]{36}$/iu.test(runId)) {
    throw new Error("분석 run ID가 올바르지 않습니다.");
  }
  return join(
    resolve(root),
    ANALYSIS_WORKTREE_REGISTRY_DIRECTORY,
    `${runId}.json`,
  );
}

async function recordCachedAnalysisWorktree(
  root: string,
  record: CachedAnalysisWorktreeRecord,
): Promise<void> {
  assertPathWithinRoot(record.path, root);
  if (!Number.isFinite(Date.parse(record.lastUsedAt))) {
    throw new Error("분석 워크트리의 마지막 사용 시각이 올바르지 않습니다.");
  }
  const path = cachedAnalysisWorktreeRecordPath(root, record.runId);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export async function listCachedAnalysisWorktrees(
  root: string,
): Promise<CachedAnalysisWorktreeRecord[]> {
  const directory = join(resolve(root), ANALYSIS_WORKTREE_REGISTRY_DIRECTORY);
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const records: CachedAnalysisWorktreeRecord[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const candidate = JSON.parse(await readFile(join(directory, entry.name), "utf8"));
      if (
        candidate &&
        typeof candidate.runId === "string" &&
        /^[0-9a-f-]{36}$/iu.test(candidate.runId) &&
        typeof candidate.path === "string" &&
        typeof candidate.baseRef === "string" &&
        typeof candidate.baseSha === "string" &&
        typeof candidate.lastUsedAt === "string" &&
        Number.isFinite(Date.parse(candidate.lastUsedAt)) &&
        (candidate.retainedUntil === undefined ||
          (typeof candidate.retainedUntil === "string" &&
            Number.isFinite(Date.parse(candidate.retainedUntil)))) &&
        isPathWithinRoot(candidate.path, root) &&
        samePath(
          candidate.path,
          join(resolve(root), "analysis", `analysis-${candidate.runId}`),
        )
      ) {
        records.push(candidate as CachedAnalysisWorktreeRecord);
      }
    } catch {
      // A malformed record must not prevent cleanup of the remaining caches.
    }
  }
  return records.sort((left, right) =>
    left.lastUsedAt.localeCompare(right.lastUsedAt)
  );
}

async function removeCachedAnalysisWorktreeRecord(
  root: string,
  runId: string,
): Promise<void> {
  await rm(cachedAnalysisWorktreeRecordPath(root, runId), { force: true });
}

/**
 * Base-ref probe order. Remote-tracking refs come first so a new worktree is
 * cut from what the team has actually pushed, never from a local branch that
 * has been sitting behind for a week.
 */
export const BASE_REF_PROBES: readonly { ref: string; baseRef: string }[] = [
  { ref: "refs/remotes/origin/main", baseRef: "origin/main" },
  { ref: "refs/remotes/origin/master", baseRef: "origin/master" },
  { ref: "refs/heads/main", baseRef: "main" },
  { ref: "refs/heads/master", baseRef: "master" },
];

export type GitResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

/** Injected git runner so the allocation logic is testable without a repo. */
export type GitRunner = (
  gitArgs: string[],
  options?: { cwd?: string; timeoutMs?: number },
) => GitResult;

export type IssueWorktree = {
  path: string;
  branch: string;
  /** Base the branch was cut from, as displayed to users (e.g. `origin/main`). */
  baseRef: string;
  /** Fully qualified ref actually handed to `git worktree add`. */
  baseRefResolved: string;
  baseSha: string;
  /** True when an earlier claim of the same run already had this worktree. */
  reused: boolean;
  /** Gitignored paths copied in from the main checkout. */
  includedPaths: string[];
};

export type WorktreeIssue = {
  runId: string;
  sourceKey: string;
  title: string;
};

export type WorktreeSettings = {
  /** Parent directory that holds every worktree of every project. */
  root: string;
  /** Branch namespace, e.g. `briar` produces `briar/<name>`. */
  branchPrefix: string;
};

export type AllocateWorktreeOptions = {
  repositoryPath: string;
  projectId: string;
  issue: WorktreeIssue;
  settings: WorktreeSettings;
  git: GitRunner;
  /** Overrides the probed base ref (`--base-branch`). */
  baseRef?: string;
};

export type AnalysisWorktree = {
  path: string;
  baseRef: string;
  baseSha: string;
  /** Gitignored paths copied in from the connected checkout. */
  includedPaths: string[];
  warning?: string;
};

export type CachedAnalysisWorktree = AnalysisWorktree & {
  reused: boolean;
};

export function defaultWorktreeRoot(home: string): string {
  return join(home, "briar", "workspaces");
}

export function projectWorktreeRoot(root: string, projectId: string): string {
  return join(resolve(root), projectId);
}

export function analysisWorktreePath(
  root: string,
  projectId: string,
  runId: string,
): string {
  if (!/^[0-9a-f-]{36}$/iu.test(runId)) {
    throw new Error("분석 run ID가 올바르지 않습니다.");
  }
  const analysisRoot = join(projectWorktreeRoot(root, projectId), "analysis");
  return assertPathWithinRoot(join(analysisRoot, `analysis-${runId}`), analysisRoot);
}

export type IssueReplyWorkspaceMode =
  | "project"
  | "shared"
  | "cached-analysis"
  | "missing-required";

export function issueReplyWorkspaceMode(input: {
  worktreesEnabled: boolean;
  hasConfiguredWorktree: boolean;
  requiresPreferredWorker?: boolean;
  branch: string | null;
}): IssueReplyWorkspaceMode {
  if (!input.worktreesEnabled) return "project";
  if (input.hasConfiguredWorktree) return "shared";
  const requiresExisting =
    input.requiresPreferredWorker ?? input.branch !== null;
  return requiresExisting ? "missing-required" : "cached-analysis";
}

/**
 * Reduce free text to something git and every filesystem accept. Unicode
 * letters and digits survive so a Korean issue title still yields a readable
 * name; `..` is collapsed because git check-ref-format rejects it anywhere.
 */
export function sanitizeWorktreeSlug(input: string): string {
  return input
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/\.{2,}/gu, ".")
    .replace(/^[.-]+|[.-]+$/gu, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/^[.-]+|[.-]+$/gu, "")
    .toLowerCase();
}

/**
 * Deterministic name for one run: a readable slug plus the run id prefix.
 * Determinism is what makes re-claiming the same run idempotent instead of
 * piling up `fix-login-2`, `fix-login-3` directories.
 */
export function worktreeNameFor(issue: WorktreeIssue): string {
  const titleSlug = sanitizeWorktreeSlug(issue.title);
  const keySlug = sanitizeWorktreeSlug(issue.sourceKey.split("/").at(-1) ?? "");
  const runToken = runIdToken(issue.runId);
  const slug = titleSlug || keySlug || "issue";
  return `${slug}-${runToken}`;
}

function runIdToken(runId: string): string {
  const compact = runId.replace(/[^A-Za-z0-9]/gu, "").toLowerCase();
  if (compact.length >= 8) return compact.slice(0, 8);
  return createHash("sha256").update(runId).digest("hex").slice(0, 8);
}

export function worktreeBranchFor(branchPrefix: string, name: string): string {
  const prefix = branchPrefix.trim().replace(/^\/+|\/+$/gu, "").replace(/\/{2,}/gu, "/");
  return prefix ? `${prefix}/${name}` : name;
}

export function worktreeNameCandidate(name: string, attempt: number): string {
  return attempt === 1 ? name : `${name}-${attempt}`;
}

/**
 * Resolve symlinks when the path exists. Git reports canonical paths in
 * `worktree list`, so a root reached through a symlink (`/var` → `/private/var`,
 * a symlinked home) would otherwise never match what we computed, and every
 * re-claim would allocate a second checkout.
 */
function canonicalPath(candidate: string): string {
  try {
    return realpathSync(resolve(candidate));
  } catch {
    return resolve(candidate);
  }
}

export function samePath(left: string, right: string): boolean {
  return canonicalPath(left) === canonicalPath(right);
}

export function isPathWithinRoot(candidate: string, root: string): boolean {
  const rel = relative(canonicalPath(root), canonicalPath(candidate));
  return Boolean(rel) && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
}

/**
 * Reject any path that escapes the project's worktree root, so a hostile issue
 * title can never place a checkout somewhere else on disk.
 */
export function assertPathWithinRoot(targetPath: string, root: string): string {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(targetPath);
  const rel = relative(resolvedRoot, resolvedTarget);
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error(`워크트리 경로가 허용된 루트를 벗어났습니다: ${targetPath}`);
  }
  return resolvedTarget;
}

/**
 * Promote a short base ref to a fully qualified one. `git worktree add` takes a
 * revision, and a bare `main` can resolve to a tag; the namespace implied by
 * the probe order settles it.
 */
export function qualifyBaseRef(
  baseRef: string,
  refExists: (ref: string) => boolean,
): string {
  if (baseRef.startsWith("refs/")) return baseRef;
  const candidates = baseRef.includes("/")
    ? [`refs/remotes/${baseRef}`, `refs/heads/${baseRef}`]
    : [`refs/heads/${baseRef}`];
  return candidates.find(refExists) ?? baseRef;
}

/** Split `origin/main` into its remote and branch, or null for a local ref. */
export function parseRemoteTrackingBase(
  baseRef: string,
  remotes: readonly string[],
): { remote: string; branch: string; ref: string } | null {
  const short = baseRef.replace(/^refs\/remotes\//u, "");
  const remote = remotes
    .filter((candidate) => short.startsWith(`${candidate}/`))
    .sort((left, right) => right.length - left.length)
    .at(0);
  if (!remote) return null;
  const branch = short.slice(remote.length + 1);
  if (!branch) return null;
  return { remote, branch, ref: `refs/remotes/${remote}/${branch}` };
}

/**
 * Parse `.worktreeinclude` into deduped repo-root-relative literal paths.
 * Globs and negations are skipped rather than half-supported.
 */
export function parseWorktreeIncludeFile(content: string): string[] {
  const entries: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("!") || line.includes("*") || line.includes("?")) continue;
    const normalized = line.replace(/\\/gu, "/").replace(/^\.\//u, "").replace(/\/+$/u, "");
    if (!normalized || seen.has(normalized)) continue;
    if (!isSafeIncludePath(normalized)) continue;
    seen.add(normalized);
    entries.push(normalized);
    if (entries.length >= WORKTREE_INCLUDE_MAX_ENTRIES) break;
  }
  return entries;
}

export function isSafeIncludePath(relativePath: string): boolean {
  if (!relativePath || isAbsolute(relativePath) || /^[A-Za-z]:/u.test(relativePath)) {
    return false;
  }
  const segments = relativePath.split("/");
  return (
    !segments.includes("..") && !segments.includes("") && segments[0] !== ".git"
  );
}

type ParsedWorktree = { path: string; branch: string | null };

/** Parse `git worktree list --porcelain` into path/branch pairs. */
export function parseWorktreeList(stdout: string): ParsedWorktree[] {
  const worktrees: ParsedWorktree[] = [];
  let path: string | null = null;
  let branch: string | null = null;
  const flush = () => {
    if (path) worktrees.push({ path, branch });
    path = null;
    branch = null;
  };
  for (const line of stdout.split(/\r?\n/u)) {
    if (line.startsWith("worktree ")) {
      flush();
      path = line.slice("worktree ".length).trim();
      continue;
    }
    if (line.startsWith("branch ")) {
      branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//u, "");
    }
  }
  flush();
  return worktrees;
}

function gitOrThrow(
  git: GitRunner,
  gitArgs: string[],
  options: { cwd: string; timeoutMs?: number; message: string },
): string {
  const result = git(gitArgs, { cwd: options.cwd, timeoutMs: options.timeoutMs });
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(detail ? `${options.message} ${detail}` : options.message);
  }
  return result.stdout.trim();
}

function refExistsIn(git: GitRunner, repositoryPath: string, ref: string): boolean {
  return (
    git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
      cwd: repositoryPath,
    }).exitCode === 0
  );
}

/**
 * Resolve the base ref new worktrees are cut from: `origin/HEAD` when the
 * remote publishes it, else the probe order. Returns null when the repository
 * has no usable base, so callers can fail with an actionable message instead
 * of handing git a ref that does not exist.
 */
export function resolveBaseRef(git: GitRunner, repositoryPath: string): string | null {
  const originHead = git(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], {
    cwd: repositoryPath,
  });
  if (originHead.exitCode === 0) {
    const ref = originHead.stdout.trim();
    // origin/HEAD can survive a default-branch rename pointing at a dead ref.
    if (ref && refExistsIn(git, repositoryPath, ref)) {
      return ref.replace(/^refs\/remotes\//u, "");
    }
  }
  return (
    BASE_REF_PROBES.find(({ ref }) => refExistsIn(git, repositoryPath, ref))?.baseRef ?? null
  );
}

/**
 * Refresh a remote-tracking base before cutting from it. Only the base branch
 * is fetched, and auto-maintenance is suppressed so an unrelated gc cannot
 * stall issue pickup.
 *
 * A failure is fatal only when there is no local copy of the ref: an existing
 * (possibly slightly stale) ref keeps `worktree add` viable, and a transient
 * network blip must not strand a claimed issue.
 */
export type RemoteBaseRefreshResult = {
  fetched: boolean;
  warning?: string;
};

export function refreshRemoteBase(
  git: GitRunner,
  repositoryPath: string,
  base: { remote: string; branch: string; ref: string },
): RemoteBaseRefreshResult {
  const hadRef = refExistsIn(git, repositoryPath, base.ref);
  const fetch = git(
    [
      "-c",
      "maintenance.auto=false",
      "-c",
      "gc.auto=0",
      "fetch",
      "--no-tags",
      base.remote,
      `+refs/heads/${base.branch}:${base.ref}`,
    ],
    { cwd: repositoryPath, timeoutMs: FETCH_TIMEOUT_MS },
  );
  if (fetch.exitCode === 0) return { fetched: true };
  if (!hadRef) {
    throw new Error(
      `기준 ref "${base.remote}/${base.branch}"를 가져오지 못했습니다. 네트워크와 원격 접근 권한을 확인하세요. ${fetch.stderr.trim()}`.trim(),
    );
  }
  return {
    fetched: false,
    warning: `기준 ref를 새로 가져오지 못해 로컬에 있던 ${base.ref}에서 워크트리를 만들었습니다.`,
  };
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await lstat(candidate);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy the gitignored paths a fresh checkout is missing (`.env.keys`, local
 * tooling config). Copies, never symlinks: an agent editing one issue's file
 * must not mutate the main checkout. Best-effort — a missing or unreadable
 * entry is skipped so setup noise cannot strand a claimed issue.
 */
export async function copyWorktreeIncludes(
  repositoryPath: string,
  worktreePath: string,
): Promise<string[]> {
  let content: string;
  try {
    const includePath = join(repositoryPath, WORKTREE_INCLUDE_FILE);
    const stats = await stat(includePath);
    if (!stats.isFile() || stats.size > WORKTREE_INCLUDE_MAX_BYTES) return [];
    content = await readFile(includePath, "utf8");
  } catch {
    return [];
  }

  const copied: string[] = [];
  for (const entry of parseWorktreeIncludeFile(content)) {
    const source = join(repositoryPath, entry);
    const destination = join(worktreePath, entry);
    try {
      const stats = await lstat(source);
      if (await pathExists(destination)) continue;
      await mkdir(dirname(destination), { recursive: true });
      if (stats.isDirectory()) {
        await cp(source, destination, { recursive: true });
      } else if (stats.isFile()) {
        await copyFile(source, destination);
      } else {
        continue;
      }
      copied.push(entry);
    } catch {
      // A single unavailable include must not fail the allocation.
    }
  }
  return copied;
}

/**
 * Create (or re-attach) the worktree for one claimed issue.
 *
 * Ordering matters: the base ref is refreshed *before* `worktree add` so the
 * new branch starts at the latest remote commit, and includes are copied after
 * the checkout exists so setup commands can see them.
 */
export async function allocateIssueWorktree(
  options: AllocateWorktreeOptions,
): Promise<IssueWorktree & { warning?: string }> {
  const { git, repositoryPath, issue, settings } = options;
  const root = projectWorktreeRoot(settings.root, options.projectId);
  const baseName = worktreeNameFor(issue);

  const existing = parseWorktreeList(
    gitOrThrow(git, ["worktree", "list", "--porcelain"], {
      cwd: repositoryPath,
      message: "워크트리 목록을 읽지 못했습니다.",
    }),
  );

  const baseRef =
    options.baseRef?.trim() ||
    resolveBaseRef(git, repositoryPath) ||
    null;
  if (!baseRef) {
    throw new Error(
      "기준 브랜치를 찾지 못했습니다. origin/HEAD 또는 main/master 중 하나가 필요합니다.",
    );
  }

  let warning: string | undefined;
  const remotes = gitOrThrow(git, ["remote"], {
    cwd: repositoryPath,
    message: "원격 목록을 읽지 못했습니다.",
  })
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const remoteBase = parseRemoteTrackingBase(baseRef, remotes);
  if (remoteBase) {
    warning = refreshRemoteBase(git, repositoryPath, remoteBase).warning;
  }

  const baseRefResolved = qualifyBaseRef(baseRef, (ref) =>
    refExistsIn(git, repositoryPath, ref),
  );
  if (!refExistsIn(git, repositoryPath, baseRefResolved)) {
    throw new Error(`기준 ref "${baseRef}"를 찾지 못했습니다.`);
  }

  for (let attempt = 1; attempt <= MAX_WORKTREE_NAME_ATTEMPTS; attempt += 1) {
    const name = worktreeNameCandidate(baseName, attempt);
    const branch = worktreeBranchFor(settings.branchPrefix, name);
    const worktreePath = assertPathWithinRoot(join(root, name), root);

    // Re-claiming the same run must land in the same place, not next to it.
    const attached = existing.find((candidate) => samePath(candidate.path, worktreePath));
    if (attached) {
      if (attached.branch !== branch) continue;
      return {
        path: attached.path,
        branch,
        baseRef,
        baseRefResolved,
        baseSha: gitOrThrow(git, ["rev-parse", "HEAD"], {
          cwd: attached.path,
          message: "기존 워크트리의 HEAD를 읽지 못했습니다.",
        }),
        reused: true,
        includedPaths: [],
        ...(warning ? { warning } : {}),
      };
    }

    if (await pathExists(worktreePath)) continue;
    const localBranchRef = `refs/heads/${branch}`;
    const localBranchExists = refExistsIn(git, repositoryPath, localBranchRef);
    if (localBranchExists) {
      await mkdir(root, { recursive: true, mode: 0o700 });
      gitOrThrow(
        git,
        ["worktree", "add", "--no-track", worktreePath, localBranchRef],
        {
          cwd: repositoryPath,
          timeoutMs: WORKTREE_ADD_TIMEOUT_MS,
          message: "보존된 작업 브랜치에서 워크트리를 다시 만들지 못했습니다.",
        },
      );
      return {
        path: worktreePath,
        branch,
        baseRef,
        baseRefResolved,
        baseSha: gitOrThrow(git, ["rev-parse", "HEAD"], {
          cwd: worktreePath,
          message: "복원된 워크트리의 HEAD를 읽지 못했습니다.",
        }),
        reused: true,
        includedPaths: await copyWorktreeIncludes(repositoryPath, worktreePath),
        ...(warning ? { warning } : {}),
      };
    }
    const remoteBranchExists = remotes.some((remote) =>
      refExistsIn(git, repositoryPath, `refs/remotes/${remote}/${branch}`),
    );
    if (remoteBranchExists) continue;

    await mkdir(root, { recursive: true, mode: 0o700 });
    gitOrThrow(
      git,
      [
        "worktree",
        "add",
        // --no-track keeps the base's upstream off the new branch so `git
        // status` cannot report it as behind before the first push.
        "--no-track",
        "-b",
        branch,
        worktreePath,
        baseRefResolved,
      ],
      {
        cwd: repositoryPath,
        timeoutMs: WORKTREE_ADD_TIMEOUT_MS,
        message: "워크트리를 만들지 못했습니다.",
      },
    );
    // Report the path git registered, not the one we asked for: git resolves
    // symlinks, and every later lookup compares against its listing.
    const registeredPath =
      parseWorktreeList(
        gitOrThrow(git, ["worktree", "list", "--porcelain"], {
          cwd: repositoryPath,
          message: "새 워크트리를 목록에서 확인하지 못했습니다.",
        }),
      ).find((candidate) => candidate.branch === branch)?.path ?? worktreePath;

    // With no upstream, a plain `git push` needs this to create and track the
    // remote branch. Only set it when the user has no opinion at any scope.
    if (git(["config", "--get", "push.autoSetupRemote"], { cwd: registeredPath }).exitCode !== 0) {
      git(["config", "--local", "push.autoSetupRemote", "true"], { cwd: registeredPath });
    }

    return {
      path: registeredPath,
      branch,
      baseRef,
      baseRefResolved,
      baseSha: gitOrThrow(git, ["rev-parse", "HEAD"], {
        cwd: registeredPath,
        message: "새 워크트리의 HEAD를 읽지 못했습니다.",
      }),
      reused: false,
      includedPaths: await copyWorktreeIncludes(repositoryPath, registeredPath),
      ...(warning ? { warning } : {}),
    };
  }

  throw new Error(
    `"${baseName}" 이름으로 사용할 수 있는 워크트리 경로를 찾지 못했습니다.`,
  );
}

/**
 * Create a short-lived detached checkout for a conversational or direct saved
 * Agent turn. It has no branch, but otherwise receives the same
 * `.worktreeinclude` inputs as an execution worktree so it can run the project
 * locally without exposing the connected checkout to Agent writes.
 */
export async function allocateAnalysisWorktree(input: {
  repositoryPath: string;
  projectId: string;
  workId: string;
  settings: WorktreeSettings;
  git: GitRunner;
}): Promise<AnalysisWorktree> {
  if (!/^[0-9a-f-]{36}$/iu.test(input.workId)) {
    throw new Error("분석 work ID가 올바르지 않습니다.");
  }
  const baseRef = resolveBaseRef(input.git, input.repositoryPath);
  if (!baseRef) {
    throw new Error(
      "기준 브랜치를 찾지 못했습니다. origin/HEAD 또는 main/master 중 하나가 필요합니다.",
    );
  }
  const remotes = gitOrThrow(input.git, ["remote"], {
    cwd: input.repositoryPath,
    message: "원격 목록을 읽지 못했습니다.",
  })
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean);
  const remoteBase = parseRemoteTrackingBase(baseRef, remotes);
  const warning = remoteBase
    ? refreshRemoteBase(input.git, input.repositoryPath, remoteBase).warning
    : undefined;
  const baseRefResolved = qualifyBaseRef(baseRef, (ref) =>
    refExistsIn(input.git, input.repositoryPath, ref),
  );
  const root = join(
    projectWorktreeRoot(input.settings.root, input.projectId),
    "analysis",
  );
  const path = analysisWorktreePath(
    input.settings.root,
    input.projectId,
    input.workId,
  );
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (await pathExists(path)) {
    input.git(["worktree", "remove", "--force", path], {
      cwd: input.repositoryPath,
      timeoutMs: WORKTREE_ADD_TIMEOUT_MS,
    });
    await rm(path, { recursive: true, force: true });
  }
  gitOrThrow(
    input.git,
    ["worktree", "add", "--detach", path, baseRefResolved],
    {
      cwd: input.repositoryPath,
      timeoutMs: WORKTREE_ADD_TIMEOUT_MS,
      message: "최신 원격 기준 분석 워크트리를 만들지 못했습니다.",
    },
  );
  const includedPaths = await copyWorktreeIncludes(
    input.repositoryPath,
    path,
  );
  return {
    path,
    baseRef,
    includedPaths,
    baseSha: gitOrThrow(input.git, ["rev-parse", "HEAD"], {
      cwd: path,
      message: "분석 워크트리의 HEAD를 읽지 못했습니다.",
    }),
    ...(warning ? { warning } : {}),
  };
}

export async function removeAnalysisWorktree(input: {
  repositoryPath: string;
  path: string;
  git: GitRunner;
}) {
  const removed = input.git(["worktree", "remove", "--force", input.path], {
    cwd: input.repositoryPath,
    timeoutMs: WORKTREE_ADD_TIMEOUT_MS,
  });
  if (removed.exitCode !== 0) {
    throw new Error(
      `분석 워크트리를 정리하지 못했습니다: ${removed.stderr.trim()}`,
    );
  }
}

/**
 * Reuse one detached, read-only checkout per issue conversation on this
 * Worker. The durable registry lets a later heartbeat reclaim it even after a
 * Worker restart; callers mark the path active while a reply is using it.
 */
const cachedAnalysisWorktreeAllocations = new Map<
  string,
  Promise<CachedAnalysisWorktree>
>();

export async function allocateCachedAnalysisWorktree(input: {
  repositoryPath: string;
  projectId: string;
  runId: string;
  settings: WorktreeSettings;
  git: GitRunner;
  nowMs?: number;
  retainedUntil?: string;
}): Promise<CachedAnalysisWorktree> {
  const path = analysisWorktreePath(
    input.settings.root,
    input.projectId,
    input.runId,
  );
  const pending = cachedAnalysisWorktreeAllocations.get(path);
  if (pending) return await pending;
  const allocation = allocateCachedAnalysisWorktreeUncoordinated(input);
  cachedAnalysisWorktreeAllocations.set(path, allocation);
  try {
    return await allocation;
  } finally {
    if (cachedAnalysisWorktreeAllocations.get(path) === allocation) {
      cachedAnalysisWorktreeAllocations.delete(path);
    }
  }
}

async function allocateCachedAnalysisWorktreeUncoordinated(input: {
  repositoryPath: string;
  projectId: string;
  runId: string;
  settings: WorktreeSettings;
  git: GitRunner;
  nowMs?: number;
  retainedUntil?: string;
}): Promise<CachedAnalysisWorktree> {
  const projectRoot = projectWorktreeRoot(input.settings.root, input.projectId);
  const path = analysisWorktreePath(
    input.settings.root,
    input.projectId,
    input.runId,
  );
  const records = await listCachedAnalysisWorktrees(projectRoot);
  const record = records.find((candidate) => candidate.runId === input.runId);
  const attached = parseWorktreeList(
    gitOrThrow(input.git, ["worktree", "list", "--porcelain"], {
      cwd: input.repositoryPath,
      message: "분석 워크트리 목록을 읽지 못했습니다.",
    }),
  ).find((candidate) => samePath(candidate.path, path));

  if (attached && attached.branch !== null) {
    throw new Error(`분석 워크트리 경로에 브랜치가 연결되어 있습니다: ${path}`);
  }

  let worktree: CachedAnalysisWorktree;
  if (attached && await pathExists(path)) {
    const baseRef = record?.baseRef ?? resolveBaseRef(input.git, input.repositoryPath);
    if (!baseRef) {
      throw new Error(
        "기준 브랜치를 찾지 못했습니다. origin/HEAD 또는 main/master 중 하나가 필요합니다.",
      );
    }
    worktree = {
      path: attached.path,
      baseRef,
      baseSha: gitOrThrow(input.git, ["rev-parse", "HEAD"], {
        cwd: attached.path,
        message: "분석 워크트리의 HEAD를 읽지 못했습니다.",
      }),
      includedPaths: await copyWorktreeIncludes(
        input.repositoryPath,
        attached.path,
      ),
      reused: true,
    };
  } else {
    if (attached) {
      const removed = input.git(["worktree", "remove", "--force", attached.path], {
        cwd: input.repositoryPath,
        timeoutMs: WORKTREE_ADD_TIMEOUT_MS,
      });
      if (removed.exitCode !== 0) {
        throw new Error(
          `손상된 분석 워크트리 연결을 정리하지 못했습니다: ${removed.stderr.trim()}`,
        );
      }
    }
    if (await pathExists(path)) {
      await rm(path, { recursive: true, force: true });
    }
    const allocated = await allocateAnalysisWorktree({
      repositoryPath: input.repositoryPath,
      projectId: input.projectId,
      workId: input.runId,
      settings: input.settings,
      git: input.git,
    });
    worktree = { ...allocated, reused: false };
  }

  await recordCachedAnalysisWorktree(projectRoot, {
    runId: input.runId,
    path: worktree.path,
    baseRef: worktree.baseRef,
    baseSha: worktree.baseSha,
    lastUsedAt: new Date(input.nowMs ?? Date.now()).toISOString(),
    ...(input.retainedUntil ? { retainedUntil: input.retainedUntil } : {}),
  });
  return worktree;
}

export async function markCachedAnalysisWorktreeIdle(input: {
  root: string;
  runId: string;
  worktree: AnalysisWorktree;
  nowMs?: number;
  retainedUntil?: string;
}): Promise<void> {
  await recordCachedAnalysisWorktree(input.root, {
    runId: input.runId,
    path: input.worktree.path,
    baseRef: input.worktree.baseRef,
    baseSha: input.worktree.baseSha,
    lastUsedAt: new Date(input.nowMs ?? Date.now()).toISOString(),
    ...(input.retainedUntil ? { retainedUntil: input.retainedUntil } : {}),
  });
}

/** Persist a server-issued sliding deadline while a cached conversation is
 * still running, so a hard-killed Worker cannot fall back to an older expiry. */
export async function extendCachedAnalysisWorktreeRetention(input: {
  root: string;
  runId: string;
  retainedUntil: string;
  nowMs?: number;
}): Promise<boolean> {
  if (!Number.isFinite(Date.parse(input.retainedUntil))) {
    throw new Error("분석 워크트리의 보존 시각이 올바르지 않습니다.");
  }
  const record = (await listCachedAnalysisWorktrees(input.root)).find(
    (candidate) => candidate.runId === input.runId,
  );
  if (!record) return false;
  await recordCachedAnalysisWorktree(input.root, {
    ...record,
    lastUsedAt: new Date(input.nowMs ?? Date.now()).toISOString(),
    retainedUntil: input.retainedUntil,
  });
  return true;
}

export type AnalysisWorktreeMaintenanceResult = {
  runId: string;
  path: string;
  status: "removed" | "retained";
  reason?: "active" | "not-detached" | "removal-error";
  detail?: string;
};

export async function maintainIdleAnalysisWorktrees(
  git: GitRunner,
  repositoryPath: string,
  root: string,
  options: {
    nowMs?: number;
    idleTtlMs?: number;
    activePaths?: readonly string[];
  } = {},
): Promise<AnalysisWorktreeMaintenanceResult[]> {
  const nowMs = options.nowMs ?? Date.now();
  const idleTtlMs = options.idleTtlMs ?? ANALYSIS_WORKTREE_IDLE_TTL_MS;
  const activePaths = options.activePaths ?? [];
  const records = await listCachedAnalysisWorktrees(root);
  if (records.length === 0) return [];
  const attached = parseWorktreeList(
    gitOrThrow(git, ["worktree", "list", "--porcelain"], {
      cwd: repositoryPath,
      message: "분석 워크트리 목록을 읽지 못했습니다.",
    }),
  );
  const results: AnalysisWorktreeMaintenanceResult[] = [];

  for (const record of records) {
    if (
      record.retainedUntil &&
      Date.parse(record.retainedUntil) > nowMs
    ) continue;
    if (Date.parse(record.lastUsedAt) > nowMs - idleTtlMs) continue;
    if (activePaths.some((path) => samePath(path, record.path))) {
      results.push({
        runId: record.runId,
        path: record.path,
        status: "retained",
        reason: "active",
      });
      continue;
    }
    const worktree = attached.find((candidate) =>
      samePath(candidate.path, record.path)
    );
    if (worktree && worktree.branch !== null) {
      results.push({
        runId: record.runId,
        path: record.path,
        status: "retained",
        reason: "not-detached",
      });
      continue;
    }
    try {
      if (worktree) {
        await removeAnalysisWorktree({ repositoryPath, path: worktree.path, git });
      } else {
        await rm(record.path, { recursive: true, force: true });
      }
      await removeCachedAnalysisWorktreeRecord(root, record.runId);
      results.push({
        runId: record.runId,
        path: record.path,
        status: "removed",
      });
    } catch (error) {
      results.push({
        runId: record.runId,
        path: record.path,
        status: "retained",
        reason: "removal-error",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

export type RemoveWorktreeResult = {
  removed: boolean;
  branchDeleted: boolean;
  preservedBranch?: string;
};

export type TerminalWorktreeMaintenanceResult = {
  compactedPaths: string[];
  failedPaths: string[];
  gc:
    | { status: "removed"; branchDeleted: boolean; preservedBranch?: string }
    | {
        status: "retained";
        reason:
          | "not-completed"
          | "retention-period"
          | "dirty"
          | "git-status-error"
          | "removal-error";
        detail?: string;
      };
};

function relativeGitPath(worktreePath: string, candidatePath: string): string {
  return relative(resolve(worktreePath), resolve(candidatePath)).split(sep).join("/");
}

function gitIgnoresPath(
  git: GitRunner,
  worktreePath: string,
  candidatePath: string,
): boolean {
  const candidate = relativeGitPath(worktreePath, candidatePath);
  if (!candidate || candidate === ".." || candidate.startsWith("../")) return false;
  return (
    git(["check-ignore", "--quiet", "--", candidate], {
      cwd: worktreePath,
    }).exitCode === 0
  );
}

/**
 * Remove only well-known, Git-ignored build/dependency directories.
 *
 * The walk never follows symlinks and prunes a directory as soon as it is
 * removed. Failures are isolated per path: a locked build directory must not
 * prevent the remaining artifacts or the later GC decision from being
 * processed.
 */
export async function compactWorktreeArtifacts(
  git: GitRunner,
  worktreePath: string,
): Promise<{ compactedPaths: string[]; failedPaths: string[] }> {
  const root = resolve(worktreePath);
  const compactedPaths: string[] = [];
  const failedPaths: string[] = [];

  const walk = async (directory: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === ".git") continue;
      const candidate = join(directory, entry.name);
      if (
        RECLAIMABLE_ARTIFACT_DIRECTORY_NAMES.has(entry.name) &&
        gitIgnoresPath(git, root, candidate)
      ) {
        try {
          await rm(candidate, { recursive: true, force: true });
          compactedPaths.push(relativeGitPath(root, candidate));
        } catch {
          failedPaths.push(relativeGitPath(root, candidate));
        }
        continue;
      }
      await walk(candidate);
    }
  };

  await walk(root);
  compactedPaths.sort();
  failedPaths.sort();
  return { compactedPaths, failedPaths };
}

/** True only when every commit on the issue branch is already in the base. */
export function issueWorktreeMergedIntoBase(
  git: GitRunner,
  repositoryPath: string,
  branch: string,
  baseRef?: string,
): boolean {
  const resolvedBase = baseRef ?? resolveBaseRef(git, repositoryPath);
  if (!resolvedBase) return false;
  const qualified = qualifyBaseRef(resolvedBase, (ref) =>
    refExistsIn(git, repositoryPath, ref),
  );
  return (
    git(["merge-base", "--is-ancestor", `refs/heads/${branch}`, qualified], {
      cwd: repositoryPath,
    }).exitCode === 0
  );
}

/**
 * Compact a terminal run's reproducible outputs immediately. A completed
 * run's worktree becomes disposable after the retention period when the
 * checkout is clean. The branch is handled separately: removeIssueWorktree
 * preserves it whenever it still contains commits absent from the base ref.
 */
export async function maintainTerminalIssueWorktree(
  git: GitRunner,
  repositoryPath: string,
  worktree: { path: string; branch: string },
  options: { baseRef?: string; completedAt?: string; nowMs?: number } = {},
): Promise<TerminalWorktreeMaintenanceResult> {
  const compacted = await compactWorktreeArtifacts(git, worktree.path);
  if (!options.completedAt) {
    return { ...compacted, gc: { status: "retained", reason: "not-completed" } };
  }
  const completedAtMs = Date.parse(options.completedAt);
  const nowMs = options.nowMs ?? Date.now();
  if (
    !Number.isFinite(completedAtMs) ||
    completedAtMs > nowMs - COMPLETED_WORKTREE_RETENTION_MS
  ) {
    return { ...compacted, gc: { status: "retained", reason: "retention-period" } };
  }

  const status = git(["status", "--porcelain", "--untracked-files=all"], {
    cwd: worktree.path,
  });
  if (status.exitCode !== 0) {
    return {
      ...compacted,
      gc: {
        status: "retained",
        reason: "git-status-error",
        detail: status.stderr.trim() || status.stdout.trim(),
      },
    };
  }
  if (status.stdout.trim()) {
    return { ...compacted, gc: { status: "retained", reason: "dirty" } };
  }

  try {
    const removed = removeIssueWorktree(git, repositoryPath, worktree, {
      baseRef: options.baseRef,
    });
    return {
      ...compacted,
      gc: {
        status: "removed",
        branchDeleted: removed.branchDeleted,
        ...(removed.preservedBranch ? { preservedBranch: removed.preservedBranch } : {}),
      },
    };
  } catch (error) {
    return {
      ...compacted,
      gc: {
        status: "retained",
        reason: "removal-error",
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Whether the branch holds commits the base ref does not already contain.
 *
 * `git branch -d` compares against the current HEAD, and the main checkout is
 * normally behind the remote base, so it refuses even for an untouched issue
 * branch. Comparing against the base ref answers the question that actually
 * matters: is there work here that would be lost?
 */
function branchHasUniqueWork(
  git: GitRunner,
  repositoryPath: string,
  branch: string,
  baseRef: string | undefined,
): boolean {
  return !issueWorktreeMergedIntoBase(git, repositoryPath, branch, baseRef);
}

/**
 * Remove one issue worktree. Cleanliness is proven before anything is torn
 * down, so a failed removal leaves a working checkout the operator can still
 * inspect. The branch is deleted with `-d`, never `-D`: unmerged work survives
 * as a branch instead of disappearing with the directory.
 */
export function removeIssueWorktree(
  git: GitRunner,
  repositoryPath: string,
  worktree: { path: string; branch: string },
  options: { force?: boolean; baseRef?: string } = {},
): RemoveWorktreeResult {
  if (!options.force) {
    const status = git(["status", "--porcelain", "--untracked-files=all"], {
      cwd: worktree.path,
    });
    if (status.exitCode === 0 && status.stdout.trim()) {
      throw new Error(
        `워크트리에 커밋되지 않은 변경이 있어 삭제를 중단했습니다: ${worktree.path}`,
      );
    }
  }

  const remove = git(
    ["worktree", "remove", ...(options.force ? ["--force"] : []), worktree.path],
    { cwd: repositoryPath },
  );
  if (remove.exitCode !== 0) {
    const detail = remove.stderr.trim() || remove.stdout.trim();
    // An externally deleted directory still needs its git bookkeeping dropped.
    if (!/is not a working tree|No such file or directory/iu.test(detail)) {
      throw new Error(`워크트리를 삭제하지 못했습니다. ${detail}`.trim());
    }
    git(["worktree", "prune"], { cwd: repositoryPath });
  }

  // `-d` first: it can never lose work. Only when the refusal is purely the
  // stale-HEAD artifact does the branch get dropped with `-D`.
  if (git(["branch", "-d", worktree.branch], { cwd: repositoryPath }).exitCode === 0) {
    return { removed: true, branchDeleted: true };
  }
  if (
    !branchHasUniqueWork(git, repositoryPath, worktree.branch, options.baseRef) &&
    git(["branch", "-D", worktree.branch], { cwd: repositoryPath }).exitCode === 0
  ) {
    return { removed: true, branchDeleted: true };
  }
  return { removed: true, branchDeleted: false, preservedBranch: worktree.branch };
}

/** Every worktree of this repository that lives under the project's root. */
export function listIssueWorktrees(
  git: GitRunner,
  repositoryPath: string,
  root: string,
): { path: string; branch: string | null }[] {
  return parseWorktreeList(
    gitOrThrow(git, ["worktree", "list", "--porcelain"], {
      cwd: repositoryPath,
      message: "워크트리 목록을 읽지 못했습니다.",
    }),
  ).filter((worktree) => isPathWithinRoot(worktree.path, root));
}

/** Find an already-attached issue worktree without creating or fetching one. */
export function findExistingIssueWorktree(
  git: GitRunner,
  repositoryPath: string,
  root: string,
  issue: WorktreeIssue,
  branch: string | null,
) {
  const expectedName = worktreeNameFor(issue);
  return (
    listIssueWorktrees(git, repositoryPath, root).find(
      (candidate) =>
        (branch !== null && candidate.branch === branch) ||
        basename(candidate.path) === expectedName,
    ) ?? null
  );
}
