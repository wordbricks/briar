import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  AppendTranscriptEventsResponseSchema,
  ClaimIssueResponseSchema,
  ListProjectChannelMessagesResponseSchema,
  PrepareRunEvidenceImageUploadsResponseSchema,
  RecordRunEventResponseSchema,
  ReportIssueExecutionTelemetryResponseSchema,
  TransitionWorkflowStageResponse_Outcome,
  TransitionWorkflowStageResponseSchema,
  WorkerExecutionService,
  WorkflowStageLifecycleCheckpointSchema,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import {
  PreparedUploadSchema,
  UploadReferenceSchema,
} from "@briar/contracts/gen/briar/types/v1/upload_pb";
import { WorkflowCheckpoint_Position } from "@briar/contracts/gen/briar/types/v1/workflow_pb";
import {
  Code,
  ConnectError,
  type ConnectRouter,
  type ServiceImpl,
} from "@connectrpc/connect";
import {
  appChannelMessage,
  appChannelSummaryJson,
} from "./app-connect-channel-response-mappers";
import {
  appCancelRunResponse,
  appReworkRunResponse,
  appResumeRunResponse,
  appRetryRunResponse,
} from "./app-connect-issue-mappers";

import { HttpError } from "./http-response";
import { claimNextQueueWork } from "./queue-claim-routes";
import { decodeRequestSync } from "./request-schema";
import {
  recordRunEvidenceResponseMessage,
  runEvidenceResponseMessage,
} from "./run-evidence-connect";
import { evidenceImageJson } from "./run-evidence-json";
import {
  prepareRunEvidenceImageUploadsApplication,
  recordRunEvidenceApplication,
} from "./run-evidence-application";
import {
  prepareRunEvidenceImageUploadsApplicationRequest,
  recordRunEvidenceApplicationRequest,
  runEvidenceImageUploadIds,
} from "./run-evidence-request-mapper";
import { listRunEvidenceForProject } from "./run-evidence-routes";
import {
  listProjectAgentChannelMessagesApplication,
  ProjectAgentChannelApplicationError,
} from "./project-agent-channel-application";
import { decodeChannelMessageQuery } from "./query-contract";
import {
  scheduleProjectRealtimePublish,
} from "./realtime-scheduling";
import { UuidString } from "./schema-codecs";
import { workerIssueClaimMessage } from "./worker-connect-mappers";
import {
  appendTranscriptEventsApplication,
  reportIssueExecutionTelemetryApplication,
} from "./worker-transcript-application";
import {
  costObservation,
  executionMetrics,
  transcriptAgentProvider,
  transcriptEvent,
  transcriptWorkIdentity,
  usageObservation,
} from "./worker-transcript-mappers";
import {
  type AuthenticatedWorkerProject,
  requireAgentProject,
  requireWorkerProjectBinding,
} from "./worker-route-auth";
import {
  recordWorkerRunEventApplication,
  transitionWorkerWorkflowStageApplication,
  type WorkerRunExecutionPrincipal,
} from "./worker-run-execution-application";
import {
  recoverRunApplication,
  reworkRunApplication,
  resumeRunApplication,
} from "./run-control-application";
import {
  issueWorkIdentity,
  workerRunEvent,
  workerRunStatusMessage,
  workflowStageTransition,
} from "./worker-run-execution-mappers";
import {
  recoveryRunCommand,
  reworkRunCommand,
  resumeRunCommand,
} from "./worker-run-control-mappers";

export type IssueClaimAuthorization = {
  readonly projectId: string;
  readonly authenticatedWorker?: AuthenticatedWorkerProject;
};

export type WorkerConnectExecutionInput = {
  readonly request: Request;
  readonly db: D1Database;
  readonly env: Env;
  readonly context?: ExecutionContext;
  readonly archivesBucket: R2Bucket;
  readonly requireRunExecutionProject: (runId: string) => Promise<string>;
};

export type IssueClaimAuthServices = {
  readonly requireAgentProject: typeof requireAgentProject;
  readonly requireWorkerProjectBinding: typeof requireWorkerProjectBinding;
};

const issueClaimAuthServices: IssueClaimAuthServices = {
  requireAgentProject,
  requireWorkerProjectBinding,
};

export async function authorizeIssueClaim(
  input: { db: D1Database; request: Request; projectId: string },
  services: IssueClaimAuthServices = issueClaimAuthServices,
): Promise<IssueClaimAuthorization> {
  const authorization = input.request.headers.get("authorization") ?? "";
  if (authorization.startsWith("Bearer briar_worker_")) {
    return {
      projectId: input.projectId,
      authenticatedWorker: await services.requireWorkerProjectBinding(
        input.db,
        input.request,
        input.projectId,
      ),
    };
  }
  return {
    projectId: await services.requireAgentProject(input.db, input.request),
  };
}

export type WorkerExecutionServices = {
  readonly authorizeIssueClaim: typeof authorizeIssueClaim;
  readonly claimIssue: typeof claimNextQueueWork;
  readonly listProjectChannelMessages:
    typeof listProjectAgentChannelMessagesApplication;
  readonly listRunEvidence: typeof listRunEvidenceForProject;
  readonly requireWorkerProjectBinding: typeof requireWorkerProjectBinding;
  readonly appendTranscript: typeof appendTranscriptEventsApplication;
  readonly reportTelemetry: typeof reportIssueExecutionTelemetryApplication;
  readonly requireAgentProject: typeof requireAgentProject;
  readonly recordRunEvent: typeof recordWorkerRunEventApplication;
  readonly prepareRunEvidenceImages:
    typeof prepareRunEvidenceImageUploadsApplication;
  readonly recordRunEvidence: typeof recordRunEvidenceApplication;
  readonly transitionWorkflowStage:
    typeof transitionWorkerWorkflowStageApplication;
  readonly recoverRun: typeof recoverRunApplication;
  readonly resumeRun: typeof resumeRunApplication;
  readonly reworkRun: typeof reworkRunApplication;
};

const workerExecutionServices: WorkerExecutionServices = {
  authorizeIssueClaim,
  claimIssue: claimNextQueueWork,
  listProjectChannelMessages: listProjectAgentChannelMessagesApplication,
  listRunEvidence: listRunEvidenceForProject,
  requireWorkerProjectBinding,
  appendTranscript: appendTranscriptEventsApplication,
  reportTelemetry: reportIssueExecutionTelemetryApplication,
  requireAgentProject,
  recordRunEvent: recordWorkerRunEventApplication,
  prepareRunEvidenceImages: prepareRunEvidenceImageUploadsApplication,
  recordRunEvidence: recordRunEvidenceApplication,
  transitionWorkflowStage: transitionWorkerWorkflowStageApplication,
  recoverRun: recoverRunApplication,
  resumeRun: resumeRunApplication,
  reworkRun: reworkRunApplication,
};

const canonicalUuid = decodeRequestSync(UuidString);

const projectAgentChannelConnectError = (
  error: ProjectAgentChannelApplicationError,
): never => {
  switch (error.reason) {
    case "channel_not_found":
    case "thread_parent_not_found":
      throw new ConnectError(error.message, Code.NotFound, undefined, undefined, error);
    case "channel_forbidden":
      throw new ConnectError(
        error.message,
        Code.PermissionDenied,
        undefined,
        undefined,
        error,
      );
    case "cursor_invalid":
      throw new ConnectError(
        error.message,
        Code.InvalidArgument,
        undefined,
        undefined,
        error,
      );
  }
};

const claimedBy = (value: string) => {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 128) {
    throw new HttpError(400, "claimed_by must contain 1 to 128 characters");
  }
  return normalized;
};

const transcriptIdentity = (
  value: Parameters<typeof transcriptWorkIdentity>[0],
) => {
  const work = transcriptWorkIdentity(value);
  if (work.claimToken.length < 20 || work.claimToken.length > 256) {
    throw new HttpError(400, "work.claim_token must contain 20 to 256 characters");
  }
  return {
    ...work,
    workId: canonicalUuid(work.workId).toLowerCase(),
    runId: canonicalUuid(work.runId).toLowerCase(),
  };
};

const executionPrincipal = (
  authorization: IssueClaimAuthorization,
): WorkerRunExecutionPrincipal => authorization.authenticatedWorker
  ? { kind: "worker", worker: authorization.authenticatedWorker }
  : { kind: "agent" };

const workflowStageOutcome = (
  value: Awaited<
    ReturnType<typeof transitionWorkerWorkflowStageApplication>
  >["outcome"],
) => {
  switch (value) {
    case "started":
      return TransitionWorkflowStageResponse_Outcome.STARTED;
    case "completed":
      return TransitionWorkflowStageResponse_Outcome.COMPLETED;
    case "already_started":
      return TransitionWorkflowStageResponse_Outcome.ALREADY_STARTED;
    case "already_completed":
      return TransitionWorkflowStageResponse_Outcome.ALREADY_COMPLETED;
    case "paused":
      return TransitionWorkflowStageResponse_Outcome.PAUSED;
    case "not_found":
      throw new HttpError(500, "Stage transition returned a missing run");
  }
};

const checkpointPosition = (value: "before" | "after") =>
  value === "before"
    ? WorkflowCheckpoint_Position.BEFORE
    : WorkflowCheckpoint_Position.AFTER;

const requiredPositiveResult = (
  value: number | null,
  field: string,
) => {
  if (value === null || value < 1) {
    throw new HttpError(500, `Stage transition omitted ${field}`);
  }
  return value;
};

const scheduleRunMutation = (input: WorkerConnectExecutionInput, projectId: string) => {
  scheduleProjectRealtimePublish(
    input.env,
    input.db,
    projectId,
    input.context,
  );
};

const runControlActor = async (
  input: WorkerConnectExecutionInput,
  services: WorkerExecutionServices,
  projectId: string,
  runId: string,
) => {
  const authenticatedProjectId = await input.requireRunExecutionProject(runId);
  if (authenticatedProjectId !== projectId) {
    throw new HttpError(404, "Run not found");
  }
  const authorization = input.request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer briar_worker_")) {
    return "briar-workflow";
  }
  const worker = await services.requireWorkerProjectBinding(
    input.db,
    input.request,
    projectId,
  );
  return `briar-worker:${worker.binding.id}`;
};

export function createWorkerExecutionService(
  input: WorkerConnectExecutionInput,
  overrides: Partial<WorkerExecutionServices> = {},
): ServiceImpl<typeof WorkerExecutionService> {
  const services = { ...workerExecutionServices, ...overrides };
  return {
    claimIssue: async (request) => {
      const projectId = canonicalUuid(request.projectId).toLowerCase();
      const authorization = await services.authorizeIssueClaim({
        db: input.db,
        request: input.request,
        projectId,
      });
      if (authorization.projectId !== projectId) {
        throw new HttpError(404, "Project not found");
      }
      const issue = await services.claimIssue({
        db: input.db,
        env: input.env,
        projectId,
        runId: request.runId
          ? canonicalUuid(request.runId).toLowerCase()
          : undefined,
        claimedBy: claimedBy(request.claimedBy),
        authenticatedWorker: authorization.authenticatedWorker,
      });
      return create(ClaimIssueResponseSchema, {
        issue: issue ? workerIssueClaimMessage(issue) : undefined,
      });
    },
    listProjectChannelMessages: async (request, context) => {
      context.responseHeader.set("Cache-Control", "private, no-store");
      const projectId = canonicalUuid(request.projectId).toLowerCase();
      const authenticatedProjectId = await services.requireAgentProject(
        input.db,
        input.request,
      );
      if (authenticatedProjectId !== projectId) {
        throw new ConnectError(
          "Agent token is not valid for this project",
          Code.PermissionDenied,
        );
      }
      const query = decodeChannelMessageQuery({
        limit: request.limit,
        cursor: request.cursor ?? null,
        parentMessageId: request.parentMessageId ?? null,
      });
      try {
        const result = await services.listProjectChannelMessages({
          db: input.db,
          projectId,
          channelId: canonicalUuid(request.channelId).toLowerCase(),
          parentMessageId: query.parentMessageId?.toLowerCase() ?? null,
          cursor: query.cursor?.toLowerCase() ?? null,
          limit: query.limit,
        });
        return create(ListProjectChannelMessagesResponseSchema, {
          channel: appChannelSummaryJson(result.channel),
          messages: result.messages.map(appChannelMessage),
          nextCursor: result.nextCursor ?? undefined,
        });
      } catch (error) {
        if (error instanceof ProjectAgentChannelApplicationError) {
          return projectAgentChannelConnectError(error);
        }
        throw error;
      }
    },
    listRunEvidence: async (request) => {
      const authenticatedProjectId = await input.requireRunExecutionProject(
        request.runId,
      );
      if (authenticatedProjectId !== request.projectId) {
        throw new HttpError(404, "Run not found");
      }
      const result = await services.listRunEvidence({
        db: input.db,
        archivesBucket: input.archivesBucket,
        projectId: authenticatedProjectId,
        runId: request.runId,
      });
      return runEvidenceResponseMessage(result);
    },
    appendTranscriptEvents: async (request) => {
      const projectId = canonicalUuid(request.projectId).toLowerCase();
      const worker = await services.requireWorkerProjectBinding(
        input.db,
        input.request,
        projectId,
      );
      const result = await services.appendTranscript({
        db: input.db,
        archives: input.archivesBucket,
        projectId,
        worker,
        work: transcriptIdentity(request.work),
        sessionId: request.sessionId,
        agentProvider: transcriptAgentProvider(request.agentProvider),
        events: request.events.map(transcriptEvent),
      });
      return create(AppendTranscriptEventsResponseSchema, {
        sessionId: result.sessionId,
        archivedEventCount: result.stored,
        archivedUncompressedBytes: BigInt(result.storedBytes),
        archivedCompressedBytes: BigInt(result.compressedBytes),
        projectedEntryCount: result.projected,
      });
    },
    reportIssueExecutionTelemetry: async (request) => {
      const projectId = canonicalUuid(request.projectId).toLowerCase();
      const worker = await services.requireWorkerProjectBinding(
        input.db,
        input.request,
        projectId,
      );
      if (!request.executionId) {
        throw new HttpError(400, "execution_id is required");
      }
      if (!request.executionMetrics) {
        throw new HttpError(400, "execution_metrics is required");
      }
      const result = await services.reportTelemetry({
        db: input.db,
        projectId,
        worker,
        work: transcriptIdentity(request.work),
        executionId: canonicalUuid(request.executionId).toLowerCase(),
        agentProvider: transcriptAgentProvider(request.agentProvider),
        executionMetrics: executionMetrics(request.executionMetrics),
        usageObservations: request.usageObservations.map(usageObservation),
        costObservations: request.costObservations.map(costObservation),
      });
      return create(ReportIssueExecutionTelemetryResponseSchema, {
        executionMetricsUpdated: result.metricsUpdated,
        usageObservationsStored: result.usageStored,
        costObservationsStored: result.costStored,
      });
    },
    recordRunEvent: async (request) => {
      const projectId = canonicalUuid(request.projectId).toLowerCase();
      const principal = request.target.case === "sourceIdentity"
        ? await services.requireAgentProject(input.db, input.request)
            .then((authenticatedProjectId) => {
              if (authenticatedProjectId !== projectId) {
                throw new HttpError(404, "Project not found");
              }
              return { kind: "agent" } as const;
            })
        : executionPrincipal(await services.authorizeIssueClaim({
            db: input.db,
            request: input.request,
            projectId,
          }).then((authorization) => {
            if (authorization.projectId !== projectId) {
              throw new HttpError(404, "Project not found");
            }
            return authorization;
          }));
      const mapped = workerRunEvent(request);
      const result = await services.recordRunEvent({
        db: input.db,
        projectId,
        principal,
        ...mapped,
      });
      scheduleRunMutation(input, projectId);
      return create(RecordRunEventResponseSchema, {
        runId: result.runId,
        status: workerRunStatusMessage(result.status),
        workflowStage: result.workflowStage ?? undefined,
      });
    },
    prepareRunEvidenceImageUploads: async (request, context) => {
      context.responseHeader.set("Cache-Control", "private, no-store");
      const mapped = prepareRunEvidenceImageUploadsApplicationRequest(request);
      const authorization = await services.authorizeIssueClaim({
        db: input.db,
        request: input.request,
        projectId: mapped.projectId,
      });
      if (authorization.projectId !== mapped.projectId) {
        throw new HttpError(404, "Project not found");
      }
      const result = await services.prepareRunEvidenceImages({
        db: input.db,
        env: input.env,
        context: input.context,
        projectId: mapped.projectId,
        principal: executionPrincipal(authorization),
        work: mapped.work,
        requestId: mapped.requestId,
        images: mapped.images,
      });
      return create(PrepareRunEvidenceImageUploadsResponseSchema, {
        replayed: result.replayed,
        uploads: result.uploads.map((upload) => create(PreparedUploadSchema, {
          clientId: upload.clientId,
          reference: create(UploadReferenceSchema, {
            uploadId: upload.uploadId,
          }),
          uploadUrl: new URL(
            `/uploads/${encodeURIComponent(upload.uploadId)}`,
            input.request.url,
          ).toString(),
          uploadCapability: upload.uploadCapability,
          expiresAt: timestampFromDate(new Date(upload.expiresAt)),
        })),
      });
    },
    recordRunEvidence: async (request) => {
      const projectId = canonicalUuid(request.projectId).toLowerCase();
      const authorization = await services.authorizeIssueClaim({
        db: input.db,
        request: input.request,
        projectId,
      });
      if (authorization.projectId !== projectId) {
        throw new HttpError(404, "Project not found");
      }
      const work = issueWorkIdentity(request.work);
      const result = await services.recordRunEvidence({
        db: input.db,
        projectId,
        principal: executionPrincipal(authorization),
        work,
        evidence: recordRunEvidenceApplicationRequest(request),
        imageUploadIds: runEvidenceImageUploadIds(request),
      });
      scheduleRunMutation(input, projectId);
      return recordRunEvidenceResponseMessage({
        runId: result.evidence.run_id,
        attempt: result.evidence.attempt,
        evidenceKey: result.evidence.evidence_key,
        stage: result.evidence.workflow_stage,
        type: result.evidence.evidence_type,
        status: result.evidence.status,
        images: result.images.map(evidenceImageJson),
      });
    },
    transitionWorkflowStage: async (request) => {
      const projectId = canonicalUuid(request.projectId).toLowerCase();
      const authorization = await services.authorizeIssueClaim({
        db: input.db,
        request: input.request,
        projectId,
      });
      if (authorization.projectId !== projectId) {
        throw new HttpError(404, "Project not found");
      }
      const transition = workflowStageTransition(request);
      const principal = executionPrincipal(authorization);
      const result = await services.transitionWorkflowStage({
        db: input.db,
        projectId,
        principal,
        transition,
        actor: principal.kind === "worker"
          ? `briar-worker:${principal.worker.binding.id}`
          : "briar-workflow",
      });
      scheduleRunMutation(input, projectId);
      return create(TransitionWorkflowStageResponseSchema, {
        runId: transition.work.runId,
        requestId: transition.requestId,
        outcome: workflowStageOutcome(result.outcome),
        attempt: requiredPositiveResult(result.attempt, "attempt"),
        revision: requiredPositiveResult(result.revision, "revision"),
        stage: result.stage,
        checkpoint: result.checkpoint
          ? create(WorkflowStageLifecycleCheckpointSchema, {
              key: result.checkpoint.key,
              stage: result.checkpoint.stage,
              position: checkpointPosition(result.checkpoint.position),
              revision: result.checkpoint.revision,
            })
          : undefined,
      });
    },
    retryRun: async (request) => {
      const command = recoveryRunCommand(request);
      const actor = await runControlActor(
        input,
        services,
        command.projectId,
        command.runId,
      );
      const result = await services.recoverRun({
        db: input.db,
        ...command,
        action: "retry",
        actor,
      });
      scheduleRunMutation(input, command.projectId);
      return appRetryRunResponse(result);
    },
    cancelRun: async (request) => {
      const command = recoveryRunCommand(request);
      const actor = await runControlActor(
        input,
        services,
        command.projectId,
        command.runId,
      );
      const result = await services.recoverRun({
        db: input.db,
        ...command,
        action: "cancel",
        actor,
      });
      scheduleRunMutation(input, command.projectId);
      return appCancelRunResponse(result);
    },
    resumeRun: async (request) => {
      const command = resumeRunCommand(request);
      const actor = await runControlActor(
        input,
        services,
        command.projectId,
        command.runId,
      );
      const result = await services.resumeRun({
        db: input.db,
        ...command,
        actor,
      });
      scheduleRunMutation(input, command.projectId);
      return appResumeRunResponse(result);
    },
    reworkRun: async (request) => {
      const command = reworkRunCommand(request);
      const actor = await runControlActor(
        input,
        services,
        command.projectId,
        command.runId,
      );
      const result = await services.reworkRun({
        db: input.db,
        ...command,
        actor,
      });
      scheduleRunMutation(input, command.projectId);
      return appReworkRunResponse(result);
    },
  };
}

export function registerWorkerExecutionService(
  router: ConnectRouter,
  input: WorkerConnectExecutionInput,
) {
  router.service(WorkerExecutionService, createWorkerExecutionService(input));
}
