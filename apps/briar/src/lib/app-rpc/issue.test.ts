import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  IssueChangedField,
  IssueMessageSchema,
  IssueUpdateProposalSchema,
  ReworkRunResponse_Outcome,
  ReworkRunResponseSchema,
  SyncIssueMessagesResponseSchema,
  UnassignRunResponse_Outcome,
  UnassignRunResponseSchema,
  UpdateIssueMessageResponseSchema,
} from "@briar/contracts/gen/briar/app/v1/issue_pb";
import {
  ProposalStatus,
} from "@briar/contracts/gen/briar/app/v1/common_pb";
import { describe, expect, it } from "vitest";
import type { CreateIssueInput, UpdateIssueInput } from "../../types";
import {
  createIssueMessageRequestFromInput,
  createIssueRequestFromInput,
  issueConversationDeltaFromMessage,
  issueMessageFromMessage,
  issueMutationTransport,
  reworkRunResultFromMessage,
  unassignRunResultFromMessage,
  updateIssueRequestFromInput,
  updatedIssueMessageFromMessage,
} from "./issue";
import { apiErrorFromConnect } from "./core";

const instant = (value: string) => timestampFromDate(new Date(value));

const updateInput = (
  patch: Partial<UpdateIssueInput> = {},
): UpdateIssueInput => ({
  title: "Ship contracts",
  description: null,
  priority: null,
  difficulty: null,
  attachments: [],
  ...patch,
});

describe("Issue Connect boundary", () => {
  it("preserves proposal oneof and explicit null update changes", () => {
    const timestamp = instant("2026-08-30T01:02:03.000Z");
    const message = create(IssueMessageSchema, {
      id: "message-1",
      runId: "run-1",
      body: "Please clear stale fields",
      author: { name: "Reviewer" },
      proposedAction: {
        case: "updateProposal",
        value: create(IssueUpdateProposalSchema, {
          id: "proposal-1",
          changes: {},
          changedFields: [
            IssueChangedField.DESCRIPTION,
            IssueChangedField.PRIORITY,
          ],
          status: ProposalStatus.PENDING,
        }),
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    expect(issueMessageFromMessage(message).proposedAction).toEqual({
      id: "proposal-1",
      type: "request_issue_update",
      changes: { description: null, priority: null },
      changedFields: ["description", "priority"],
      status: "pending",
      acceptedAt: null,
      resultRunId: null,
    });
  });

  it("keeps assignee and attachment patches as three-state presence", () => {
    const omitted = updateIssueRequestFromInput(
      "project-1",
      "run-1",
      updateInput(),
    );
    const cleared = updateIssueRequestFromInput(
      "project-1",
      "run-1",
      updateInput({
        assigneeUserId: null,
        keptAttachmentIds: [],
        attachmentReferences: ["attachment-ref"],
      }),
    );
    const assigned = updateIssueRequestFromInput(
      "project-1",
      "run-1",
      updateInput({ assigneeUserId: "user-1" }),
    );

    expect(omitted.assigneeUpdate.case).toBeUndefined();
    expect(omitted.keptAttachmentIds).toBeUndefined();
    expect(cleared.assigneeUpdate).toEqual({
      case: "clearAssignee",
      value: {},
    });
    expect(cleared.keptAttachmentIds).toEqual({ values: [] });
    expect(cleared.attachmentReferences).toEqual(["attachment-ref"]);
    expect(assigned.assigneeUpdate).toEqual({
      case: "assigneeUserId",
      value: "user-1",
    });
  });

  it("surfaces reset snapshots instead of treating them as deltas", () => {
    const delta = issueConversationDeltaFromMessage(create(
      SyncIssueMessagesResponseSchema,
      {
        cursor: 42n,
        changed: true,
        reset: true,
      },
    ));

    expect(delta).toMatchObject({
      cursor: 42,
      changed: true,
      reset: true,
      messages: [],
      agentReplies: [],
    });
    expect(() => issueConversationDeltaFromMessage(create(
      SyncIssueMessagesResponseSchema,
      { cursor: BigInt(Number.MAX_SAFE_INTEGER) + 1n },
    ))).toThrow("outside JavaScript's safe integer range");
    expect(
      apiErrorFromConnect(
        new ConnectError("checkpoint conflict", Code.FailedPrecondition),
      ).status,
    ).toBe(409);
  });

  it("uses Connect without file bytes and carries attachment references", () => {
    const input: CreateIssueInput = {
      title: "Ship contracts",
      description: null,
      priority: null,
      difficulty: null,
      status: "backlog",
      attachments: [],
      attachmentReferences: ["attachment-ref"],
      checkpoints: [{ key: "review", stage: "review", position: "after" }],
    };
    const request = createIssueRequestFromInput("project-1", input);
    const messageRequest = createIssueMessageRequestFromInput(
      "project-1",
      "run-1",
      {
        body: "See attachment",
        clientMessageId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
        parentMessageId: null,
        attachmentReferences: ["message-ref"],
      },
    );

    expect(issueMutationTransport(input.attachments)).toBe("connect");
    expect(issueMutationTransport([{} as File])).toBe("multipart");
    expect(request).toMatchObject({
      attachmentReferences: ["attachment-ref"],
      checkpoints: [{ key: "review", stage: "review" }],
    });
    expect(messageRequest).toMatchObject({
      clientMessageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      attachmentReferences: ["message-ref"],
    });
  });

  it("rejects unspecified control outcomes and a missing edited message", () => {
    expect(reworkRunResultFromMessage(create(ReworkRunResponseSchema, {
      outcome: ReworkRunResponse_Outcome.ALREADY_REWORKED,
    })).outcome).toBe("already_reworked");
    expect(unassignRunResultFromMessage(create(UnassignRunResponseSchema, {
      outcome: UnassignRunResponse_Outcome.NOT_ASSIGNED,
    })).outcome).toBe("not_assigned");

    expect(() => reworkRunResultFromMessage(
      create(ReworkRunResponseSchema),
    )).toThrow("Unknown rework outcome");
    expect(() => unassignRunResultFromMessage(
      create(UnassignRunResponseSchema),
    )).toThrow("Unknown unassign outcome");
    expect(() => updatedIssueMessageFromMessage(
      create(UpdateIssueMessageResponseSchema),
    )).toThrow("updateIssueMessage.message is missing");
  });
});
