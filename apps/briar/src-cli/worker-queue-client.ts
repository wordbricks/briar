import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  HandoffWorkResponse_Outcome,
  WorkerExecutionService,
  WorkerQueueService,
  type ChannelActivityCredential as ProtoChannelActivityCredential,
  type WorkClaimIdentity,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import type { WorkerExecutionCheckpoint } from "./worker";
import {
  claimedWorkFromProto,
  type ChannelActivityCredential,
  type ClaimedWork,
  type WorkerLeaseRenewal,
} from "./worker-queue-contract";

const workerConnectTransport = (apiUrl: string) => createConnectTransport({
  baseUrl: apiUrl.replace(/\/+$/u, ""),
  useBinaryFormat: true,
});

const requiredIsoTimestamp = (
  value: Parameters<typeof timestampDate>[0] | undefined,
  field: string,
) => {
  if (value === undefined) throw new Error(`Worker RPC omitted ${field}`);
  const date = timestampDate(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Worker RPC returned invalid ${field}`);
  return date.toISOString();
};

const activity = (
  value: ProtoChannelActivityCredential | undefined,
): ChannelActivityCredential | null => value === undefined
  ? null
  : {
      token: value.token,
      expiresAt: requiredIsoTimestamp(value.expiresAt, "activity.expiresAt"),
    };

const claimIdentity = (work: ClaimedWork): WorkClaimIdentity => ({
  $typeName: "briar.worker.v1.WorkClaimIdentity",
  workId: work.workId,
  runId: work.runId,
  claimToken: work.claimToken,
  work: work.workType === "issue"
    ? {
        case: "issue",
        value: { $typeName: "briar.worker.v1.IssueClaimIdentity" },
      }
    : work.workType === "issueReply"
      ? {
          case: "issueReply",
          value: { $typeName: "briar.worker.v1.IssueReplyClaimIdentity" },
        }
      : work.workType === "channelReply"
        ? {
            case: "channelReply",
            value: {
              $typeName: "briar.worker.v1.ChannelReplyClaimIdentity",
              organizationId: work.organizationId,
            },
          }
        : work.workType === "projectAgentTask"
          ? {
              case: "projectAgentTask",
              value: {
                $typeName: "briar.worker.v1.ProjectAgentTaskClaimIdentity",
              },
            }
          : {
              case: "mergeBatch",
              value: { $typeName: "briar.worker.v1.MergeBatchClaimIdentity" },
            },
});

export function createWorkerQueueClient(apiUrl: string, token: string) {
  const client = createClient(
    WorkerQueueService,
    workerConnectTransport(apiUrl),
  );
  const options = { headers: { Authorization: `Bearer ${token}` } };

  return {
    claimWork: async (input: {
      projectId: string;
      workerId: string;
      claimedBy: string;
      repliesOnly: boolean;
    }) => {
      const response = await client.claimWork(input, options);
      return {
        work: response.work ? claimedWorkFromProto(response.work) : null,
        retryAfterMs: response.retryAfterMs,
      };
    },

    renewWorkLease: async (input: {
      projectId: string;
      workerId: string;
      work: ClaimedWork;
    }): Promise<WorkerLeaseRenewal> => {
      const response = await client.renewWorkLease({
        projectId: input.projectId,
        workerId: input.workerId,
        work: claimIdentity(input.work),
      }, options);
      if (
        response.work.case !== input.work.workType &&
        !(input.work.workType === "projectAgentTask" &&
          response.work.case === "projectAgentTask")
      ) {
        throw new Error("Worker lease renewal returned a different work variant");
      }
      return {
        leaseExpiresAt: requiredIsoTimestamp(
          response.leaseExpiresAt,
          "leaseExpiresAt",
        ),
        retainedUntil: response.work.case === "channelReply"
          ? response.work.value.retainedUntil
            ? requiredIsoTimestamp(
                response.work.value.retainedUntil,
                "retainedUntil",
              )
            : null
          : null,
        activity: response.work.case === "channelReply" ||
            response.work.case === "issueReply"
          ? activity(response.work.value.activity)
          : null,
      };
    },

    handoffWork: async (input: {
      requestId: string;
      projectId: string;
      workerId: string;
      work: ClaimedWork;
      checkpoint: WorkerExecutionCheckpoint;
    }) => {
      const response = await client.handoffWork({
        requestId: input.requestId,
        projectId: input.projectId,
        workerId: input.workerId,
        work: claimIdentity(input.work),
        checkpoint: {
          conversationId: input.checkpoint.conversationId ?? undefined,
          workspacePath: input.checkpoint.workspacePath ?? undefined,
        },
      }, options);
      if (
        response.outcome !== HandoffWorkResponse_Outcome.RELEASED &&
        response.outcome !== HandoffWorkResponse_Outcome.ALREADY_RELEASED
      ) {
        throw new Error("Worker handoff did not release the claim");
      }
      return response;
    },
  };
}

export function createAuthenticatedWorkerExecutionClient(
  apiUrl: string,
  token: string,
) {
  return {
    client: createClient(
      WorkerExecutionService,
      workerConnectTransport(apiUrl),
    ),
    options: { headers: { Authorization: `Bearer ${token}` } },
  };
}
