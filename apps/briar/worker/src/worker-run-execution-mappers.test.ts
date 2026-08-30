import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  RunStatus,
  StructuredRunResult_Impact,
  StructuredRunResult_Importance,
  StructuredRunResult_Outcome,
  StructuredRunResult_Urgency,
  StructuredRunResultSchema,
} from "@briar/contracts/gen/briar/app/v1/common_pb";
import { TrackerReferenceSchema } from "@briar/contracts/gen/briar/app/v1/dashboard_pb";
import {
  AutoHuntSource,
  IssueReplyClaimIdentitySchema,
  RecordRunEventRequestSchema,
  RunSourceIdentitySchema,
  TransitionWorkflowStageRequest_Action,
  TransitionWorkflowStageRequestSchema,
  WorkClaimIdentitySchema,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { describe, expect, it } from "vitest";
import {
  workerRunEvent,
  workflowStageTransition,
} from "./worker-run-execution-mappers";

const projectId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";

describe("Worker run execution protobuf mapping", () => {
  it("maps the generated event oneof, timestamps, common DTOs, and context", () => {
    const request = create(RecordRunEventRequestSchema, {
      projectId,
      target: {
        case: "sourceIdentity",
        value: create(RunSourceIdentitySchema, {
          source: AutoHuntSource.ISSUE,
          sourceKey: "BRIAR-42",
          title: "Repair the workflow",
        }),
      },
      status: RunStatus.BLOCKED,
      eventKey: "BRIAR-42:blocked:credentials",
      occurredAt: timestampFromDate(new Date("2026-08-31T01:02:03.000Z")),
      actor: "briar-workflow",
      repository: "wordbricks/briar",
      detail: "GitHub credentials expired.",
      tracker: create(TrackerReferenceSchema, {
        provider: "linear",
        identifier: "BRIAR-42",
        url: "https://linear.app/acme/issue/BRIAR-42",
      }),
      resultSummary: "A person must reconnect GitHub.",
      structuredResult: create(StructuredRunResultSchema, {
        summary: "A person must reconnect GitHub.",
        outcome: StructuredRunResult_Outcome.BLOCKED,
        importance: StructuredRunResult_Importance.IMPORTANT,
        urgency: StructuredRunResult_Urgency.NORMAL,
        impact: StructuredRunResult_Impact.ISSUE,
        humanActionRequired: true,
        nextAction: "Reconnect GitHub and retry the run.",
      }),
      pullRequestUrls: ["https://github.com/wordbricks/briar/pull/42"],
      context: { attempt: 2, provider: "codex" },
    });

    expect(workerRunEvent(request)).toMatchObject({
      target: {
        kind: "sourceIdentity",
        source: "issue",
        sourceKey: "BRIAR-42",
      },
      event: {
        status: "blocked",
        occurredAt: "2026-08-31T01:02:03.000Z",
        tracker: { provider: "linear", identifier: "BRIAR-42" },
        structuredResult: {
          outcome: "blocked",
          humanActionRequired: true,
        },
        context: { attempt: 2, provider: "codex" },
      },
    });
  });

  it("fails closed for an open status enum and a non-issue work oneof", () => {
    expect(() => workerRunEvent(create(RecordRunEventRequestSchema, {
      projectId,
      target: {
        case: "sourceIdentity",
        value: create(RunSourceIdentitySchema, {
          source: AutoHuntSource.ISSUE,
          sourceKey: "BRIAR-42",
          title: "Repair the workflow",
        }),
      },
      status: 99 as RunStatus,
      eventKey: "event",
      occurredAt: timestampFromDate(new Date()),
      actor: "briar-workflow",
      repository: "wordbricks/briar",
    }))).toThrow("status is required");

    expect(() => workflowStageTransition(create(
      TransitionWorkflowStageRequestSchema,
      {
        projectId,
        work: create(WorkClaimIdentitySchema, {
          workId: runId,
          runId,
          claimToken: `briar_claim_${"a".repeat(64)}`,
          work: {
            case: "issueReply",
            value: create(IssueReplyClaimIdentitySchema),
          },
        }),
        requestId: "33333333-3333-4333-8333-333333333333",
        stage: "implementing",
        action: TransitionWorkflowStageRequest_Action.START,
      },
    ))).toThrow("Issue work identity is required");
  });
});
