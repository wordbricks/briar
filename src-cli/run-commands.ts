
import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir, platform, tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import packageJson from "../package.json";
import {
  autoHuntRequirementKinds,
  repositoryWorkflowPendingStageId,
} from "../src/lib/auto-hunt-contract";
import { decodeStructuredAgentResult } from "../src/lib/agent-result";
import {
  agentExecutionCostRecordsFromObservations,
  agentExecutionMetrics,
  agentExecutionTokenUsageFromObservations,
  agentExecutionUsageRecordsFromObservations,
  createAgentExecutionUsageCollector,
} from "../src/lib/agent-execution-metrics";
import type { ModelEffort } from "../src/lib/agent-provider-contract";
import type { AgentProvider } from "../src/lib/agent-provider";
import { validateEvidenceImages } from "../src/lib/evidence-images";
import {
  decodeOrganizationAgentContextRequestTurn,
  organizationAgentContextCapability,
} from "../src/lib/organization-agent-context-contract";
import {
  createDetachedTranscriptSequencer,
  detachedAgentPrompt,
  detachedChannelReplyPrompt,
  detachedChannelReplyOutputSchema,
  detachedIssueReplyPrompt,
  detachedIssueReplyOutputSchema,
  detachedProjectAgentPrompt,
  detachedPayloadDirection,
  detachedProviderBlockedRunEvent,
  detachedProviderBlockFromPayload,
  detachedRunContinuationPrompt,
  detachedRunDisposition,
  detachedRunRecoveryPrompt,
  detachedRunTurnDecision,
  detachedTranscriptPayload,
  detachedTranscriptSessionId,
  parseDetachedIssueReplyResult,
  parseDetachedJsonResult,
  runProjectAgentTaskCompletionFlow,
  shouldPersistDetachedTranscriptPayload,
  type DetachedAgent,
} from "./agent-runner";
import { agentImageAttachments } from "../src-agent/runner-attachments";
import {
  assertDetachedProviderTurnSucceeded,
  detachedProviderTurnFailure,
  runDetachedProviderTurn,
} from "./detached-provider-turn";
import {
  TranscriptBatcher,
  type TranscriptBatchEvent,
} from "./transcript-batcher";
import {
  ChannelActivityPublisher,
  type ChannelActivityCredential,
} from "./channel-activity-publisher";
import {
  HttpRequestError,
  uploadExecutionMetricsWithCostCompatibility,
} from "./execution-metrics-upload";
import {
  inspectWorkflowRequirements,
  workflowRequirementReadinessDetail,
} from "./workflow-requirements";
import {
  createWorkerDeviceIdentity,
  defaultWorkerLabel,
  errorDelayMs,
  issueWorkerSessionDirectory,
  interruptibleSleep,
  restartInstalledServices,
  runWorkerLoop,
  serviceDefinition,
  workerCliPath,
  workerExecutionPath,
  writeServiceDefinition,
  type ClaimedIssue,
  type WorkerExecutionCheckpoint,
} from "./worker";
import {
  claimMergeBatchIfReady,
  executeClaimedMergeBatch,
  inspectMergeQueueDoctor,
  mergeQueueProfileFromResponse,
  releaseMergeBatchClaim,
  renewMergeBatchClaim,
  type MergeBatchApi,
} from "./merge-queue";
import { resolveMergeGroupContainerRuntime } from "./merge-group-validation";
import {
  supportsRemoteWorkerUpdates,
  workerUpdateDeepLink,
  type WorkerUpdateDirective,
} from "./worker-update";
import {
  allocateAnalysisWorktree,
  allocateCachedAnalysisWorktree,
  allocateIssueWorktree,
  analysisWorktreePath,
  defaultWorktreeRoot,
  findExistingIssueWorktree,
  issueReplyWorkspaceMode,
  listCompletedWorktrees,
  listIssueWorktrees,
  maintainIdleAnalysisWorktrees,
  maintainTerminalIssueWorktree,
  markCachedAnalysisWorktreeIdle,
  projectWorktreeRoot,
  recordCompletedWorktree,
  removeAnalysisWorktree,
  removeCompletedWorktreeRecord,
  removeIssueWorktree,
  resolveBaseRef,
  samePath,
  type GitRunner,
  type IssueWorktree,
  type WorktreeSettings,
} from "./worktree";
import {
  sameApiEnvironment,
  selectProjectForApi,
} from "./config-environment";
import {
  channelReplyCompleteRequestBody,
  collectChannelReplyAttachments,
  parseChannelReplyAgentResult,
} from "./channel-reply-attachments";
import {
  channelReplyImageDirectory,
  cleanupChannelReplyImages,
  downloadChannelReplyImages,
} from "./channel-reply-images";
import { cleanupChannelReplyResources } from "./channel-reply-cleanup";
import { assertChannelReplyWorkspaceScope } from "./channel-reply-scope";
import {
  cleanupOrphanedOrganizationAgentWorkspaces,
  cleanupOrganizationAgentContext,
  downloadOrganizationAgentContextManifest,
  hydrateOrganizationAgentContext,
  prepareOrganizationAgentWorkspace,
} from "./organization-agent-context";
import {
  healthyWorkerProviders,
  inspectWorkerProviderHealth,
  providerHealthReadinessDetail,
} from "./provider-health";
import { discoverWorkerProviderCapabilities } from "./provider-capabilities";
import {
  configureBrowserSkillGuide,
  getSkillGuide,
  skillGuides,
} from "./skill-guides";
import {
  briarIssueUrl,
  ensureBriarIssueLinkInGithubPullRequest,
} from "./github-pr";
import {
  configErrorLocations,
  decodeConfig,
  type Config,
  type ProjectConfig,
} from "./config-contract";
import {
  decodeChannelMessagesInput,
  decodeCreateIssueInput,
  decodeDashboardRuns,
  decodeIsoDateTimeWithOffset,
  decodeRunEvidenceInput,
  decodeUuid,
  decodeVelenEnvelope,
  decodeWorkflowStageId,
  decodeWorkspaceMode,
  httpErrorMessage,
  validateRecoveryRunInput,
  validateResumeRunInput,
  validateReworkRunInput,
  validateRunEventInput,
  validateWorkflowTransitionInput,
} from "./command-contract";
import {
  decodeClaimedChannelReply,
  decodeClaimedIssueReply,
  decodeClaimedMergeBatch,
  decodeClaimedProjectAgentTask,
  decodeClaimedRun,
  decodeDetachedAgentEffortOption,
  decodeDetachedAgentSkillsOption,
  decodeQueuedIssue,
  decodeWorkerBinding,
  decodeWorkerRegistration,
  type ClaimedChannelReply,
  type ClaimedIssueReply,
  type ClaimedProjectAgentTask,
  type ClaimedRun,
  type DetachedAgentClaim,
  type DetachedAgentSkill,
  type QueuedAttachment,
  type WorkerRegistration,
} from "./worker-claim-contract";

import {
  executionToken,
  values,
  value,
  has,
  required,
  loadConfig,
  saveConfig,
  request,
  login,
  gitValue,
  currentRepositoryPath,
  currentProject,
} from "./command-support";

async function optionalText(valueFlag: string, fileFlag: string) {
  const path = value(fileFlag);
  if (path) return readFile(resolve(path), "utf8");
  return value(valueFlag) ?? null;
}

async function createIssueCommand() {
  const config = await loadConfig();
  if (!config.userToken) throw new Error("먼저 `briar login`을 실행하세요.");
  const project = await currentProject(config);
  const priorityValue = value("--priority");
  const input = decodeCreateIssueInput({
    title: required("--title"),
    description: await optionalText("--description", "--description-file"),
    priority: priorityValue === undefined ? null : Number(priorityValue),
    status: value("--status") ?? "queued",
  });
  const result = await request<{
    runId: string;
    sourceKey: string;
    stage: "queued";
    status: "backlog" | "queued";
    attachments: unknown[];
  }>(
    config.apiUrl,
    `/projects/${encodeURIComponent(project.id)}/issues`,
    config.userToken,
    { method: "POST", body: JSON.stringify(input) },
  );
  console.log(JSON.stringify(result));
}

async function changeIssueDependencyCommand(action: "add" | "remove") {
  const config = await loadConfig();
  if (!config.userToken) throw new Error("먼저 `briar login`을 실행하세요.");
  const project = await currentProject(config);
  const dependentRunId = decodeUuid(required("--dependent-run"));
  const prerequisiteRunId = decodeUuid(required("--prerequisite-run"));
  const path =
    `/projects/${encodeURIComponent(project.id)}` +
    `/runs/${encodeURIComponent(dependentRunId)}` +
    `/dependencies/${encodeURIComponent(prerequisiteRunId)}`;

  if (action === "add") {
    const result = await request<{
      prerequisiteRunId: string;
      dependentRunId: string;
      outcome: "created" | "already_exists";
    }>(config.apiUrl, path, config.userToken, { method: "PUT" });
    console.log(JSON.stringify(result));
    return;
  }

  await request<void>(config.apiUrl, path, config.userToken, {
    method: "DELETE",
  });
  console.log(
    JSON.stringify({ dependentRunId, prerequisiteRunId, outcome: "removed" }),
  );
}

const channelMessagesUsage = `Usage: briar channel messages --channel-id <uuid>
  [--limit <1-100>] [--cursor <message-uuid>]
  [--parent-message-id <root-message-uuid>]`;

async function listChannelMessagesCommand() {
  if (has("--help")) {
    console.log(channelMessagesUsage);
    return;
  }
  const config = await loadConfig();
  const project = await currentProject(config);
  const input = decodeChannelMessagesInput({
    channelId: required("--channel-id"),
    limit: value("--limit") === undefined ? 50 : Number(value("--limit")),
    cursor: value("--cursor") ?? null,
    parentMessageId: value("--parent-message-id") ?? null,
  });
  const searchParams = new URLSearchParams({ limit: String(input.limit) });
  if (input.cursor) searchParams.set("cursor", input.cursor);
  if (input.parentMessageId) {
    searchParams.set("parentMessageId", input.parentMessageId);
  }
  const result = await request<{
    channel: unknown;
    messages: unknown[];
    nextCursor: string | null;
  }>(
    config.apiUrl,
    `/projects/${encodeURIComponent(project.id)}` +
      `/channels/${encodeURIComponent(input.channelId)}/messages?${searchParams}`,
    process.env.BRIAR_AGENT_TOKEN ?? project.agentToken,
  );
  console.log(JSON.stringify(result));
}

async function addRunEvent(forcedStatus?: string) {
  const config = await loadConfig();
  const project = await currentProject(config);
  const repositoryRoot = await currentRepositoryPath();
  const agentToken = executionToken(project);
  if (!agentToken) throw new Error("Briar 실행 토큰이 없습니다.");
  const branch = value("--branch") ?? gitValue(["branch", "--show-current"]);
  const commitSha = value("--commit-sha") ?? gitValue(["rev-parse", "HEAD"]);
  const remote = gitValue(["remote", "get-url", "origin"]);
  const repository = value("--repository") ?? remote ?? basename(repositoryRoot);
  const issueId = value("--issue-id") ?? null;
  const issueIdentifier = value("--issue-identifier") ?? null;
  const issueUrl = value("--issue-url") ?? null;
  const issueState = value("--issue-state") ?? null;
  const hasLinearReference = Boolean(
    issueId || issueIdentifier || issueUrl || issueState,
  );
  const contextValue = value("--context-json");
  const structuredResultValue = await optionalText(
    "--structured-result",
    "--structured-result-file",
  );
  const structuredResult = structuredResultValue
    ? decodeStructuredAgentResult(JSON.parse(structuredResultValue))
    : null;
  const runId = value("--run") ?? project.activeClaim?.runId ?? null;
  const sourceKey = value("--source-key") ?? project.activeClaim?.sourceKey ?? null;
  const title = value("--title");
  const input = {
    runId,
    source: value("--source") ?? (runId ? null : "issue"),
    sourceKey,
    title: title ?? null,
    status: forcedStatus ?? value("--status"),
    workflowStage: value("--workflow-stage"),
    eventKey: required("--event-key"),
    occurredAt: value("--observed-at") ?? value("--occurred-at") ?? new Date().toISOString(),
    actor: value("--actor") ?? "briar-workflow",
    repository,
    detail: value("--status-detail") ?? value("--detail") ?? null,
    priority: value("--priority") ? Number(value("--priority")) : null,
    branch: branch || null,
    commitSha: commitSha || null,
    tracker: hasLinearReference
      ? {
          provider:
            value("--tracker-provider") ??
            (project.autoHunt?.linear?.enabled ? "linear" : "generic"),
          issueId,
          identifier: issueIdentifier,
          url: issueUrl,
          state: issueState,
        }
      : null,
    issueDescription: await optionalText("--issue-description", "--issue-description-file"),
    resultSummary:
      structuredResult?.summary ??
      (await optionalText("--result-summary", "--result-summary-file")),
    structuredResult,
    pullRequestUrls: values("--pull-request-url"),
    targetSha: value("--target-sha") ?? null,
    sourceCreatedAt: value("--source-created-at") ?? null,
    context: contextValue ? JSON.parse(contextValue) : null,
  };
  if (forcedStatus === "completed" && !input.structuredResult) {
    throw new Error(
      "run complete requires --structured-result or --structured-result-file",
    );
  }
  if (
    forcedStatus === "completed" &&
    input.structuredResult &&
    !["completed", "partial"].includes(input.structuredResult.outcome)
  ) {
    throw new Error(
      "run complete structured outcome must be completed or partial",
    );
  }
  if (input.status === "blocked" && !input.structuredResult) {
    throw new Error(
      "--status blocked requires --structured-result or --structured-result-file",
    );
  }
  if (
    input.status === "blocked" &&
    input.structuredResult?.outcome !== "blocked"
  ) {
    throw new Error("--status blocked structured outcome must be blocked");
  }
  if (
    input.status === "blocked" &&
    (!input.structuredResult?.humanActionRequired ||
      !input.structuredResult.nextAction)
  ) {
    throw new Error(
      "--status blocked requires humanActionRequired and an exact nextAction",
    );
  }
  validateRunEventInput(input);
  const result = await request<{
    runId: string;
    status: string;
    workflowStage: string | null;
    stage: string;
  }>(
    config.apiUrl,
    "/run-events",
    agentToken,
    {
      method: "POST",
      body: JSON.stringify(input),
      headers:
        project.activeClaim?.runId === input.runId && project.activeClaim.token
          ? { "X-Briar-Claim-Token": project.activeClaim.token }
          : undefined,
    },
  );
  if (project.activeClaim?.runId === result.runId) {
    const terminal = ["completed", "cancelled", "blocked", "failed"].includes(
      input.status ?? "",
    );
    config.projects = config.projects.map((candidate) =>
      candidate.id === project.id
        ? {
            ...candidate,
            activeClaim: candidate.activeClaim && terminal
              ? {
                  ...candidate.activeClaim,
                  token: undefined,
                  finished: true,
                  terminalStatus: input.status as "completed" | "cancelled" | "blocked" | "failed",
                  finishedAt: input.occurredAt,
                }
              : candidate.activeClaim,
          }
        : candidate,
    );
    await saveConfig(config);
  }
  console.log(JSON.stringify(result));
}

async function addRunEvidence() {
  const config = await loadConfig();
  const project = await currentProject(config);
  const runId = value("--run") ?? project.activeClaim?.runId;
  if (!runId) throw new Error("--run is required when there is no active claim");
  const metadataValue = value("--metadata-json");
  const input = {
    evidenceKey: required("--key"),
    stage: required("--stage"),
    type: required("--type"),
    status: required("--status"),
    observedAt: value("--observed-at") ?? new Date().toISOString(),
    actor: value("--actor") ?? "briar-workflow",
    detail: await optionalText("--detail", "--detail-file"),
    command: value("--command") ?? null,
    url: value("--url") ?? null,
    metadata: metadataValue ? JSON.parse(metadataValue) : null,
  };
  const parsed = decodeRunEvidenceInput(input);
  if (
    parsed.type === "pull_request" &&
    parsed.url &&
    (parsed.status === "passed" || parsed.status === "pending")
  ) {
    const github = ensureBriarIssueLinkInGithubPullRequest({
      pullRequestUrl: parsed.url,
      issueUrl: briarIssueUrl(config.apiUrl, project.id, runId),
    });
    parsed.metadata = {
      ...(parsed.metadata ?? {}),
      githubPullRequest: github.identity,
    };
  }
  const imagePaths = values("--image").map((path) => resolve(path));
  const images = await Promise.all(
    imagePaths.map(async (path) => {
      const image = Bun.file(path);
      if (!(await image.exists())) {
        throw new Error(`Evidence image does not exist: ${path}`);
      }
      return { image, name: basename(path) };
    }),
  );
  const imageError = validateEvidenceImages(
    images.map(({ image, name }) => ({
      name,
      size: image.size,
      type: image.type,
    })),
  );
  if (imageError) throw new Error(imageError);
  const body = images.length
    ? (() => {
        const form = new FormData();
        form.append("evidence", JSON.stringify(parsed));
        for (const { image, name } of images) {
          form.append("images", image, name);
        }
        return form;
      })()
    : JSON.stringify(parsed);
  const result = await request(
    config.apiUrl,
    `/runs/${runId}/evidence`,
    executionToken(project),
    {
      method: "POST",
      body,
      headers:
        project.activeClaim?.runId === runId && project.activeClaim.token
          ? { "X-Briar-Claim-Token": project.activeClaim.token }
          : undefined,
    },
  );
  console.log(JSON.stringify(result));
}

async function listCurrentRunEvidence() {
  const config = await loadConfig();
  const project = await currentProject(config);
  const runId = value("--run") ?? project.activeClaim?.runId;
  if (!runId) throw new Error("--run is required when there is no active claim");
  decodeUuid(runId);
  const result = await request(
    config.apiUrl,
    `/runs/${runId}/evidence`,
    executionToken(project),
  );
  console.log(JSON.stringify(result));
}

async function recoverRun(action: "retry" | "cancel") {
  const config = await loadConfig();
  const project = await currentProject(config);
  const runId = value("--run") ?? project.activeClaim?.runId;
  if (!runId) throw new Error("--run is required when there is no active claim");
  const input = {
    requestId: value("--request-id") ?? crypto.randomUUID(),
    actor: value("--actor") ?? "briar-workflow",
    reason: value("--reason") ?? null,
  };
  validateRecoveryRunInput(input);
  decodeUuid(runId);
  const result = await request<{
    runId: string;
    outcome: string;
    attempt: number;
    stage: string;
  }>(
    config.apiUrl,
    `/runs/${runId}/${action}`,
    executionToken(project),
    { method: "POST", body: JSON.stringify(input) },
  );
  if (project.activeClaim?.runId === runId) {
    // The server released this claim while queueing the new revision. Make the
    // current provider turn stop instead of continuing with a stale token.
    config.projects = config.projects.map((candidate) =>
      candidate.id === project.id
        ? { ...candidate, activeClaim: undefined }
        : candidate,
    );
    await saveConfig(config);
  }
  console.log(JSON.stringify(result));
}

async function reworkRun() {
  const config = await loadConfig();
  const project = await currentProject(config);
  const runId = value("--run") ?? project.activeClaim?.runId;
  if (!runId) throw new Error("--run is required when there is no active claim");
  const input = {
    requestId: value("--request-id") ?? crypto.randomUUID(),
    actor: value("--actor") ?? "briar-workflow",
    workflowStage: required("--to"),
    reason: required("--reason"),
  };
  validateReworkRunInput(input);
  decodeUuid(runId);
  const result = await request<{
    runId: string;
    outcome: "reworked" | "already_reworked";
    attempt: number;
    revision: number;
    workflowStage: string;
  }>(
    config.apiUrl,
    `/runs/${runId}/rework`,
    executionToken(project),
    { method: "POST", body: JSON.stringify(input) },
  );
  if (project.activeClaim?.runId === runId) {
    config.projects = config.projects.map((candidate) =>
      candidate.id === project.id
        ? { ...candidate, activeClaim: undefined }
        : candidate
    );
    await saveConfig(config);
  }
  console.log(JSON.stringify(result));
}

async function resumeRun() {
  const config = await loadConfig();
  const project = await currentProject(config);
  const runId = value("--run") ?? project.activeClaim?.runId;
  if (!runId) throw new Error("--run is required when there is no active claim");
  const input = {
    requestId: value("--request-id") ?? crypto.randomUUID(),
    actor: value("--actor") ?? "briar-workflow",
    checkpointKey: value("--checkpoint"),
    attempt: value("--attempt") ? Number(value("--attempt")) : undefined,
    revision: value("--revision") ? Number(value("--revision")) : undefined,
  };
  validateResumeRunInput(input);
  decodeUuid(runId);
  const result = await request<{
    runId: string;
    outcome: string;
    workflowStage: string | null;
    startStage: string | null;
    terminalReviewOnly: boolean;
  }>(
    config.apiUrl,
    `/runs/${runId}/resume`,
    executionToken(project),
    { method: "POST", body: JSON.stringify(input) },
  );
  if (project.activeClaim?.runId === runId) {
    config.projects = config.projects.map((candidate) =>
      candidate.id === project.id
        ? { ...candidate, activeClaim: undefined }
        : candidate,
    );
    await saveConfig(config);
  }
  console.log(JSON.stringify(result));
}

async function transitionWorkflowStage(action: "start" | "complete") {
  const config = await loadConfig();
  const project = await currentProject(config);
  const runId = value("--run") ?? project.activeClaim?.runId;
  if (!runId) throw new Error("--run is required when there is no active claim");
  const stage = required("--stage");
  const input = {
    requestId: value("--request-id") ?? crypto.randomUUID(),
    actor: value("--actor") ?? "briar-workflow",
    attempt: value("--attempt") ? Number(value("--attempt")) : undefined,
    revision: value("--revision") ? Number(value("--revision")) : undefined,
  };
  validateWorkflowTransitionInput(input);
  decodeUuid(runId);
  decodeWorkflowStageId(stage);
  const result = await request<{
    runId: string;
    requestId: string;
    outcome: "started" | "completed" | "already_started" | "already_completed" | "paused";
    attempt: number;
    revision: number;
    stage: string;
    checkpoint: {
      key: string;
      stage: string;
      position: "before" | "after";
      revision: number;
    } | null;
  }>(
    config.apiUrl,
    `/runs/${runId}/stages/${stage}/${action}`,
    executionToken(project),
    {
      method: "POST",
      body: JSON.stringify(input),
      headers:
        project.activeClaim?.runId === runId && project.activeClaim.token
          ? { "X-Briar-Claim-Token": project.activeClaim.token }
          : undefined,
    },
  );
  if (result.outcome === "paused" && project.activeClaim?.runId === runId) {
    config.projects = config.projects.map((candidate) =>
      candidate.id === project.id
        ? { ...candidate, activeClaim: undefined }
        : candidate,
    );
    await saveConfig(config);
  }
  console.log(JSON.stringify(result));
}

export {
  optionalText,
  createIssueCommand,
  changeIssueDependencyCommand,
  channelMessagesUsage,
  listChannelMessagesCommand,
  addRunEvent,
  addRunEvidence,
  listCurrentRunEvidence,
  recoverRun,
  reworkRun,
  resumeRun,
  transitionWorkflowStage,
};

