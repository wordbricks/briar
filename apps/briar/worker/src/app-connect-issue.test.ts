import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import {
  Code,
  createClient,
  createRouterTransport,
} from "@connectrpc/connect";
import {
  IssueDifficulty,
  RunStatus,
} from "@briar/contracts/gen/briar/app/v1/common_pb";
import { IssueService } from "@briar/contracts/gen/briar/app/v1/issue_pb";
import {
  WorkflowCheckpoint_Position,
} from "@briar/contracts/gen/briar/types/v1/workflow_pb";
import { describe, expect, it, vi } from "vitest";
import type { BriarAuth } from "./auth";
import { connectErrorInterceptor } from "./app-connect-errors";
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

const createIssueClient = (
  overrides: Partial<AppConnectIssueServices>,
) => {
  const context = createExecutionContext();
  const services: AppConnectIssueServices = {
    ...appConnectIssueServices,
    requireSession: vi.fn().mockResolvedValue(authenticatedSession),
    ...overrides,
  };
  const transport = createRouterTransport(
    (router) =>
      registerAppIssueService(router, {
        request: new Request("https://api.example.test"),
        auth: {} as BriarAuth,
        db: env.DB,
        env,
        context,
      }, services),
    {
      router: {
        grpc: false,
        grpcWeb: false,
        interceptors: [connectErrorInterceptor],
      },
    },
  );
  return {
    client: createClient(IssueService, transport),
    flushBackgroundTasks: () => waitOnExecutionContext(context),
  };
};

describe("app Issue Connect adapter", () => {
  it("maps generated workflow and upload input without a parallel wire type", async () => {
    const createIssue = vi.fn<AppConnectIssueServices["createIssue"]>();
    createIssue.mockResolvedValueOnce({
      runId,
      sourceKey: "BR-1",
      status: "backlog",
      stage: "queued",
      assigneeUserId: null,
      createdByUserId: userId,
      difficulty: "normal",
      attachments: [],
    });
    const { client, flushBackgroundTasks } = createIssueClient({ createIssue });

    const result = await client.createIssue({
      projectId,
      title: "Preserve wire input",
      status: RunStatus.BACKLOG,
      checkpoints: [{
        key: "review",
        stage: "implement",
        position: WorkflowCheckpoint_Position.AFTER,
      }],
      clientIssueId: runId,
      attachments: [{ uploadId: attachmentId.toUpperCase() }],
    });
    await flushBackgroundTasks();

    expect(createIssue).toHaveBeenCalledWith(expect.objectContaining({
      projectId,
      userId,
      clientIssueId: runId,
      attachmentIds: [attachmentId],
      request: expect.objectContaining({
        status: "backlog",
        checkpoints: [{
          key: "review",
          stage: "implement",
          position: "after",
        }],
      }),
    }));
    expect(result).toMatchObject({
      runId,
      status: RunStatus.BACKLOG,
      difficulty: IssueDifficulty.NORMAL,
    });
  });

  it("preserves oneof and message-presence semantics for issue patches", async () => {
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
    const { client, flushBackgroundTasks } = createIssueClient({ updateIssue });

    const cleared = await client.updateIssue({
      projectId,
      runId,
      requestId: messageId,
      title: "Updated issue",
      assigneeUpdate: { case: "clearAssignee", value: {} },
      keptAttachmentIds: { values: [] },
    });
    await flushBackgroundTasks();

    expect(updateIssue.mock.calls[0]?.[0]).toMatchObject({
      requestId: messageId,
      request: { assigneeUserId: null },
      attachmentIds: [],
      keptAttachmentIds: [],
    });
    expect(cleared.attachments[0]?.byteSize).toBe(12n);

    await client.updateIssue({
      projectId,
      runId,
      requestId: proposalId,
      title: "Updated issue",
    });
    await flushBackgroundTasks();
    const unchanged = updateIssue.mock.calls[1]?.[0];
    expect(unchanged?.request).not.toHaveProperty("assigneeUserId");
    expect(unchanged?.keptAttachmentIds).toBeUndefined();
  });

  it("turns an expired delta into an authoritative typed reset snapshot", async () => {
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
    const { client } = createIssueClient({ syncMessages, listMessages });

    const result = await client.syncIssueMessages({
      projectId,
      runId,
      cursor: 41n,
    });

    expect(syncMessages).toHaveBeenCalledWith(expect.objectContaining({
      projectId,
      runId,
      userId,
      cursor: 41,
    }));
    expect(listMessages).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      cursor: 42n,
      changed: true,
      reset: true,
      messages: [{
        id: messageId,
        proposedAction: {
          case: "updateProposal",
          value: { id: proposalId },
        },
      }],
    });
  });

  it("encodes the trusted action union and fails closed on a wrong proposal kind", async () => {
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
          status: "backlog",
        },
        executeAfterCreate: true,
        status: "accepted",
        acceptedAt: "2026-08-30T02:03:04.000Z",
        resultRunId: runId,
      },
      executionProposal: null,
      outcome: "accepted",
      resultRunId: runId,
    });
    const { client, flushBackgroundTasks } = createIssueClient({
      acceptActionProposal,
    });

    const accepted = await client.acceptIssueActionProposal({
      projectId,
      runId,
      proposalId,
    });
    await flushBackgroundTasks();

    expect(accepted.proposal).toMatchObject({
      case: "create",
      value: {
        id: proposalId,
        issue: { title: "Generated follow-up", status: RunStatus.BACKLOG },
      },
    });

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

    await expect(client.acceptIssueActionProposal({
      projectId,
      runId,
      proposalId,
    })).rejects.toMatchObject({ code: Code.Internal });
    await flushBackgroundTasks();
  });
});
