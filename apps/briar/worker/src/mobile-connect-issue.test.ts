import { createConnectRouter } from "@connectrpc/connect";
import { createFetchHandler } from "@connectrpc/connect/protocol";
import {
  IssueService,
} from "@briar/mobile-contracts/gen/briar/mobile/v1/issue_pb";
import { describe, expect, it, vi } from "vitest";
import type { BriarAuth } from "./auth";
import type { handleIssueConversationRoute } from "./issue-conversation-routes";

import { registerMobileIssueService } from "./mobile-connect-issue";

const projectId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const messageId = "33333333-3333-4333-8333-333333333333";
const proposalId = "44444444-4444-4444-8444-444444444444";
const replyId = "55555555-5555-4555-8555-555555555555";
const agentId = "66666666-6666-4666-8666-666666666666";

const connectRequest = () =>
  new Request(
    "https://api.example.test/briar.mobile.v1.IssueService/ListIssueMessages",
    {
      method: "POST",
      headers: {
        authorization: "Bearer session-token",
        "connect-protocol-version": "1",
        "content-type": "application/json",
      },
      body: JSON.stringify({ projectId, runId }),
    },
  );

describe("mobile Issue Connect adapter", () => {
  it("registers every RPC and preserves a complex conversation response", async () => {
    const conversationRoute = vi.fn<typeof handleIssueConversationRoute>();
    conversationRoute.mockResolvedValueOnce(new Response(JSON.stringify({
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
    }), {
      headers: { "content-type": "application/json" },
    }));

    const router = createConnectRouter({
      connect: true,
      grpc: false,
      grpcWeb: false,
    });
    registerMobileIssueService(router, {
      request: connectRequest(),
      auth: {} as BriarAuth,
      db: {} as D1Database,
      env: {
        ATTACHMENTS: {},
        ARCHIVES: {},
      } as Env,
      routeHandlers: { conversation: conversationRoute },
    });

    expect(router.handlers).toHaveLength(
      Object.keys(IssueService.method).length,
    );
    const handler = router.handlers.find((candidate) =>
      candidate.requestPath ===
        "/briar.mobile.v1.IssueService/ListIssueMessages"
    );
    expect(handler).toBeDefined();

    const response = await createFetchHandler(handler!)(connectRequest());

    expect(response.status).toBe(200);
    expect(conversationRoute).toHaveBeenCalledOnce();
    const routed = conversationRoute.mock.calls[0][0] as {
      request: Request;
    };
    expect(routed.request.method).toBe("GET");
    expect(new URL(routed.request.url).pathname).toBe(
      `/projects/${projectId}/runs/${runId}/messages`,
    );
    expect(routed.request.headers.get("authorization"))
      .toBe("Bearer session-token");
    expect(await response.json()).toEqual({
      cursor: "42",
      messages: [{
        id: messageId,
        runId,
        body: "Change the title",
        author: {
          id: agentId,
          agentId,
          name: "Planner",
          provider: "claude",
        },
        updateProposal: {
          id: proposalId,
          changes: { title: "New title" },
          changedFields: [
            "ISSUE_CHANGED_FIELD_TITLE",
            "ISSUE_CHANGED_FIELD_DESCRIPTION",
          ],
          status: "PROPOSAL_STATUS_PENDING",
        },
        createdAt: "2026-08-30T01:02:03Z",
        updatedAt: "2026-08-30T01:02:04Z",
      }],
      agentReplies: [{
        id: replyId,
        triggerMessageId: messageId,
        parentMessageId: messageId,
        agentId,
        agentName: "Planner",
        status: "REPLY_JOB_STATUS_RUNNING",
        attempts: 2,
        workerId: "worker-1",
        provider: "AGENT_PROVIDER_CLAUDE",
        updatedAt: "2026-08-30T01:02:05Z",
      }],
    });
  });
});
