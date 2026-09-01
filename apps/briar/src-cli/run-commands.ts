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
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  CancelRunResponseSchema,
  CreateIssueResponseSchema,
  UpdateIssueResponseSchema,
  type UpdateIssueResponse,
  IssueService,
  ListRunEvidenceResponseSchema,
  RunEvidence_Status,
  ReworkRunResponseSchema,
  ResumeRunResponseSchema,
  RetryRunResponseSchema,
  SetIssueDependencyResponseSchema,
} from "@briar/contracts/gen/briar/app/v1/issue_pb";
import { IssueDifficulty, RunStatus } from "@briar/contracts/gen/briar/app/v1/common_pb";
import { DashboardService } from "@briar/contracts/gen/briar/app/v1/dashboard_pb";
import { ProjectService } from "@briar/contracts/gen/briar/app/v1/project_pb";
import {
  RecordRunEvidenceRequestSchema,
  RecordRunEvidenceResponseSchema,
  RecordRunEventResponseSchema,
  ListProjectChannelMessagesResponseSchema,
  RunSourceIdentitySchema,
  TransitionWorkflowStageRequest_Action,
  TransitionWorkflowStageResponse_Outcome,
  TransitionWorkflowStageResponseSchema,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import type {
  GitHubPullRequestIdentity,
} from "@briar/contracts/gen/briar/types/v1/github_identity_pb";
import { validateEvidenceImages } from "../src/lib/evidence-images";
import {
  briarIssueUrl,
  ensureBriarIssueLinkInGithubPullRequest,
} from "./github-pr";
import {
  decodeCreateIssueInput,
  decodeIssueUpdateChanges,
  decodeUuid,
  decodeWorkflowStageId,
} from "./command-contract";
import type { Config, ProjectConfig } from "./config-contract";
import {
  executionToken,
  values,
  value,
  has,
  required,
  loadConfig,
  saveConfig,
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
import { createAuthenticatedConnectClient } from "./connect-client";
import { decodeRunStructuredResult } from "./run-structured-result";
import { uploadPreparedFiles } from "../src/lib/upload-client";

async function optionalText(valueFlag: string, fileFlag: string) {
  const path = value(fileFlag);
  if (path) return readFile(resolve(path), "utf8");
  return value(valueFlag) ?? null;
}

export async function resolveIssueCreationProjectId(input: {
  configuredProjectId?: string;
  loadProjects: () => Promise<Array<{ id: string; isDefault: boolean }>>;
}) {
  const projects = await input.loadProjects();
  if (
    input.configuredProjectId &&
    !projects.some((candidate) => candidate.id === input.configuredProjectId)
  ) {
    throw new Error("선택한 Project가 현재 Team에 속하지 않습니다.");
  }
  const projectId = input.configuredProjectId ??
    projects.find((candidate) => candidate.isDefault)?.id ??
    (projects.length === 1 ? projects[0]?.id : undefined);
  if (!projectId) {
    throw new Error("--project <id>를 지정하거나 Team의 기본 Project를 설정하세요.");
  }
  return projectId;
}

const jsonObject = (value: string, label: string): JsonObject => {
  const parsed: unknown = JSON.parse(value);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as JsonObject;
};

const runEvidenceStatus = (value: string): RunEvidence_Status => {
  switch (value) {
    case "pending":
      return RunEvidence_Status.PENDING;
    case "passed":
      return RunEvidence_Status.PASSED;
    case "failed":
      return RunEvidence_Status.FAILED;
    case "skipped":
      return RunEvidence_Status.SKIPPED;
    default:
      throw new Error(
        "--status must be one of: pending, passed, failed, skipped",
      );
  }
};

const evidenceTimestamp = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("--observed-at must be an ISO date-time");
  }
  return timestampFromDate(date);
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
  const projectClient = createAuthenticatedConnectClient(
    ProjectService,
    config.apiUrl,
    config.userToken,
  );
  const planningProjectId = await resolveIssueCreationProjectId({
    configuredProjectId: value("--project")?.trim(),
    loadProjects: async () =>
      (await projectClient.listTeamPlanningProjects({ teamId: project.id })).projects,
  });
  const priorityValue = value("--priority");
  const input = decodeCreateIssueInput({
    title: required("--title"),
    description: await optionalText("--description", "--description-file"),
    priority: priorityValue === undefined ? null : Number(priorityValue),
    status: value("--status") ?? "queued",
  });
  const result = await createAuthenticatedConnectClient(
    IssueService,
    config.apiUrl,
    config.userToken,
  ).createIssue(
    {
      projectId: planningProjectId,
      title: input.title,
      description: input.description ?? undefined,
      priority: input.priority ?? undefined,
      status: input.status === "backlog"
        ? RunStatus.BACKLOG
        : RunStatus.QUEUED,
    },
  );
  console.log(toJsonString(CreateIssueResponseSchema, result));
}

export type IssueUpdateCommandInput = {
  runId: string;
  title?: string;
  description?: string;
  descriptionFile?: string;
  clearDescription: boolean;
  priority?: number;
  clearPriority: boolean;
  difficulty?: string;
  clearDifficulty: boolean;
  assigneeUserId?: string;
  clearAssignee: boolean;
};

type IssueUpdateState = {
  title: string;
  description: string | null;
  priority: number | null;
  difficulty: "easy" | "normal" | "hard" | null;
  assigneeUserId: string | null;
};

export type IssueUpdateCommandDependencies = {
  loadConfig: () => Promise<Config>;
  currentProject: (config: Config) => Promise<ProjectConfig>;
  loadRun: (config: Config, project: ProjectConfig, runId: string) => Promise<IssueUpdateState | undefined>;
  updateRun: (
    config: Config,
    project: ProjectConfig,
    runId: string,
    input: IssueUpdateState,
  ) => Promise<UpdateIssueResponse>;
  readFile: (path: string, encoding: "utf8") => Promise<string>;
  writeLine: (line: string) => void;
};

const difficultyFromProto = (value: IssueDifficulty) => {
  switch (value) {
    case IssueDifficulty.EASY: return "easy" as const;
    case IssueDifficulty.NORMAL: return "normal" as const;
    case IssueDifficulty.HARD: return "hard" as const;
    default: return null;
  }
};

const difficultyToProto = (value: IssueUpdateState["difficulty"]) => {
  switch (value) {
    case "easy": return IssueDifficulty.EASY;
    case "normal": return IssueDifficulty.NORMAL;
    case "hard": return IssueDifficulty.HARD;
    case null: return undefined;
  }
};

const defaultIssueUpdateCommandDependencies: IssueUpdateCommandDependencies = {
  loadConfig,
  currentProject,
  loadRun: async (config, project, runId) => {
    if (!config.userToken) return undefined;
    const response = await createAuthenticatedConnectClient(
      DashboardService,
      config.apiUrl,
      config.userToken,
    ).getDashboard({ projectId: project.id });
    const run = response.runs.find((candidate) => candidate.id === runId);
    return run && {
      title: run.title,
      description: run.issueDescription ?? null,
      priority: run.priority ?? null,
      difficulty: difficultyFromProto(run.difficulty ?? IssueDifficulty.UNSPECIFIED),
      assigneeUserId: run.assigneeUserId ?? null,
    };
  },
  updateRun: async (config, project, runId, input) => {
    if (!config.userToken) throw new Error("먼저 `briar login`을 실행하세요.");
    return createAuthenticatedConnectClient(
      IssueService,
      config.apiUrl,
      config.userToken,
    ).updateIssue({
      projectId: project.id,
      runId,
      title: input.title,
      description: input.description ?? undefined,
      priority: input.priority ?? undefined,
      difficulty: difficultyToProto(input.difficulty),
      assigneeUpdate: input.assigneeUserId === null
        ? { case: "clearAssignee", value: {} }
        : { case: "assigneeUserId", value: input.assigneeUserId },
      requestId: crypto.randomUUID(),
      attachments: [],
    });
  },
  readFile,
  writeLine: (line) => console.log(line),
};

function assertExclusiveIssueUpdateFlags(
  selected: boolean,
  cleared: boolean,
  selectedFlags: string,
  clearFlag: string,
) {
  if (selected && cleared) {
    throw new Error(`${selectedFlags} cannot be combined with ${clearFlag}`);
  }
}

async function updateIssueCommand(
  command: IssueUpdateCommandInput,
  dependencies: IssueUpdateCommandDependencies = defaultIssueUpdateCommandDependencies,
) {
  const runId = decodeUuid(command.runId);
  if (command.description !== undefined && command.descriptionFile !== undefined) {
    throw new Error("Use only one of --description and --description-file");
  }
  assertExclusiveIssueUpdateFlags(
    command.description !== undefined || command.descriptionFile !== undefined,
    command.clearDescription,
    "--description or --description-file",
    "--clear-description",
  );
  assertExclusiveIssueUpdateFlags(command.priority !== undefined, command.clearPriority, "--priority", "--clear-priority");
  assertExclusiveIssueUpdateFlags(command.difficulty !== undefined, command.clearDifficulty, "--difficulty", "--clear-difficulty");
  assertExclusiveIssueUpdateFlags(command.assigneeUserId !== undefined, command.clearAssignee, "--assignee-user-id", "--clear-assignee");

  const changes = decodeIssueUpdateChanges({
    ...(command.title === undefined ? undefined : { title: command.title }),
    ...(command.clearDescription
      ? { description: null }
      : command.descriptionFile !== undefined
      ? { description: await dependencies.readFile(resolve(command.descriptionFile), "utf8") }
      : command.description === undefined ? undefined : { description: command.description }),
    ...(command.clearPriority ? { priority: null } : command.priority === undefined ? undefined : { priority: command.priority }),
    ...(command.clearDifficulty ? { difficulty: null } : command.difficulty === undefined ? undefined : { difficulty: command.difficulty }),
    ...(command.clearAssignee ? { assigneeUserId: null } : command.assigneeUserId === undefined ? undefined : { assigneeUserId: command.assigneeUserId }),
  });
  const config = await dependencies.loadConfig();
  if (!config.userToken) throw new Error("먼저 `briar login`을 실행하세요.");
  const project = await dependencies.currentProject(config);
  const current = await dependencies.loadRun(config, project, runId);
  if (!current) throw new Error(`이슈를 찾지 못했습니다: ${runId}`);
  const result = await dependencies.updateRun(config, project, runId, {
    title: changes.title ?? current.title,
    description: changes.description === undefined ? current.description : changes.description,
    priority: changes.priority === undefined ? current.priority : changes.priority,
    difficulty: changes.difficulty === undefined ? current.difficulty : changes.difficulty,
    assigneeUserId: changes.assigneeUserId === undefined ? current.assigneeUserId : changes.assigneeUserId,
  });
  dependencies.writeLine(toJsonString(UpdateIssueResponseSchema, result));
}

async function changeIssueDependencyCommand(action: "add" | "remove") {
  const config = await loadConfig();
  if (!config.userToken) throw new Error("먼저 `briar login`을 실행하세요.");
  const project = await currentProject(config);
  const dependentRunId = decodeUuid(required("--dependent-run"));
  const prerequisiteRunId = decodeUuid(required("--prerequisite-run"));
  const result = await createAuthenticatedConnectClient(
    IssueService,
    config.apiUrl,
    config.userToken,
  ).setIssueDependency(
    {
      projectId: project.id,
      runId: dependentRunId,
      prerequisiteRunId,
      enabled: action === "add",
    },
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
  const limit = value("--limit") === undefined ? 50 : Number(value("--limit"));
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("--limit must be an integer from 1 to 100");
  }
  const cursor = value("--cursor");
  const parentMessageId = value("--parent-message-id");
  const executionRpc = createAuthenticatedWorkerExecutionClient(
    config.apiUrl,
    executionToken(project),
  );
  const result = await executionRpc.listProjectChannelMessages({
    projectId: decodeUuid(project.id).toLowerCase(),
    channelId: decodeUuid(required("--channel-id")).toLowerCase(),
    cursor: cursor ? decodeUuid(cursor).toLowerCase() : undefined,
    parentMessageId: parentMessageId
      ? decodeUuid(parentMessageId).toLowerCase()
      : undefined,
    limit,
  });
  console.log(toJsonString(ListProjectChannelMessagesResponseSchema, result));
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
  const structuredResult = decodeRunStructuredResult({
    domainJson: structuredResultValue,
    protoJson: value("--structured-result-proto-json") ?? null,
  });
  const runIdValue = value("--run") ?? project.activeClaim?.runId ?? null;
  const runId = runIdValue ? decodeUuid(runIdValue).toLowerCase() : null;
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
    context: contextValue ? jsonObject(contextValue, "Run context") : null,
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
  const result = await executionRpc.recordRunEvent(
    workerRunEventRequest({
      projectId: project.id,
      target,
      event: input,
    }),
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
  const work = activeIssueWork(project, runId);
  const metadataValue = value("--metadata-json");
  const status = runEvidenceStatus(required("--status"));
  const type = required("--type").trim();
  const url = value("--url");
  let metadata = metadataValue
    ? jsonObject(metadataValue, "Evidence metadata")
    : undefined;
  let githubPullRequest: GitHubPullRequestIdentity | undefined;
  if (
    type === "pull_request" &&
    url &&
    (status === RunEvidence_Status.PASSED ||
      status === RunEvidence_Status.PENDING)
  ) {
    const github = await ensureBriarIssueLinkInGithubPullRequest({
      apiUrl: config.apiUrl,
      projectId: project.id,
      token: executionToken(project),
      pullRequestUrl: url,
      issueUrl: briarIssueUrl(config.apiUrl, project.id, runId),
    });
    githubPullRequest = github.identity;
  }
  const executionRpc = createAuthenticatedWorkerExecutionClient(
    config.apiUrl,
    executionToken(project),
  );
  const imagePaths = values("--image").map((path) => resolve(path));
  const images = await Promise.all(
    imagePaths.map(async (path, index) => {
      const image = Bun.file(path);
      if (!(await image.exists())) {
        throw new Error(`Evidence image does not exist: ${path}`);
      }
      const name = basename(path);
      return {
        clientId: `image-${index}`,
        file: new File([image], name, { type: image.type }),
      };
    }),
  );
  const imageError = validateEvidenceImages(
    images.map(({ file }) => ({
      name: file.name,
      size: file.size,
      type: file.type,
    })),
  );
  if (imageError) throw new Error(imageError);
  const uploadIds = images.length === 0
    ? []
    : await executionRpc.prepareRunEvidenceImageUploads({
        requestId: crypto.randomUUID(),
        projectId: project.id,
        work,
        images: await Promise.all(images.map(async ({ clientId, file }) => ({
          clientId,
          filename: file.name,
          contentType: file.type,
          byteSize: BigInt(file.size),
          sha256: new Uint8Array(
            await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
          ),
        }))),
      }).then((prepared) => uploadPreparedFiles({
        apiUrl: config.apiUrl,
        files: images,
        uploads: prepared.uploads,
        uploadId: (upload) => upload.reference?.uploadId,
      }));
  const result = await executionRpc.recordRunEvidence(create(
    RecordRunEvidenceRequestSchema,
    {
      projectId: project.id,
      work,
      evidenceKey: required("--key"),
      stage: required("--stage"),
      type,
      status,
      observedAt: evidenceTimestamp(
        value("--observed-at") ?? new Date().toISOString(),
      ),
      actor: value("--actor") ?? "briar-workflow",
      detail: (await optionalText("--detail", "--detail-file")) ?? undefined,
      command: value("--command"),
      url,
      metadata,
      githubPullRequest,
      images: uploadIds.map((uploadId) => ({ uploadId })),
    },
  ));
  console.log(toJsonString(RecordRunEvidenceResponseSchema, result));
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
  const result = await executionRpc.listRunEvidence({
    projectId: project.id,
    runId,
  });
  console.log(toJsonString(ListRunEvidenceResponseSchema, result));
}

async function recoverRun(action: "retry" | "cancel") {
  const config = await loadConfig();
  const project = await currentProject(config);
  const runId = value("--run") ?? project.activeClaim?.runId;
  if (!runId) throw new Error("--run is required when there is no active claim");
  const canonicalRunId = decodeUuid(runId).toLowerCase();
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
    ? await executionRpc.retryRun(input)
    : await executionRpc.cancelRun(input);
  if (project.activeClaim?.runId === canonicalRunId) {
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
  const canonicalRunId = decodeUuid(runId).toLowerCase();
  const executionRpc = createAuthenticatedWorkerExecutionClient(
    config.apiUrl,
    executionToken(project),
  );
  const result = await executionRpc.reworkRun({
    projectId: project.id,
    runId: canonicalRunId,
    requestId: decodeUuid(value("--request-id") ?? crypto.randomUUID()),
    workflowStage: decodeWorkflowStageId(required("--to")),
    reason: required("--reason"),
  });
  if (project.activeClaim?.runId === canonicalRunId) {
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
  const canonicalRunId = decodeUuid(runId).toLowerCase();
  const executionRpc = createAuthenticatedWorkerExecutionClient(
    config.apiUrl,
    executionToken(project),
  );
  const result = await executionRpc.resumeRun({
    projectId: project.id,
    runId: canonicalRunId,
    requestId: decodeUuid(value("--request-id") ?? crypto.randomUUID()),
    checkpointKey: decodeWorkflowStageId(required("--checkpoint")),
    attempt: positiveIntegerFlag("--attempt"),
    revision: positiveIntegerFlag("--revision"),
  });
  if (project.activeClaim?.runId === canonicalRunId) {
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
  const canonicalRunId = decodeUuid(runId).toLowerCase();
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
  const result = await executionRpc.transitionWorkflowStage(
    {
      projectId: project.id,
      work: activeIssueWork(project, canonicalRunId),
      requestId,
      stage,
      action: action === "start"
        ? TransitionWorkflowStageRequest_Action.START
        : TransitionWorkflowStageRequest_Action.COMPLETE,
      attempt: positiveOption("--attempt"),
      revision: positiveOption("--revision"),
    },
  );
  if (
    result.outcome === TransitionWorkflowStageResponse_Outcome.PAUSED &&
    project.activeClaim?.runId === canonicalRunId
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
  updateIssueCommand,
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
