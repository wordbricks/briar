import { describe, expect, it } from "vitest";
import {
  decodeIssueCreateMutationReceiptResponseJson,
  decodeIssueCreateMutationReceiptResponse,
  decodeIssueCreateMutationReceiptRow,
  decodeIssueMessageMutationReceiptResponseJson,
  decodeIssueMessageMutationReceiptResponse,
  decodeIssueUpdateMutationReceiptResponseJson,
  decodeIssueUpdateMutationReceiptResponse,
  encodeIssueCreateMutationReceiptResponseJson,
  encodeIssueMessageMutationReceiptResponseJson,
  encodeIssueUpdateMutationReceiptResponseJson,
} from "./issue-mutation-receipt-contract";

const projectId = "10000000-0000-4000-8000-000000000001";
const runId = "20000000-0000-4000-8000-000000000001";
const messageId = "30000000-0000-4000-8000-000000000001";
const observedAt = "2026-09-01T00:00:00.000Z";

const attachment = {
  id: "40000000-0000-4000-8000-000000000001",
  filename: "evidence.png",
  contentType: "image/png",
  byteSize: 42,
  url:
    `/projects/${projectId}/runs/${runId}/attachments/40000000-0000-4000-8000-000000000001`,
} as const;

const createResponse = decodeIssueCreateMutationReceiptResponse({
  runId,
  sourceKey: `briar-issue:${runId}`,
  stage: "queued",
  status: "backlog",
  assigneeUserId: null,
  createdByUserId: "receipt-owner",
  difficulty: "normal",
  attachments: [attachment],
});

const updateResponse = decodeIssueUpdateMutationReceiptResponse({
  runId,
  title: "Canonical update",
  description: null,
  priority: 2,
  difficulty: "hard",
  assigneeUserId: null,
  attachments: [attachment],
});

const agentReply = {
  id: "50000000-0000-4000-8000-000000000001",
  triggerMessageId: messageId,
  parentMessageId: messageId,
  agentId: "60000000-0000-4000-8000-000000000001",
  agentName: "Reviewer",
  status: "queued",
  attempts: 0,
  workerId: null,
  provider: null,
  error: null,
  updatedAt: observedAt,
} as const;

const messageResponse = decodeIssueMessageMutationReceiptResponse({
  message: {
    id: messageId,
    runId,
    parentMessageId: null,
    body: "Please review the evidence.",
    attachments: [attachment],
    author: {
      id: "receipt-owner",
      name: "Receipt Owner",
      image: null,
      agentId: null,
      provider: null,
    },
    replyCount: 0,
    proposedAction: null,
    executionProposal: null,
    skillExecutionProposal: null,
    createdAt: observedAt,
    updatedAt: observedAt,
  },
  agentReply,
  agentReplies: [agentReply],
});

describe("issue mutation receipt contract", () => {
  it("round-trips every durable replay payload", () => {
    expect(decodeIssueCreateMutationReceiptResponseJson(
      encodeIssueCreateMutationReceiptResponseJson(createResponse),
    )).toEqual(createResponse);
    expect(decodeIssueUpdateMutationReceiptResponseJson(
      encodeIssueUpdateMutationReceiptResponseJson(updateResponse),
    )).toEqual(updateResponse);
    expect(decodeIssueMessageMutationReceiptResponseJson(
      encodeIssueMessageMutationReceiptResponseJson(messageResponse),
    )).toEqual(messageResponse);
  });

  it("rejects corrupt shape, inconsistent projections, and row identity", () => {
    expect(() => decodeIssueCreateMutationReceiptResponseJson(
      JSON.stringify({ ...createResponse, trusted: true }),
    )).toThrow(/excess property/iu);
    expect(() => decodeIssueMessageMutationReceiptResponseJson(
      JSON.stringify({ ...messageResponse, agentReply: null }),
    )).toThrow(/singular projection/iu);
    expect(() => decodeIssueCreateMutationReceiptRow({
      client_issue_id: "70000000-0000-4000-8000-000000000001",
      organization_id: "80000000-0000-4000-8000-000000000001",
      project_id: projectId,
      user_id: "receipt-owner",
      request_hash: "a".repeat(64),
      attachment_upload_ids_json: JSON.stringify([attachment.id]),
      response_json: encodeIssueCreateMutationReceiptResponseJson(
        createResponse,
      ),
      created_at: observedAt,
    })).toThrow(/run identity/iu);
  });
});
