import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Client } from "@connectrpc/connect";
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
  type ClaimedChannelReply,
  type ClaimedProjectAgentTask,
  type ClaimedWork,
  type WorkerLeaseRenewal,
} from "./worker-queue-contract";
import { createAuthenticatedConnectClient } from "./connect-client";

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

export const workClaimIdentityToProto = (
  work: ClaimedWork,
): WorkClaimIdentity => ({
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
          : work.workType === "dmMemory"
            ? {
                case: "dmMemory",
                value: {
                  $typeName: "briar.worker.v1.DmMemoryLearningClaimIdentity",
                  organizationId: work.organizationId,
                  inputHash: work.inputHash,
                },
              }
            : {
              case: "mergeBatch",
              value: { $typeName: "briar.worker.v1.MergeBatchClaimIdentity" },
            },
});

export type WorkerQueueClient = Client<typeof WorkerQueueService>;

export const channelReplyClaimValidationError =
  "Channel reply claim response validation failed. Update the Briar Worker and retry.";

export function createWorkerQueueClient(
  apiUrl: string,
  token: string,
): WorkerQueueClient {
  return createAuthenticatedConnectClient(
    WorkerQueueService,
    apiUrl,
    token,
    { binary: true },
  );
}

export function createWorkerQueueOperations(client: WorkerQueueClient) {
  return {
    claimWork: async (input: {
      organizationId: string;
      projectId: string;
      workerId: string;
      claimedBy: string;
      repliesOnly: boolean;
    }) => {
      const response = await client.claimWork(input);
      let work: ClaimedWork | null = null;
      if (response.work) {
        try {
          work = claimedWorkFromProto(response.work);
        } catch (cause) {
          const raw = response.work.work;
          if (raw.case !== "channelReply") throw cause;
          const scope = raw.value.scope?.scope;
          const organizationId = scope?.case === "organization"
            ? scope.value.organizationId
            : scope?.case === "project"
            ? scope.value.organizationId
            : "";
          if (
            organizationId !== input.organizationId ||
            !raw.value.workId ||
            !raw.value.runId ||
            !raw.value.claimToken
          ) {
            throw new Error(
              `${channelReplyClaimValidationError} Failure was not reported because claim credentials are invalid.`,
              { cause },
            );
          }
          try {
            await client.completeChannelReply({
              requestId: crypto.randomUUID(),
              projectId: input.projectId,
              workerId: input.workerId,
              work: {
                workId: raw.value.workId,
                runId: raw.value.runId,
                claimToken: raw.value.claimToken,
                work: {
                  case: "channelReply",
                  value: { organizationId },
                },
              },
              outcome: {
                case: "failure",
                value: { error: channelReplyClaimValidationError },
              },
            }, { signal: AbortSignal.timeout(10_000) });
          } catch {
            throw new Error(
              `${channelReplyClaimValidationError} Could not confirm failure reporting for reply ${raw.value.workId}.`,
              { cause },
            );
          }
          throw new Error(
            `${channelReplyClaimValidationError} Reported failure for reply ${raw.value.workId}.`,
            { cause },
          );
        }
      }
      return {
        work,
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
        work: workClaimIdentityToProto(input.work),
      });
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

    checkpointChannelReplySession: async (input: {
      projectId: string;
      workerId: string;
      work: ClaimedChannelReply;
      conversationId: string | null;
    }) => {
      const response = await client.checkpointChannelReplySession({
        projectId: input.projectId,
        workerId: input.workerId,
        work: workClaimIdentityToProto(input.work),
        conversationId: input.conversationId ?? undefined,
      });
      return {
        retainedUntil: requiredIsoTimestamp(
          response.retainedUntil,
          "retainedUntil",
        ),
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
        work: workClaimIdentityToProto(input.work),
        checkpoint: {
          conversationId: input.checkpoint.conversationId ?? undefined,
          workspacePath: input.checkpoint.workspacePath ?? undefined,
        },
      });
      if (
        response.outcome !== HandoffWorkResponse_Outcome.RELEASED &&
        response.outcome !== HandoffWorkResponse_Outcome.ALREADY_RELEASED
      ) {
        throw new Error("Worker handoff did not release the claim");
      }
      return response;
    },

    completeProjectAgentTask: (input: {
      projectId: string;
      workerId: string;
      work: ClaimedProjectAgentTask;
      result:
        | {
          case: "success";
          summary: string;
          conversationId: string | null;
        }
        | { case: "failure"; error: string };
      signal?: AbortSignal;
    }) =>
      client.completeProjectAgentTask(
        {
          projectId: input.projectId,
          workerId: input.workerId,
          work: workClaimIdentityToProto(input.work),
          result: input.result.case === "success"
            ? {
              case: "success",
              value: {
                summary: input.result.summary,
                conversationId: input.result.conversationId ?? undefined,
              },
            }
            : {
              case: "failure",
              value: { error: input.result.error },
            },
        },
        { signal: input.signal },
      ),
  };
}

export function createAuthenticatedWorkerExecutionClient(
  apiUrl: string,
  token: string,
) {
  return createAuthenticatedConnectClient(
    WorkerExecutionService,
    apiUrl,
    token,
    { binary: true },
  );
}
