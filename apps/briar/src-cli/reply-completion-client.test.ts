import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  ReplyCompletionDisposition,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { describe, expect, it, vi } from "vitest";
import {
  createReplyCompletionClient,
  type ReplyCompletionQueueClient,
} from "./reply-completion-client";
import type {
  ClaimedChannelReply,
  ClaimedIssueReply,
} from "./worker-queue-contract";

const projectId = "11111111-1111-4111-8111-111111111111";
const workerId = "worker-1";
const workId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const attachmentId = "44444444-4444-4444-8444-444444444444";

const issueWork = {
  workType: "issueReply",
  workId,
  runId,
  claimToken: `briar_reply_claim_${"a".repeat(64)}`,
} as ClaimedIssueReply;

const channelWork = {
  workType: "channelReply",
  workId,
  runId,
  organizationId: "55555555-5555-4555-8555-555555555555",
  claimToken: `briar_channel_claim_${"b".repeat(64)}`,
} as ClaimedChannelReply;

describe("generated reply completion client", () => {
  it("retries exact IDs, uploads digested bytes, and maps both action oneofs", async () => {
    const prepare = vi.fn()
      .mockRejectedValueOnce(new ConnectError("retry", Code.Unavailable))
      .mockResolvedValue({
        replayed: true,
        uploads: [{
          clientId: "attachment-1",
          reference: { attachmentId },
          uploadUrl: `http://127.0.0.1:8787/reply-attachment-uploads/${attachmentId}`,
          uploadCapability: "opaque-capability",
          expiresAt: timestampFromDate(new Date("2026-08-31T10:00:00.000Z")),
        }],
      });
    const completeIssue = vi.fn()
      .mockRejectedValueOnce(new ConnectError("retry", Code.Unavailable))
      .mockResolvedValue({
        replayed: true,
        disposition: ReplyCompletionDisposition.COMPLETED,
      });
    const completeChannel = vi.fn().mockResolvedValue({
      replayed: false,
      disposition: ReplyCompletionDisposition.COMPLETED,
      retainedUntil: timestampFromDate(new Date("2026-08-31T16:00:00.000Z")),
    });
    const queue = {
      prepareReplyAttachmentUploads: prepare,
      completeIssueReply: completeIssue,
      completeChannelReply: completeChannel,
    } as unknown as ReplyCompletionQueueClient;
    const upload = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const ids = [
      "60000000-0000-4000-8000-000000000001",
      "60000000-0000-4000-8000-000000000002",
      "60000000-0000-4000-8000-000000000003",
    ];
    const client = createReplyCompletionClient(
      "http://127.0.0.1:8787",
      "worker-token",
      {
        queue,
        fetch: upload as unknown as typeof globalThis.fetch,
        randomUUID: vi.fn(() => ids.shift()!) as typeof crypto.randomUUID,
      },
    );
    const file = new File(["artifact"], "artifact.html", { type: "text/html" });

    await expect(client.completeIssueReply({
      projectId,
      workerId,
      work: issueWork,
      outcome: {
        case: "success",
        result: {
          reply: "Created the follow-up proposal.",
          proposedAction: {
            type: "request_issue_create",
            issue: {
              title: "Generated reply completion",
              description: null,
              priority: 2,
              status: "backlog",
            },
            executeAfterCreate: false,
          },
          executionProposal: null,
          skillExecutionProposal: null,
        },
        attachments: [file],
      },
    })).resolves.toEqual({ replayed: true, disposition: "completed" });

    expect(prepare).toHaveBeenCalledTimes(2);
    expect(prepare.mock.calls[0]![0].requestId).toBe(
      prepare.mock.calls[1]![0].requestId,
    );
    expect(prepare.mock.calls[0]![0].attachments[0]).toMatchObject({
      filename: "artifact.html",
      contentType: "text/html",
      byteSize: 8n,
      sha256: expect.any(Uint8Array),
    });
    expect(upload).toHaveBeenCalledWith(
      new URL(`http://127.0.0.1:8787/reply-attachment-uploads/${attachmentId}`),
      expect.objectContaining({
        method: "PUT",
        headers: {
          Authorization: "Bearer opaque-capability",
          "Content-Type": "text/html",
        },
        body: file,
      }),
    );
    expect(completeIssue).toHaveBeenCalledTimes(2);
    expect(completeIssue.mock.calls[0]![0].requestId).toBe(
      completeIssue.mock.calls[1]![0].requestId,
    );
    expect(completeIssue.mock.calls[0]![0].outcome).toMatchObject({
      case: "success",
      value: {
        attachments: [{ attachmentId }],
        action: { case: "create" },
      },
    });

    await expect(client.completeChannelReply({
      projectId,
      workerId,
      work: channelWork,
      outcome: {
        case: "success",
        conversationId: "conversation-1",
        attachments: [],
        result: {
          body: "Attached the plan and proposal.",
          document: {
            title: "Plan",
            markdown: "# Plan",
            projectId,
          },
          issueProposal: {
            projectId,
            executeAfterCreate: false,
            issue: {
              title: "Follow up",
              description: null,
              priority: 2,
              status: "backlog",
            },
          },
          issueBatchProposal: null,
          executionProposal: null,
          skillExecutionProposal: null,
          delegation: null,
        },
      },
    })).resolves.toEqual({
      replayed: false,
      disposition: "completed",
      retainedUntil: "2026-08-31T16:00:00.000Z",
    });
    expect(completeChannel.mock.calls[0]![0].outcome).toMatchObject({
      case: "success",
      value: {
        action: {
          case: "artifacts",
          value: { document: { title: "Plan" }, proposal: { case: "issue" } },
        },
      },
    });
  });
});
