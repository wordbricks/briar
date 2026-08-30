import { createConnectRouter } from "@connectrpc/connect";
import { createFetchHandler } from "@connectrpc/connect/protocol";
import {
  IssueService,
} from "@briar/contracts/gen/briar/app/v1/issue_pb";
import { describe, expect, it, vi } from "vitest";
import type { BriarAuth } from "./auth";
import { HttpError } from "./http-response";
import {
  appConnectIssueServices,
  type AppConnectIssueServices,
  registerAppIssueService,
} from "./app-connect-issue";

const projectId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const messageId = "33333333-3333-4333-8333-333333333333";
const proposalId = "44444444-4444-4444-8444-444444444444";
const replyId = "55555555-5555-4555-8555-555555555555";
const agentId = "66666666-6666-4666-8666-666666666666";
const attachmentId = "77777777-7777-4777-8777-777777777777";
const userId = "88888888-8888-4888-8888-888888888888";

const issueConnectRequest = (method: string, body: unknown) =>
  new Request(
    `https://api.example.test/briar.app.v1.IssueService/${method}`,
    {
      method: "POST",
      headers: {
        authorization: "Bearer session-token",
        "connect-protocol-version": "1",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

const authenticatedSession = {
  session: {
    id: "session-1",
    userId,
    token: "session-token",
    expiresAt: new Date("2027-08-30T00:00:00.000Z"),
    createdAt: new Date("2026-08-30T00:00:00.000Z"),
    updatedAt: new Date("2026-08-30T00:00:00.000Z"),
  },
  user: {
    id: userId,
    name: "Owner",
    email: "owner@example.com",
    emailVerified: true,
    createdAt: new Date("2026-08-30T00:00:00.000Z"),
    updatedAt: new Date("2026-08-30T00:00:00.000Z"),
  },
};

const invokeIssueRpc = async (
  method: string,
  body: unknown,
  overrides: Partial<AppConnectIssueServices>,
) => {
  const request = issueConnectRequest(method, body);
  const router = createConnectRouter({
    connect: true,
    grpc: false,
    grpcWeb: false,
  });
  registerAppIssueService(
    router,
    {
      request,
      auth: {} as BriarAuth,
      db: {} as D1Database,
      env: {
        ATTACHMENTS: {},
        ARCHIVES: {},
      } as Env,
    },
    {
      ...appConnectIssueServices,
      requireSession: vi.fn().mockResolvedValue(authenticatedSession),
      ...overrides,
    },
  );
  const handler = router.handlers.find((candidate) =>
    candidate.requestPath === `/briar.app.v1.IssueService/${method}`
  );
  expect(handler).toBeDefined();
  return createFetchHandler(handler!)(request);
};

describe("app Issue Connect adapter", () => {
  it("calls the create application service directly with lossless workflow input", async () => {
    const createIssue = vi.fn<AppConnectIssueServices["createIssue"]>();
    createIssue.mockResolvedValueOnce({
      runId,
      sourceKey: "BR-1",
      status: "backlog",
      stage: "queued",
      assigneeUserId: null,
      createdByUserId: userId,
      difficulty: null,
      attachments: [],
    });

    const response = await invokeIssueRpc("CreateIssue", {
      projectId,
      title: "Preserve wire input",
      status: "RUN_STATUS_BACKLOG",
      checkpoints: [{
        key: "review",
        stage: "implement",
        position: "POSITION_AFTER",
      }],
      attachmentReferences: ["draft-image-1"],
    }, { createIssue });

    expect(response.status).toBe(200);
    expect(createIssue).toHaveBeenCalledOnce();
    expect(createIssue.mock.calls[0][0]).toMatchObject({
      projectId,
      userId,
      attachments: [],
      attachmentReferences: ["draft-image-1"],
      request: {
        status: "backlog",
        checkpoints: [{
          key: "review",
          stage: "implement",
          position: "after",
        }],
      },
    });
  });

  it("preserves assignee and attachment patch presence", async () => {
    const updateIssue = vi.fn<AppConnectIssueServices["updateIssue"]>();
    updateIssue.mockResolvedValue({
      runId,
      title: "Updated issue",
      description: null,
      priority: null,
      difficulty: "normal",
      assigneeUserId: null,
      attachments: [{
        id: attachmentId,
        filename: "design.png",
        contentType: "image/png",
        byteSize: 12,
        url: `https://api.example.test/attachments/${attachmentId}`,
      }],
    });

    const cleared = await invokeIssueRpc("UpdateIssue", {
      projectId,
      runId,
      title: "Updated issue",
      clearAssignee: {},
      attachmentReferences: [attachmentId],
      keptAttachmentIds: { values: [] },
    }, { updateIssue });
    expect(cleared.status).toBe(200);
    expect(updateIssue.mock.calls[0][0]).toMatchObject({
      request: { assigneeUserId: null },
      attachmentReferences: [attachmentId],
      keptAttachmentIds: [],
    });
    expect(await cleared.json()).toMatchObject({
      attachments: [{ id: attachmentId, byteSize: "12" }],
    });

    const unchanged = await invokeIssueRpc("UpdateIssue", {
      projectId,
      runId,
      title: "Updated issue",
    }, { updateIssue });
    expect(unchanged.status).toBe(200);
    const applicationInput = updateIssue.mock.calls[1][0];
    expect(applicationInput.request).not.toHaveProperty("assigneeUserId");
    expect(applicationInput.keptAttachmentIds).toBeUndefined();
  });

  it("turns an expired delta into an authoritative reset snapshot", async () => {
    const syncMessages = vi.fn<AppConnectIssueServices["syncMessages"]>();
    syncMessages.mockRejectedValueOnce(new HttpError(
      410,
      "Conversation cursor expired; reload the full snapshot",
      "issue_conversation_cursor_expired",
    ));
    const listMessages = vi.fn<AppConnectIssueServices["listMessages"]>();
    const snapshot = {
      cursor: 42,
      messages: [{
        id: messageId,
        runId,
        parentMessageId: null,
        body: "Change the title",
        attachments: [],
        author: {
          id: agentId,
          agentId,
          name: "Planner",
          image: null,
          provider: "claude",
        },
        replyCount: 0,
        proposedAction: {
          id: proposalId,
          type: "request_issue_update",
          changes: { title: "New title", description: null },
          changedFields: ["title", "description"],
          status: "pending",
          acceptedAt: null,
          resultRunId: null,
        },
        executionProposal: null,
        skillExecutionProposal: null,
        createdAt: "2026-08-30T01:02:03.000Z",
        updatedAt: "2026-08-30T01:02:04.000Z",
      }],
      agentReplies: [{
        id: replyId,
        triggerMessageId: messageId,
        parentMessageId: messageId,
        agentId,
        agentName: "Planner",
        status: "running",
        attempts: 2,
        workerId: "worker-1",
        provider: "claude",
        error: null,
        updatedAt: "2026-08-30T01:02:05.000Z",
      }],
    };
    listMessages.mockResolvedValueOnce(
      snapshot as Awaited<ReturnType<AppConnectIssueServices["listMessages"]>>,
    );

    const response = await invokeIssueRpc("SyncIssueMessages", {
      projectId,
      runId,
      cursor: "41",
    }, { syncMessages, listMessages });

    expect(response.status).toBe(200);
    expect(syncMessages).toHaveBeenCalledWith(expect.objectContaining({
      projectId,
      runId,
      userId,
      cursor: 41,
    }));
    expect(listMessages).toHaveBeenCalledOnce();
    expect(await response.json()).toMatchObject({
      cursor: "42",
      changed: true,
      reset: true,
      messages: [{
        id: messageId,
        updateProposal: {
          id: proposalId,
          changedFields: [
            "ISSUE_CHANGED_FIELD_TITLE",
            "ISSUE_CHANGED_FIELD_DESCRIPTION",
          ],
        },
      }],
    });
  });

  it("encodes the accepted action oneof and rejects an invalid trusted proposal", async () => {
    const acceptActionProposal = vi.fn<
      AppConnectIssueServices["acceptActionProposal"]
    >();
    acceptActionProposal.mockResolvedValueOnce({
      proposal: {
        id: proposalId,
        type: "request_issue_create",
        issue: {
          title: "Generated follow-up",
          description: null,
          priority: null,
          status: "queued",
        },
        executeAfterCreate: true,
        status: "accepted",
        acceptedAt: "2026-08-30T02:03:04.000Z",
        resultRunId: runId,
      },
      executionProposal: null,
      outcome: "accepted",
      resultRunId: runId,
    } as never);

    const accepted = await invokeIssueRpc("AcceptIssueActionProposal", {
      projectId,
      runId,
      proposalId,
    }, { acceptActionProposal });

    expect(accepted.status).toBe(200);
    const acceptedBody = await accepted.json();
    expect(acceptedBody).toMatchObject({
      create: {
        id: proposalId,
        issue: { title: "Generated follow-up", status: "RUN_STATUS_QUEUED" },
        executeAfterCreate: true,
        status: "PROPOSAL_STATUS_ACCEPTED",
        resultRunId: runId,
      },
      outcome: "APPROVAL_OUTCOME_ACCEPTED",
      resultRunId: runId,
    });
    expect(acceptedBody).not.toHaveProperty("update");

    acceptActionProposal.mockResolvedValueOnce({
      proposal: {
        id: proposalId,
        type: "request_issue_rework",
        workflowStage: "implement",
        reason: "Wrong proposal kind",
        status: "accepted",
        acceptedAt: "2026-08-30T02:03:04.000Z",
        appliedRevision: 2,
      },
      outcome: "accepted",
      resultRunId: runId,
    } as never);
    const invalid = await invokeIssueRpc("AcceptIssueActionProposal", {
      projectId,
      runId,
      proposalId,
    }, { acceptActionProposal });

    expect(invalid.status).toBe(500);
    expect(await invalid.json()).toMatchObject({ code: "internal" });
  });
});
