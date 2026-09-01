import { describe, expect, it, vi } from "vitest";
import {
  channelReplyClaimValidationError,
  createWorkerQueueOperations,
  type WorkerQueueClient,
} from "./worker-queue-client";

describe("worker queue claim validation", () => {
  it("reports an invalid claimed channel reply with its generated claim identity", async () => {
    const completeChannelReply = vi.fn(async (_request: unknown) => ({}));
    const client = {
      claimWork: async () => ({
        retryAfterMs: 0,
        work: {
          work: {
            case: "channelReply",
            value: {
              workId: "reply-1",
              runId: "run-1",
              claimToken: "claim-1",
              scope: {
                scope: {
                  case: "organization",
                  value: { organizationId: "organization-1" },
                },
              },
            },
          },
        },
      }),
      completeChannelReply,
    } as unknown as WorkerQueueClient;

    await expect(createWorkerQueueOperations(client).claimWork({
      organizationId: "organization-1",
      projectId: "project-1",
      workerId: "worker-1",
      claimedBy: "device-1",
      repliesOnly: true,
    })).rejects.toThrow(
      `${channelReplyClaimValidationError} Reported failure for reply reply-1.`,
    );

    expect(completeChannelReply).toHaveBeenCalledOnce();
    expect(completeChannelReply.mock.calls[0]?.[0]).toMatchObject({
      projectId: "project-1",
      workerId: "worker-1",
      work: {
        workId: "reply-1",
        runId: "run-1",
        claimToken: "claim-1",
        work: {
          case: "channelReply",
          value: { organizationId: "organization-1" },
        },
      },
      outcome: {
        case: "failure",
        value: { error: channelReplyClaimValidationError },
      },
    });
  });
});
