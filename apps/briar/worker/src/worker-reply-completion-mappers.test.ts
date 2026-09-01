import {
  create,
  fromBinary,
  toBinary,
} from "@bufbuild/protobuf";
import {
  ChannelReplyClaimIdentitySchema,
  ChannelReplyArtifactsActionSchema,
  ChannelReplyIssueBatchActionSchema,
  ChannelReplyIssueBatchDependencySchema,
  ChannelReplyIssueBatchItemSchema,
  ChannelReplySuccessSchema,
  type CompleteIssueReplyRequest,
  CompleteChannelReplyRequestSchema,
  CompleteIssueReplyRequestSchema,
  IssueReplyClaimIdentitySchema,
  IssueReplySuccessSchema,
  ReplyIssueDraftSchema,
  WorkClaimIdentitySchema,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { describe, expect, it } from "vitest";
import {
  completeChannelReplyInputFromProto,
  completeIssueReplyInputFromProto,
} from "./worker-reply-completion-mappers";

const requestId = "10000000-0000-4000-8000-000000000001";
const projectId = "20000000-0000-4000-8000-000000000001";
const organizationId = "30000000-0000-4000-8000-000000000001";
const workId = "40000000-0000-4000-8000-000000000001";
const runId = "50000000-0000-4000-8000-000000000001";

const issueWork = () => create(WorkClaimIdentitySchema, {
  workId,
  runId,
  claimToken: "briar_reply_claim_generated",
  work: {
    case: "issueReply",
    value: create(IssueReplyClaimIdentitySchema),
  },
});

const channelWork = () => create(WorkClaimIdentitySchema, {
  workId,
  runId,
  claimToken: "briar_channel_claim_generated",
  work: {
    case: "channelReply",
    value: create(ChannelReplyClaimIdentitySchema, { organizationId }),
  },
});

describe("reply completion protobuf mapping", () => {
  it("accepts the protobuf worker limit and normalizes the domain payload", () => {
    const workerId = "w".repeat(128);
    const mapped = completeChannelReplyInputFromProto(create(
      CompleteChannelReplyRequestSchema,
      {
        requestId,
        projectId,
        workerId,
        work: channelWork(),
        outcome: {
          case: "success",
          value: {
            body: "  Done.  ",
            conversationId: "  conversation-1  ",
          },
        },
      },
    ));

    expect(mapped.workerId).toBe(workerId);
    expect(mapped.conversationId).toBe("conversation-1");
    expect(mapped.outcome).toMatchObject({
      case: "success",
      completion: { body: "Done." },
    });
  });

  it("retains semantic validation for generated success payloads", () => {
    expect(() => completeIssueReplyInputFromProto(create(
      CompleteIssueReplyRequestSchema,
      {
        requestId,
        projectId,
        workerId: "worker-1",
        work: issueWork(),
        outcome: { case: "success", value: { body: "   " } },
      },
    ))).toThrow("Issue reply result is invalid");

    expect(() => completeChannelReplyInputFromProto(create(
      CompleteChannelReplyRequestSchema,
      {
        requestId,
        projectId,
        workerId: "worker-1",
        work: channelWork(),
        outcome: {
          case: "success",
          value: {
            body: "Create both issues.",
            action: {
              case: "artifacts",
              value: {
                proposal: {
                  case: "issueBatch",
                  value: create(ChannelReplyIssueBatchActionSchema, {
                    items: [create(ChannelReplyIssueBatchItemSchema, {
                      key: "only",
                      issue: create(ReplyIssueDraftSchema, { title: "Only" }),
                    })],
                    dependencies: [create(ChannelReplyIssueBatchDependencySchema, {
                      prerequisiteKey: "only",
                      dependentKey: "only",
                    })],
                  }),
                },
              },
            },
          },
        },
      },
    ))).toThrow("Channel reply result is invalid");
  });

  it("fails closed when the generated outcome oneof is absent or unknown", () => {
    const absent = create(CompleteIssueReplyRequestSchema, {
      requestId,
      projectId,
      workerId: "worker-1",
      work: issueWork(),
    });
    expect(() => completeIssueReplyInputFromProto(absent)).toThrow(
      "Issue reply outcome is required",
    );

    const unknown = {
      ...absent,
      outcome: { case: "futureOutcome", value: {} },
    } as unknown as CompleteIssueReplyRequest;
    expect(() => completeIssueReplyInputFromProto(unknown)).toThrow(
      "Issue reply outcome is required",
    );
  });

  it("rejects future nested oneof variants decoded from protobuf binary", () => {
    const issueSuccess = fromBinary(
      IssueReplySuccessSchema,
      new Uint8Array([
        ...toBinary(
          IssueReplySuccessSchema,
          create(IssueReplySuccessSchema, { body: "Done." }),
        ),
        0x7a,
        0x00,
      ]),
    );
    const issueRequest = fromBinary(
      CompleteIssueReplyRequestSchema,
      toBinary(
        CompleteIssueReplyRequestSchema,
        create(CompleteIssueReplyRequestSchema, {
          requestId,
          projectId,
          workerId: "worker-1",
          work: issueWork(),
          outcome: { case: "success", value: issueSuccess },
        }),
      ),
    );
    expect(issueRequest.outcome.case).toBe("success");
    if (issueRequest.outcome.case !== "success") throw new Error("unreachable");
    expect(issueRequest.outcome.value.action.case).toBeUndefined();
    expect(() => completeIssueReplyInputFromProto(issueRequest)).toThrow(
      "Issue reply request contains unknown protobuf fields",
    );

    const artifacts = fromBinary(
      ChannelReplyArtifactsActionSchema,
      new Uint8Array([
        ...toBinary(
          ChannelReplyArtifactsActionSchema,
          create(ChannelReplyArtifactsActionSchema),
        ),
        0x6a,
        0x00,
      ]),
    );
    const channelRequest = fromBinary(
      CompleteChannelReplyRequestSchema,
      toBinary(
        CompleteChannelReplyRequestSchema,
        create(CompleteChannelReplyRequestSchema, {
          requestId,
          projectId,
          workerId: "worker-1",
          work: channelWork(),
          outcome: {
            case: "success",
            value: create(ChannelReplySuccessSchema, {
              body: "Done.",
              action: { case: "artifacts", value: artifacts },
            }),
          },
        }),
      ),
    );
    expect(channelRequest.outcome.case).toBe("success");
    if (channelRequest.outcome.case !== "success") {
      throw new Error("unreachable");
    }
    expect(channelRequest.outcome.value.action.case).toBe("artifacts");
    if (channelRequest.outcome.value.action.case !== "artifacts") {
      throw new Error("unreachable");
    }
    expect(
      channelRequest.outcome.value.action.value.proposal.case,
    ).toBeUndefined();
    expect(() => completeChannelReplyInputFromProto(channelRequest)).toThrow(
      "Channel reply request contains unknown protobuf fields",
    );
  });
});
