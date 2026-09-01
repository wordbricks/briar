import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  RunStatus,
  type StructuredRunResult,
  StructuredRunResult_Impact,
  StructuredRunResult_Importance,
  StructuredRunResult_Outcome,
  StructuredRunResult_Urgency,
} from "@briar/contracts/gen/briar/app/v1/common_pb";
import {
  AutoHuntSource,
  type RecordRunEventRequest,
  type TransitionWorkflowStageRequest,
  TransitionWorkflowStageRequest_Action,
  type WorkClaimIdentity,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { StructuredAgentResult } from "../../src/lib/agent-result";
import type {
  AutoHuntPersistedRunStatus,
  AutoHuntSource as DomainAutoHuntSource,
  AutoHuntWorkflowStageId,
} from "../../src/lib/auto-hunt-contract";
import { HttpError } from "./http-response";
import { decodeRequestSync } from "./request-schema";
import { UuidString } from "./schema-codecs";
import type {
  IssueWorkIdentity,
  WorkerRunEvent,
  WorkerRunEventTarget,
  WorkflowStageTransition,
} from "./worker-run-execution-application";

const canonicalUuid = decodeRequestSync(UuidString);
const decodeStructuredResult = decodeRequestSync(StructuredAgentResult);

const requiredText = (value: string, field: string, maximum: number) => {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new HttpError(
      400,
      `${field} must contain 1 to ${maximum} characters`,
    );
  }
  return normalized;
};

const optionalText = (
  value: string | undefined,
  field: string,
  maximum: number,
) => value === undefined ? null : requiredText(value, field, maximum);

const optionalString = (
  value: string | undefined,
  field: string,
  maximum: number,
) => {
  if (value !== undefined && value.length > maximum) {
    throw new HttpError(400, `${field} must contain at most ${maximum} characters`);
  }
  return value ?? null;
};

const isoTimestamp = (
  value: Parameters<typeof timestampDate>[0] | undefined,
  field: string,
) => {
  if (value === undefined) throw new HttpError(400, `${field} is required`);
  const date = timestampDate(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `${field} is invalid`);
  }
  return date.toISOString();
};

const optionalIsoTimestamp = (
  value: Parameters<typeof timestampDate>[0] | undefined,
  field: string,
) => value === undefined ? null : isoTimestamp(value, field);

const httpsUrl = (value: string, field: string) => {
  if (value.length > 1_000) {
    throw new HttpError(400, `${field} must contain at most 1000 characters`);
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error("HTTPS required");
    return url.toString();
  } catch {
    throw new HttpError(400, `${field} must be a valid HTTPS URL`);
  }
};

const runStatus = (
  value: RunStatus,
): AutoHuntPersistedRunStatus => {
  switch (value) {
    case RunStatus.BACKLOG:
      return "backlog";
    case RunStatus.QUEUED:
      return "queued";
    case RunStatus.RUNNING:
      return "running";
    case RunStatus.BLOCKED:
      return "blocked";
    case RunStatus.FAILED:
      return "failed";
    case RunStatus.COMPLETED:
      return "completed";
    case RunStatus.CANCELLED:
      return "cancelled";
    case RunStatus.UNSPECIFIED:
    default:
      throw new HttpError(400, "status is required");
  }
};

export const workerRunStatusMessage = (
  value: AutoHuntPersistedRunStatus,
): RunStatus => {
  switch (value) {
    case "backlog":
      return RunStatus.BACKLOG;
    case "queued":
      return RunStatus.QUEUED;
    case "running":
      return RunStatus.RUNNING;
    case "blocked":
      return RunStatus.BLOCKED;
    case "failed":
      return RunStatus.FAILED;
    case "completed":
      return RunStatus.COMPLETED;
    case "cancelled":
      return RunStatus.CANCELLED;
  }
};

const autoHuntSource = (value: AutoHuntSource): DomainAutoHuntSource => {
  switch (value) {
    case AutoHuntSource.ISSUE:
      return "issue";
    case AutoHuntSource.ERROR:
      return "error";
    case AutoHuntSource.FEEDBACK:
      return "feedback";
    case AutoHuntSource.UNSPECIFIED:
    default:
      throw new HttpError(400, "source is required");
  }
};

const structuredOutcome = (value: StructuredRunResult_Outcome) => {
  switch (value) {
    case StructuredRunResult_Outcome.COMPLETED:
      return "completed" as const;
    case StructuredRunResult_Outcome.PARTIAL:
      return "partial" as const;
    case StructuredRunResult_Outcome.BLOCKED:
      return "blocked" as const;
    case StructuredRunResult_Outcome.FAILED:
      return "failed" as const;
    case StructuredRunResult_Outcome.UNSPECIFIED:
    default:
      throw new HttpError(400, "structured_result.outcome is required");
  }
};

const structuredImportance = (value: StructuredRunResult_Importance) => {
  switch (value) {
    case StructuredRunResult_Importance.ROUTINE:
      return "routine" as const;
    case StructuredRunResult_Importance.IMPORTANT:
      return "important" as const;
    case StructuredRunResult_Importance.CRITICAL:
      return "critical" as const;
    case StructuredRunResult_Importance.UNSPECIFIED:
    default:
      throw new HttpError(400, "structured_result.importance is required");
  }
};

const structuredUrgency = (value: StructuredRunResult_Urgency) => {
  switch (value) {
    case StructuredRunResult_Urgency.NORMAL:
      return "normal" as const;
    case StructuredRunResult_Urgency.TIME_SENSITIVE:
      return "time_sensitive" as const;
    case StructuredRunResult_Urgency.IMMEDIATE:
      return "immediate" as const;
    case StructuredRunResult_Urgency.UNSPECIFIED:
    default:
      throw new HttpError(400, "structured_result.urgency is required");
  }
};

const structuredImpact = (value: StructuredRunResult_Impact) => {
  switch (value) {
    case StructuredRunResult_Impact.ISSUE:
      return "issue" as const;
    case StructuredRunResult_Impact.PROJECT:
      return "project" as const;
    case StructuredRunResult_Impact.ORGANIZATION:
      return "organization" as const;
    case StructuredRunResult_Impact.UNSPECIFIED:
    default:
      throw new HttpError(400, "structured_result.impact is required");
  }
};

const structuredResult = (value: StructuredRunResult | undefined) =>
  value === undefined
    ? null
    : decodeStructuredResult({
        summary: value.summary,
        outcome: structuredOutcome(value.outcome),
        importance: structuredImportance(value.importance),
        urgency: structuredUrgency(value.urgency),
        impact: structuredImpact(value.impact),
        humanActionRequired: value.humanActionRequired,
        nextAction: value.nextAction ?? null,
        dueAt: optionalIsoTimestamp(value.dueAt, "structured_result.due_at"),
      });

export const issueWorkIdentity = (
  value: WorkClaimIdentity | undefined,
): IssueWorkIdentity => {
  if (value?.work.case !== "issue") {
    throw new HttpError(400, "Issue work identity is required");
  }
  const workId = canonicalUuid(value.workId).toLowerCase();
  const runId = canonicalUuid(value.runId).toLowerCase();
  if (workId !== runId) {
    throw new HttpError(400, "Issue work_id must match run_id");
  }
  if (
    !value.claimToken.startsWith("briar_claim_") ||
    value.claimToken.length > 256
  ) {
    throw new HttpError(400, "Issue claim_token is invalid");
  }
  return { workId, runId, claimToken: value.claimToken };
};

const workflowStage = (
  value: string,
  field: string,
): AutoHuntWorkflowStageId => {
  const normalized = value.trim();
  if (!/^[a-z][a-z0-9_-]{0,63}$/u.test(normalized)) {
    throw new HttpError(400, `${field} is invalid`);
  }
  return normalized as AutoHuntWorkflowStageId;
};

const optionalWorkflowStage = (value: string | undefined) =>
  value === undefined ? null : workflowStage(value, "workflow_stage");

const runEventTarget = (
  request: RecordRunEventRequest,
): WorkerRunEventTarget => {
  switch (request.target.case) {
    case "work":
      return { kind: "work", work: issueWorkIdentity(request.target.value) };
    case "sourceIdentity":
      return {
        kind: "sourceIdentity",
        source: autoHuntSource(request.target.value.source),
        sourceKey: requiredText(
          request.target.value.sourceKey,
          "source_identity.source_key",
          200,
        ),
        title: requiredText(
          request.target.value.title,
          "source_identity.title",
          300,
        ),
      };
    case undefined:
      throw new HttpError(400, "Run event target is required");
  }
};

const tracker = (value: RecordRunEventRequest["tracker"]) => {
  if (value === undefined) return null;
  const url = value.url === undefined
    ? null
    : httpsUrl(value.url, "tracker.url");
  if (value.provider.trim() === "linear" && url && new URL(url).hostname !== "linear.app") {
    throw new HttpError(400, "Linear tracker URLs must use linear.app");
  }
  return {
    provider: requiredText(value.provider, "tracker.provider", 50),
    issueId: optionalText(value.issueId, "tracker.issue_id", 200),
    identifier: optionalText(value.identifier, "tracker.identifier", 100),
    url,
    state: optionalText(value.state, "tracker.state", 100),
  };
};

const commitSha = (value: string | undefined, field: string) => {
  if (value === undefined) return null;
  if (!/^[0-9a-f]{7,64}$/u.test(value)) {
    throw new HttpError(400, `${field} is invalid`);
  }
  return value;
};

export const workerRunEvent = (
  request: RecordRunEventRequest,
) => {
  if (request.pullRequestUrls.length > 20) {
    throw new HttpError(400, "pull_request_urls must contain at most 20 URLs");
  }
  if (
    request.priority !== undefined &&
    (request.priority < 1 || request.priority > 4)
  ) {
    throw new HttpError(400, "priority must be between 1 and 4");
  }
  return {
    target: runEventTarget(request),
    event: {
      status: runStatus(request.status),
      workflowStage: optionalWorkflowStage(request.workflowStage),
      eventKey: requiredText(request.eventKey, "event_key", 300),
      occurredAt: isoTimestamp(request.occurredAt, "occurred_at"),
      actor: requiredText(request.actor, "actor", 128),
      repository: requiredText(request.repository, "repository", 500),
      detail: optionalString(request.detail, "detail", 4_000),
      priority: request.priority ?? null,
      branch: optionalText(request.branch, "branch", 500),
      commitSha: commitSha(request.commitSha, "commit_sha"),
      tracker: tracker(request.tracker),
      issueDescription: optionalString(
        request.issueDescription,
        "issue_description",
        100_000,
      ),
      resultSummary: optionalString(
        request.resultSummary,
        "result_summary",
        100_000,
      ),
      structuredResult: structuredResult(request.structuredResult),
      pullRequestUrls: [...new Set(request.pullRequestUrls.map((value, index) =>
        httpsUrl(value, `pull_request_urls[${index}]`)
      ))].sort(),
      targetSha: commitSha(request.targetSha, "target_sha"),
      sourceCreatedAt: optionalIsoTimestamp(
        request.sourceCreatedAt,
        "source_created_at",
      ),
      context: request.context ?? null,
    },
  } satisfies { target: WorkerRunEventTarget; event: WorkerRunEvent };
};

const positiveUint32 = (value: number | undefined, field: string) => {
  if (value !== undefined && value < 1) {
    throw new HttpError(400, `${field} must be positive`);
  }
  return value;
};

export const workflowStageTransition = (
  request: TransitionWorkflowStageRequest,
): WorkflowStageTransition => {
  const action = request.action === TransitionWorkflowStageRequest_Action.START
    ? "start"
    : request.action === TransitionWorkflowStageRequest_Action.COMPLETE
      ? "complete"
      : null;
  if (!action) throw new HttpError(400, "action is required");
  return {
    work: issueWorkIdentity(request.work),
    requestId: canonicalUuid(request.requestId).toLowerCase(),
    stage: workflowStage(request.stage, "stage"),
    action,
    attempt: positiveUint32(request.attempt, "attempt"),
    revision: positiveUint32(request.revision, "revision"),
  };
};
