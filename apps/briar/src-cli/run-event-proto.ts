import { create, type JsonObject } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { RunStatus } from "@briar/contracts/gen/briar/app/v1/common_pb";
import { TrackerReferenceSchema } from "@briar/contracts/gen/briar/app/v1/dashboard_pb";
import {
  AutoHuntSource,
  IssueClaimIdentitySchema,
  RecordRunEventRequestSchema,
  type RecordRunEventRequest,
  WorkClaimIdentitySchema,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import type {
  AutoHuntPersistedRunStatus,
  AutoHuntSource as DomainAutoHuntSource,
} from "../src/lib/auto-hunt-contract";
import { autoHuntPersistedRunStatuses } from "../src/lib/auto-hunt-contract";
import type { StructuredAgentResult } from "../src/lib/agent-result";
import { structuredResultToProto } from "../src/lib/app-rpc/mappers";

export type RunEventDomainInput = {
  readonly status: AutoHuntPersistedRunStatus;
  readonly workflowStage?: string | null;
  readonly eventKey: string;
  readonly occurredAt: string;
  readonly actor: string;
  readonly repository: string;
  readonly detail?: string | null;
  readonly priority?: number | null;
  readonly branch?: string | null;
  readonly commitSha?: string | null;
  readonly tracker?: {
    readonly provider: string;
    readonly issueId: string | null;
    readonly identifier: string | null;
    readonly url: string | null;
    readonly state: string | null;
  } | null;
  readonly issueDescription?: string | null;
  readonly resultSummary?: string | null;
  readonly structuredResult?: StructuredAgentResult | null;
  readonly pullRequestUrls?: readonly string[];
  readonly targetSha?: string | null;
  readonly sourceCreatedAt?: string | null;
  readonly context?: JsonObject | null;
};

const runStatus = {
  backlog: RunStatus.BACKLOG,
  queued: RunStatus.QUEUED,
  running: RunStatus.RUNNING,
  blocked: RunStatus.BLOCKED,
  failed: RunStatus.FAILED,
  completed: RunStatus.COMPLETED,
  cancelled: RunStatus.CANCELLED,
} as const satisfies Record<AutoHuntPersistedRunStatus, RunStatus>;

const autoHuntSource = {
  issue: AutoHuntSource.ISSUE,
  error: AutoHuntSource.ERROR,
  feedback: AutoHuntSource.FEEDBACK,
} as const satisfies Record<DomainAutoHuntSource, AutoHuntSource>;

const timestamp = (value: string, field: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${field} is invalid`);
  return timestampFromDate(date);
};

export const workerRunEventStatus = (
  value: string | undefined,
): AutoHuntPersistedRunStatus => {
  if (
    value !== undefined &&
    autoHuntPersistedRunStatuses.includes(
      value as AutoHuntPersistedRunStatus,
    )
  ) {
    return value as AutoHuntPersistedRunStatus;
  }
  throw new Error(
    `--status is required and must be one of: ${autoHuntPersistedRunStatuses.join(", ")}`,
  );
};

export const workerRunSource = (value: string | undefined): AutoHuntSource => {
  if (value === "issue" || value === "error" || value === "feedback") {
    return autoHuntSource[value];
  }
  throw new Error("--source must be one of: issue, error, feedback");
};

export const issueWorkClaimIdentityToProto = (
  runId: string,
  claimToken: string,
) => create(WorkClaimIdentitySchema, {
  workId: runId,
  runId,
  claimToken,
  work: {
    case: "issue",
    value: create(IssueClaimIdentitySchema),
  },
});

export const workerRunEventRequest = (input: {
  readonly projectId: string;
  readonly target: RecordRunEventRequest["target"];
  readonly event: RunEventDomainInput;
}) => create(RecordRunEventRequestSchema, {
  projectId: input.projectId,
  target: input.target,
  status: runStatus[input.event.status],
  workflowStage: input.event.workflowStage ?? undefined,
  eventKey: input.event.eventKey,
  occurredAt: timestamp(input.event.occurredAt, "occurredAt"),
  actor: input.event.actor,
  repository: input.event.repository,
  detail: input.event.detail ?? undefined,
  priority: input.event.priority ?? undefined,
  branch: input.event.branch ?? undefined,
  commitSha: input.event.commitSha ?? undefined,
  tracker: input.event.tracker
    ? create(TrackerReferenceSchema, {
        provider: input.event.tracker.provider,
        issueId: input.event.tracker.issueId ?? undefined,
        identifier: input.event.tracker.identifier ?? undefined,
        url: input.event.tracker.url ?? undefined,
        state: input.event.tracker.state ?? undefined,
      })
    : undefined,
  issueDescription: input.event.issueDescription ?? undefined,
  resultSummary: input.event.resultSummary ?? undefined,
  structuredResult: input.event.structuredResult
    ? structuredResultToProto(input.event.structuredResult)
    : undefined,
  pullRequestUrls: [...(input.event.pullRequestUrls ?? [])],
  targetSha: input.event.targetSha ?? undefined,
  sourceCreatedAt: input.event.sourceCreatedAt
    ? timestamp(input.event.sourceCreatedAt, "sourceCreatedAt")
    : undefined,
  context: input.event.context ?? undefined,
});
