import { createConnectRouter } from "@connectrpc/connect";
import { createFetchHandler } from "@connectrpc/connect/protocol";
import {
  AgentService,
} from "@briar/mobile-contracts/gen/briar/mobile/v1/agent_pb";
import { describe, expect, it, vi } from "vitest";
import type { BriarAuth } from "./auth";
import {
  registerMobileAgentService,
  type MobileConnectAgentServices,
} from "./mobile-connect-agent";

const repositoryMocks = {
  backfill: vi.fn<MobileConnectAgentServices["backfillSessionSummaries"]>(),
  getProject: vi.fn<MobileConnectAgentServices["getProject"]>(),
  getCursor: vi.fn<MobileConnectAgentServices["getSessionCursor"]>(),
  listSummaries: vi.fn<MobileConnectAgentServices["listSessionSummaries"]>(),
  requireSession: vi.fn<MobileConnectAgentServices["requireSession"]>(),
};

const projectId = "11111111-1111-4111-8111-111111111111";
const agentId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const sessionId = "agent-session-1";

const connectRequest = () => new Request(
  "https://api.example.test/briar.mobile.v1.AgentService/SyncProjectAgentSessions",
  {
    method: "POST",
    headers: {
      authorization: "Bearer session-token",
      "connect-protocol-version": "1",
      "content-type": "application/json",
    },
    body: JSON.stringify({ projectId }),
  },
);

describe("mobile Agent Connect adapter", () => {
  it("registers every RPC and projects a strict session summary snapshot", async () => {
    repositoryMocks.requireSession.mockResolvedValue({
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
    });
    repositoryMocks.getProject.mockResolvedValue({
      id: projectId,
      name: "Briar",
      issue_key_prefix: "BR",
      schedule_tab_enabled: 1,
      icon: null,
      organization_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      organization_name: "Briar Org",
      member_role: "owner",
      created_at: "2026-08-30T00:00:00.000Z",
    });
    repositoryMocks.getCursor.mockResolvedValue(17);
    repositoryMocks.listSummaries.mockResolvedValue([{
      project_id: projectId,
      session_id: sessionId,
      archived: 0,
      updated_at: "2026-08-30T02:03:04.000Z",
      summary_json: JSON.stringify({
        dispatchGroupId: sessionId,
        agentId,
        agentName: "Planner",
        skillId: null,
        sessionType: "task",
        trigger: "manual",
        scheduleId: null,
        scheduleRunId: null,
        parentSessionId: null,
        request: "Implement the migration",
        status: "running",
        issues: [{
          runId: "run-1",
          runNumber: 3,
          sourceKey: "BR-3",
          title: "Connect RPC",
          outcome: "pending",
          summary: null,
        }],
        startedAt: "2026-08-30T02:03:00.000Z",
        completedAt: null,
        requestedWorkerId: "worker-1",
        workerId: "worker-1",
        updatedAt: "2026-08-30T02:03:04.000Z",
        requestedByUserId: userId,
        inboxVersion: "ignored-server-projection",
      }),
    }]);

    const router = createConnectRouter({
      connect: true,
      grpc: false,
      grpcWeb: false,
    });
    registerMobileAgentService(
      router,
      {
        request: connectRequest(),
        auth: {} as BriarAuth,
        db: {} as D1Database,
        env: { ARCHIVES: {} } as Env,
      },
      {
        requireSession: repositoryMocks.requireSession,
        getProject: repositoryMocks.getProject,
        backfillSessionSummaries: repositoryMocks.backfill,
        getSessionCursor: repositoryMocks.getCursor,
        listSessionSummaries: repositoryMocks.listSummaries,
      },
    );

    expect(router.handlers).toHaveLength(Object.keys(AgentService.method).length);
    const handler = router.handlers.find((candidate) =>
      candidate.requestPath ===
        "/briar.mobile.v1.AgentService/SyncProjectAgentSessions"
    );
    expect(handler).toBeDefined();

    const response = await createFetchHandler(handler!)(connectRequest());

    expect(response.status).toBe(200);
    expect(repositoryMocks.backfill).toHaveBeenCalledWith(
      {},
      {},
      projectId,
    );
    expect(await response.json()).toEqual({
      cursor: "17",
      reset: true,
      sessions: [{
        id: sessionId,
        projectId,
        dispatchGroupId: sessionId,
        agentId,
        agentName: "Planner",
        sessionType: "PROJECT_AGENT_SESSION_TYPE_TASK",
        trigger: "PROJECT_AGENT_SESSION_TRIGGER_MANUAL",
        request: "Implement the migration",
        status: "PROJECT_AGENT_SESSION_STATUS_RUNNING",
        issues: [{
          runId: "run-1",
          runNumber: 3,
          sourceKey: "BR-3",
          title: "Connect RPC",
          outcome: "PROJECT_AGENT_SESSION_ISSUE_OUTCOME_PENDING",
        }],
        startedAt: "2026-08-30T02:03:00Z",
        requestedWorkerId: "worker-1",
        workerId: "worker-1",
        requestedByUserId: userId,
        updatedAt: "2026-08-30T02:03:04Z",
      }],
    });
  });
});
