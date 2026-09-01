import {
  chmod,
  mkdir,
  writeFile,
} from "node:fs/promises";
import {
  join,
  resolve,
} from "node:path";
import {
  allocateIssueWorktree,
  listCompletedWorktrees,
  listIssueWorktrees,
  maintainTerminalIssueWorktree,
  projectWorktreeRoot,
  recordCompletedWorktree,
  removeCompletedWorktreeRecord,
  removeIssueWorktree,
  samePath,
  type IssueWorktree,
} from "./worktree";
import { briarIssueUrl } from "./github-pr";
import {
  type Config,
  type ProjectConfig,
} from "./config-contract";
import {
  decodeIsoDateTimeWithOffset,
  decodeUuid,
  decodeWorkspaceMode,
} from "./command-contract";
import { RunStatus } from "@briar/contracts/gen/briar/app/v1/common_pb";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type {
  QueuedAttachment,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { DashboardService } from "@briar/contracts/gen/briar/app/v1/dashboard_pb";
import { createAuthenticatedConnectClient } from "./connect-client";
import {
  localClaimResult,
  localClaimResultJson,
  localNoWorkResult,
  type LocalClaimWorkspace,
} from "./local-output-contract";
import {
  executionToken,
  configDirectory,
  value,
  has,
  required,
  loadConfig,
  saveConfig,
  saveConfigAt,
  runGit,
  worktreeSettings,
  worktreesEnabled,
  activeClaimWorktree,
  currentProject,
} from "./command-support";
import {
  createAuthenticatedWorkerExecutionClient,
} from "./worker-queue-client";

type DownloadableAttachment = Pick<
  QueuedAttachment,
  "id" | "filename" | "contentType" | "byteSize" | "url"
>;

function safeAttachmentFilename(filename: string) {
  const normalized = filename
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^\.+/u, "")
    .slice(-120);
  return normalized || "attachment";
}

async function downloadClaimAttachment(
  apiUrl: string,
  token: string,
  projectId: string,
  runId: string,
  attachment: DownloadableAttachment,
  storageDirectory = configDirectory,
) {
  const expectedPrefix = `/projects/${projectId}/runs/${runId}/attachments/`;
  if (!attachment.url.startsWith(expectedPrefix)) {
    throw new Error("Attachment URL does not belong to the claimed issue");
  }
  const response = await fetch(
    `${apiUrl.replace(/\/$/u, "")}${attachment.url}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    throw new Error(`Attachment download failed (${response.status})`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== attachment.byteSize) {
    throw new Error("Attachment size did not match its metadata");
  }
  const directory = join(storageDirectory, "attachments", runId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(
    directory,
    `${attachment.id}-${safeAttachmentFilename(attachment.filename)}`,
  );
  await writeFile(path, bytes, { mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}

async function claimWork() {
  const config = await loadConfig();
  const project = await currentProject(config);
  const runId = value("--run");
  if (runId) decodeUuid(runId);
  if (
    project.activeClaim &&
    !project.activeClaim.finished &&
    Date.parse(project.activeClaim.leaseExpiresAt) > Date.now() &&
    !has("--runtime-dispatch")
  ) {
    throw new Error(
      `이미 처리 중인 claim이 있습니다: ${project.activeClaim.sourceKey}`,
    );
  }
  const agentToken = executionToken(project);
  const executionRpc = createAuthenticatedWorkerExecutionClient(
    config.apiUrl,
    agentToken,
  );
  const result = await executionRpc.claimIssue({
    projectId: project.id,
    runId,
    claimedBy: value("--actor") ?? "briar-workflow",
  });
  if (result.issue === undefined) {
    console.log(localClaimResultJson(localNoWorkResult()));
    return;
  }
  const issue = result.issue;
  const payload = issue.payload;
  if (payload === undefined || payload.leaseExpiresAt === undefined) {
    throw new Error("Worker claim omitted its durable issue payload");
  }
  const leaseExpiresAt = timestampDate(payload.leaseExpiresAt).toISOString();
  config.projects = config.projects.map((candidate) =>
    candidate.id === project.id
      ? {
          ...candidate,
          activeClaim: {
            runId: payload.runId,
            sourceKey: payload.sourceKey,
            token: issue.claimToken,
            leaseExpiresAt,
          },
        }
      : candidate,
  );
  await saveConfig(config);
  // Persist the claim before workspace allocation so a crash cannot lose the
  // token needed to report or release the run.
  const { workspace, workspaceError } = await allocateClaimWorkspace(
    config,
    project,
    payload,
  );
  const attachments = await Promise.all(
    issue.attachments.map(async (attachment) => {
      try {
        return {
          attachment,
          localPath: await downloadClaimAttachment(
            config.apiUrl,
            agentToken,
            project.id,
            payload.runId,
            attachment,
          ),
          downloadError: null,
        };
      } catch (error) {
        return {
          attachment,
          localPath: null,
          downloadError: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  console.log(
    localClaimResultJson(localClaimResult({
      issue,
      attachments,
      briarIssueUrl: briarIssueUrl(
        config.apiUrl,
        project.id,
        payload.runId,
      ),
      workspace,
      workspaceError,
    })),
  );
}

/**
 * Resolve the claimed run's workspace. Allocation failures stay in the
 * response because the run is already claimed and must remain reportable.
 */
async function allocateClaimWorkspace(
  config: Config,
  project: ProjectConfig,
  issue: { runId: string; sourceKey: string; title: string },
  storageDirectory = configDirectory,
): Promise<{
  workspace: LocalClaimWorkspace;
  workspaceError: string | null;
}> {
  const requestedMode = decodeWorkspaceMode(value("--workspace") ?? "project");
  const mode =
    requestedMode === "project"
      ? worktreesEnabled(project)
        ? "worktree"
        : "current"
      : requestedMode;
  if (mode === "none") {
    return { workspace: null, workspaceError: null };
  }
  if (mode === "current") {
    return {
      workspace: { type: "current", path: project.repositoryPath },
      workspaceError: null,
    };
  }
  try {
    const worktree = await allocateIssueWorktree({
      repositoryPath: project.repositoryPath,
      projectId: project.id,
      issue,
      settings: worktreeSettings(project),
      git: runGit,
      ...(value("--base-branch") ? { baseRef: required("--base-branch") } : {}),
    });
    await removeCompletedWorktreeRecord(
      projectWorktreeRoot(worktreeSettings(project).root, project.id),
      issue.runId,
    );
    config.projects = config.projects.map((candidate) =>
      candidate.id === project.id && candidate.activeClaim
        ? {
            ...candidate,
            activeClaim: {
              ...candidate.activeClaim,
              worktree: {
                path: worktree.path,
                branch: worktree.branch,
                baseRef: worktree.baseRef,
                baseSha: worktree.baseSha,
              },
            },
          }
        : candidate,
    );
    await saveConfigAt(storageDirectory, config);
    return {
      workspace: { type: "worktree", ...worktree },
      workspaceError: null,
    };
  } catch (error) {
    return {
      workspace: null,
      workspaceError: error instanceof Error ? error.message : String(error),
    };
  }
}

async function worktreeShow() {
  const config = await loadConfig();
  const project = await currentProject(config);
  const settings = worktreeSettings(project);
  console.log(
    JSON.stringify({
      projectId: project.id,
      root: projectWorktreeRoot(settings.root, project.id),
      branchPrefix: settings.branchPrefix,
      sourceKey: project.activeClaim?.sourceKey ?? null,
      worktree: activeClaimWorktree(project),
    }),
  );
}

async function worktreeList() {
  const config = await loadConfig();
  const project = await currentProject(config);
  const root = projectWorktreeRoot(worktreeSettings(project).root, project.id);
  console.log(
    JSON.stringify({
      projectId: project.id,
      root,
      worktrees: listIssueWorktrees(runGit, project.repositoryPath, root),
    }),
  );
}

async function worktreeRemove() {
  const config = await loadConfig();
  const project = await currentProject(config);
  const root = projectWorktreeRoot(worktreeSettings(project).root, project.id);
  const target = resolve(value("--path") ?? activeClaimWorktree(project).path);
  // Only ever remove a registered worktree under this project's root, so a
  // wrong `--path` cannot take out the main checkout or an unrelated tree.
  const registered = listIssueWorktrees(runGit, project.repositoryPath, root).find((worktree) =>
    samePath(worktree.path, target),
  );
  if (!registered?.branch) {
    throw new Error(`이 프로젝트의 워크트리가 아닙니다: ${target}`);
  }
  const result = removeIssueWorktree(
    runGit,
    project.repositoryPath,
    { path: registered.path, branch: registered.branch },
    { force: has("--force") },
  );
  if (
    project.activeClaim?.worktree &&
    samePath(project.activeClaim.worktree.path, registered.path)
  ) {
    config.projects = config.projects.map((candidate) => {
      if (candidate.id !== project.id || !candidate.activeClaim) return candidate;
      const { worktree: _removed, ...activeClaim } = candidate.activeClaim;
      return { ...candidate, activeClaim };
    });
    await saveConfig(config);
  }
  console.log(JSON.stringify({ path: registered.path, branch: registered.branch, ...result }));
}

async function maintainRecordedCompletedWorktrees(project: ProjectConfig) {
  const root = projectWorktreeRoot(worktreeSettings(project).root, project.id);
  const registeredWorktrees = listIssueWorktrees(runGit, project.repositoryPath, root);
  const results = [];
  for (const record of await listCompletedWorktrees(root)) {
    const registered = registeredWorktrees.find(
      (worktree) =>
        worktree.branch === record.branch && samePath(worktree.path, record.path),
    );
    if (!registered?.branch) {
      await removeCompletedWorktreeRecord(root, record.runId);
      results.push({
        path: record.path,
        branch: record.branch,
        gc: { status: "removed", branchDeleted: false, alreadyAbsent: true },
      });
      continue;
    }
    const result = await maintainTerminalIssueWorktree(
      runGit,
      project.repositoryPath,
      { path: registered.path, branch: registered.branch },
      { completedAt: record.completedAt },
    );
    if (result.gc.status === "removed") {
      await removeCompletedWorktreeRecord(root, record.runId);
    }
    results.push({ path: registered.path, branch: registered.branch, ...result });
  }
  return results;
}

async function syncCompletedWorktreeRecordsFromDashboard(
  config: Config,
  project: ProjectConfig,
): Promise<number> {
  if (!config.userToken) return 0;
  const dashboard = await createAuthenticatedConnectClient(
    DashboardService,
    config.apiUrl,
    config.userToken,
  ).getDashboard({ projectId: project.id });
  const completedRuns = dashboard.runs
    .filter(
      (run): run is typeof run & {
        branch: string;
        completedAt: NonNullable<typeof run.completedAt>;
      } =>
        run.status === RunStatus.COMPLETED &&
        run.branch !== undefined &&
        run.completedAt !== undefined,
    )
    .map((run) => ({
      ...run,
      completedAt: timestampDate(run.completedAt).toISOString(),
    }));
  const root = projectWorktreeRoot(worktreeSettings(project).root, project.id);
  const existingRunIds = new Set(
    (await listCompletedWorktrees(root)).map((record) => record.runId),
  );
  const registeredWorktrees = listIssueWorktrees(runGit, project.repositoryPath, root);
  let recorded = 0;
  for (const run of completedRuns) {
    if (existingRunIds.has(run.id)) continue;
    const worktree = registeredWorktrees.find((candidate) => candidate.branch === run.branch);
    if (!worktree?.branch) continue;
    await recordCompletedWorktree(root, {
      runId: run.id,
      path: worktree.path,
      branch: worktree.branch,
      completedAt: run.completedAt,
    });
    recorded += 1;
  }
  return recorded;
}

async function worktreeMaintain() {
  const config = await loadConfig();
  const project = await currentProject(config);
  const root = projectWorktreeRoot(worktreeSettings(project).root, project.id);
  const registeredWorktrees = listIssueWorktrees(runGit, project.repositoryPath, root);
  if (has("--all")) {
    try {
      await syncCompletedWorktreeRecordsFromDashboard(config, project);
    } catch {
      // Previously recorded completions remain maintainable while offline.
    }
    const results = await maintainRecordedCompletedWorktrees(project);
    console.log(JSON.stringify({ projectId: project.id, results }));
    return;
  }
  const activeWorktree = project.activeClaim?.worktree;
  const target = resolve(value("--path") ?? activeClaimWorktree(project).path);
  const registered = registeredWorktrees.find((worktree) =>
    samePath(worktree.path, target),
  );
  if (!registered?.branch) {
    throw new Error(`이 프로젝트의 워크트리가 아닙니다: ${target}`);
  }
  const baseRef =
    activeWorktree && samePath(activeWorktree.path, registered.path)
      ? activeWorktree.baseRef
      : undefined;
  const completedAt = value("--completed-at");
  if (completedAt) decodeIsoDateTimeWithOffset(completedAt);
  const completedRunId = value("--run");
  if (completedRunId) decodeUuid(completedRunId);
  if (Boolean(completedAt) !== Boolean(completedRunId)) {
    throw new Error("--completed-at and --run must be supplied together");
  }
  if (completedAt && completedRunId) {
    await recordCompletedWorktree(root, {
      runId: completedRunId,
      path: registered.path,
      branch: registered.branch,
      completedAt,
    });
  }
  const result = await maintainTerminalIssueWorktree(
    runGit,
    project.repositoryPath,
    { path: registered.path, branch: registered.branch },
    {
      ...(baseRef ? { baseRef } : {}),
      ...(completedAt ? { completedAt } : {}),
    },
  );
  if (
    result.gc.status === "removed" &&
    project.activeClaim?.worktree &&
    samePath(project.activeClaim.worktree.path, registered.path)
  ) {
    config.projects = config.projects.map((candidate) => {
      if (candidate.id !== project.id || !candidate.activeClaim) return candidate;
      const { worktree: _removed, ...activeClaim } = candidate.activeClaim;
      return { ...candidate, activeClaim };
    });
    await saveConfig(config);
  }
  if (result.gc.status === "removed" && completedRunId) {
    await removeCompletedWorktreeRecord(root, completedRunId);
  }
  console.log(JSON.stringify({ path: registered.path, branch: registered.branch, ...result }));
}

export {
  safeAttachmentFilename,
  downloadClaimAttachment,
  claimWork,
  allocateClaimWorkspace,
  worktreeShow,
  worktreeList,
  worktreeRemove,
  maintainRecordedCompletedWorktrees,
  syncCompletedWorktreeRecordsFromDashboard,
  worktreeMaintain,
};
