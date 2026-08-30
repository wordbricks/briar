import { readFile } from "node:fs/promises";
import {
  basename,
  resolve,
} from "node:path";
import {
  create,
  type JsonObject,
  toJsonString,
} from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import {
  CancelRunResponseSchema,
  CreateIssueResponseSchema,
  IssueService,
  ListRunEvidenceResponseSchema,
  ReworkRunResponseSchema,
  ResumeRunResponseSchema,
  RetryRunResponseSchema,
  SetIssueDependencyResponseSchema,
} from "@briar/contracts/gen/briar/app/v1/issue_pb";
import { RunStatus } from "@briar/contracts/gen/briar/app/v1/common_pb";
import {
  RecordRunEventResponseSchema,
  RunSourceIdentitySchema,
  TransitionWorkflowStageRequest_Action,
  TransitionWorkflowStageResponse_Outcome,
  TransitionWorkflowStageResponseSchema,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { decodeStructuredAgentResult } from "../src/lib/agent-result";
import { validateEvidenceImages } from "../src/lib/evidence-images";
import {
  briarIssueUrl,
  ensureBriarIssueLinkInGithubPullRequest,
} from "./github-pr";
import {
  decodeChannelMessagesInput,
  decodeCreateIssueInput,
  decodeRunEvidenceInput,
  decodeUuid,
  decodeWorkflowStageId,
} from "./command-contract";
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
import {
  createAuthenticatedWorkerExecutionClient,
} from "./worker-queue-client";
import {
  issueWorkClaimIdentityToProto,
  workerRunEventRequest,
  workerRunEventStatus,
  workerRunSource,
} from "./run-event-proto";
import {
  appConnectCallOptions,
  appConnectTransport,
} from "./app-connect-client";

async function optionalText(valueFlag: string, fileFlag: string) {
  const path = value(fileFlag);
  if (path) return readFile(resolve(path), "utf8");
  return value(valueFlag) ?? null;
}

const jsonObject = (value: string): JsonObject => {
  const parsed: unknown = JSON.parse(value);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new Error("Run context must be a JSON object");
  }
  return parsed as JsonObject;
};

const activeIssueWork = (
  project: Awaited<ReturnType<typeof currentProject>>,
  runId: string,
) => {
  const claim = project.activeClaim;
  if (claim?.runId !== runId || !claim.token) {
    throw new Error("This run requires its active issue claim");
  }
  return issueWorkClaimIdentityToProto(runId, claim.token);
};

const positiveIntegerFlag = (flag: string) => {
  const parsed = Number(required(flag));
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
};

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
  const result = await createClient(
    IssueService,
    appConnectTransport(config.apiUrl),
  ).createIssue(
    {
      projectId: project.id,
      title: input.title,
      description: input.description ?? undefined,
      priority: input.priority ?? undefined,
      status: input.status === "backlog"
        ? RunStatus.BACKLOG
        : RunStatus.QUEUED,
    },
    appConnectCallOptions(config.userToken),
  );
  console.log(toJsonString(CreateIssueResponseSchema, result));
}

async function changeIssueDependencyCommand(action: "add" | "remove") {
  const config = await loadConfig();
  if (!config.userToken) throw new Error("먼저 `briar login`을 실행하세요.");
  const project = await currentProject(config);
  const dependentRunId = decodeUuid(required("--dependent-run"));
  const prerequisiteRunId = decodeUuid(required("--prerequisite-run"));
  const result = await createClient(
    IssueService,
    appConnectTransport(config.apiUrl),
  ).setIssueDependency(
    {
      projectId: project.id,
      runId: dependentRunId,
      prerequisiteRunId,
      enabled: action === "add",
    },
    appConnectCallOptions(config.userToken),
  );
  console.log(toJsonString(SetIssueDependencyResponseSchema, result));
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
    executionToken(project),
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
  const status = workerRunEventStatus(forcedStatus ?? value("--status"));
  const input = {
    runId,
    source: value("--source") ?? (runId ? null : "issue"),
    sourceKey,
    title: title ?? null,
    status,
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
    context: contextValue ? jsonObject(contextValue) : null,
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
  const target = runId
    ? { case: "work" as const, value: activeIssueWork(project, runId) }
    : {
        case: "sourceIdentity" as const,
        value: create(RunSourceIdentitySchema, {
          source: workerRunSource(input.source ?? undefined),
          sourceKey: sourceKey ?? required("--source-key"),
          title: title ?? required("--title"),
        }),
      };
  const executionRpc = createAuthenticatedWorkerExecutionClient(
    config.apiUrl,
    agentToken,
  );
  const result = await executionRpc.client.recordRunEvent(
    workerRunEventRequest({
      projectId: project.id,
      target,
      event: input,
    }),
    executionRpc.options,
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
  console.log(toJsonString(RecordRunEventResponseSchema, result));
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
    const github = await ensureBriarIssueLinkInGithubPullRequest({
      apiUrl: config.apiUrl,
      projectId: project.id,
      token: executionToken(project),
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
  const executionRpc = createAuthenticatedWorkerExecutionClient(
    config.apiUrl,
    executionToken(project),
  );
  const result = await executionRpc.client.listRunEvidence(
    { projectId: project.id, runId },
    executionRpc.options,
  );
  console.log(toJsonString(ListRunEvidenceResponseSchema, result));
}

async function recoverRun(action: "retry" | "cancel") {
  const config = await loadConfig();
  const project = await currentProject(config);
  const runId = value("--run") ?? project.activeClaim?.runId;
  if (!runId) throw new Error("--run is required when there is no active claim");
  const canonicalRunId = decodeUuid(runId);
  const executionRpc = createAuthenticatedWorkerExecutionClient(
    config.apiUrl,
    executionToken(project),
  );
  const input = {
    projectId: project.id,
    runId: canonicalRunId,
    requestId: decodeUuid(value("--request-id") ?? crypto.randomUUID()),
    reason: value("--reason"),
  };
  const result = action === "retry"
    ? await executionRpc.client.retryRun(input, executionRpc.options)
    : await executionRpc.client.cancelRun(input, executionRpc.options);
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
  console.log(toJsonString(
    action === "retry" ? RetryRunResponseSchema : CancelRunResponseSchema,
    result,
  ));
}

async function reworkRun() {
  const config = await loadConfig();
  const project = await currentProject(config);
  const runId = value("--run") ?? project.activeClaim?.runId;
  if (!runId) throw new Error("--run is required when there is no active claim");
  const executionRpc = createAuthenticatedWorkerExecutionClient(
    config.apiUrl,
    executionToken(project),
  );
  const result = await executionRpc.client.reworkRun({
    projectId: project.id,
    runId: decodeUuid(runId),
    requestId: decodeUuid(value("--request-id") ?? crypto.randomUUID()),
    workflowStage: decodeWorkflowStageId(required("--to")),
    reason: required("--reason"),
  }, executionRpc.options);
  if (project.activeClaim?.runId === runId) {
    config.projects = config.projects.map((candidate) =>
      candidate.id === project.id
        ? { ...candidate, activeClaim: undefined }
        : candidate
    );
    await saveConfig(config);
  }
  console.log(toJsonString(ReworkRunResponseSchema, result));
}

async function resumeRun() {
  const config = await loadConfig();
  const project = await currentProject(config);
  const runId = value("--run") ?? project.activeClaim?.runId;
  if (!runId) throw new Error("--run is required when there is no active claim");
  const executionRpc = createAuthenticatedWorkerExecutionClient(
    config.apiUrl,
    executionToken(project),
  );
  const result = await executionRpc.client.resumeRun({
    projectId: project.id,
    runId: decodeUuid(runId),
    requestId: decodeUuid(value("--request-id") ?? crypto.randomUUID()),
    checkpointKey: decodeWorkflowStageId(required("--checkpoint")),
    attempt: positiveIntegerFlag("--attempt"),
    revision: positiveIntegerFlag("--revision"),
  }, executionRpc.options);
  if (project.activeClaim?.runId === runId) {
    config.projects = config.projects.map((candidate) =>
      candidate.id === project.id
        ? { ...candidate, activeClaim: undefined }
        : candidate,
    );
    await saveConfig(config);
  }
  console.log(toJsonString(ResumeRunResponseSchema, result));
}

async function transitionWorkflowStage(action: "start" | "complete") {
  const config = await loadConfig();
  const project = await currentProject(config);
  const runId = value("--run") ?? project.activeClaim?.runId;
  if (!runId) throw new Error("--run is required when there is no active claim");
  const stage = decodeWorkflowStageId(required("--stage"));
  const requestId = decodeUuid(
    value("--request-id") ?? crypto.randomUUID(),
  );
  const positiveOption = (flag: "--attempt" | "--revision") => {
    const raw = value(flag);
    if (raw === undefined) return undefined;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error(`${flag} must be a positive integer`);
    }
    return parsed;
  };
  const executionRpc = createAuthenticatedWorkerExecutionClient(
    config.apiUrl,
    executionToken(project),
  );
  const result = await executionRpc.client.transitionWorkflowStage(
    {
      projectId: project.id,
      work: activeIssueWork(project, decodeUuid(runId)),
      requestId,
      stage,
      action: action === "start"
        ? TransitionWorkflowStageRequest_Action.START
        : TransitionWorkflowStageRequest_Action.COMPLETE,
      attempt: positiveOption("--attempt"),
      revision: positiveOption("--revision"),
    },
    executionRpc.options,
  );
  if (
    result.outcome === TransitionWorkflowStageResponse_Outcome.PAUSED &&
    project.activeClaim?.runId === runId
  ) {
    config.projects = config.projects.map((candidate) =>
      candidate.id === project.id
        ? { ...candidate, activeClaim: undefined }
        : candidate,
    );
    await saveConfig(config);
  }
  console.log(toJsonString(TransitionWorkflowStageResponseSchema, result));
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
