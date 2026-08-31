import { createConnectRouter } from "@connectrpc/connect";
import {
  createFetchHandler,
  createMethodUrl,
} from "@connectrpc/connect/protocol";
import {
  AgentService,
} from "@briar/contracts/gen/briar/app/v1/agent_pb";
import { describe, expect, it, vi } from "vitest";
import type { BriarAuth } from "./auth";
import { connectErrorInterceptor } from "./app-connect-errors";
import {
  registerAppAgentService,
  type AppConnectAgentServices,
} from "./app-connect-agent";
import { requireConnectHandler } from "./test-helpers/connect";

const repositoryMocks = {
  backfill: vi.fn<AppConnectAgentServices["backfillSessionSummaries"]>(),
  getProject: vi.fn<AppConnectAgentServices["getProject"]>(),
  getCursor: vi.fn<AppConnectAgentServices["getSessionCursor"]>(),
  getTranscript: vi.fn<AppConnectAgentServices["getTranscript"]>(),
  listSummaries: vi.fn<AppConnectAgentServices["listSessionSummaries"]>(),
  requireSession: vi.fn<AppConnectAgentServices["requireSession"]>(),
};

const projectId = "11111111-1111-4111-8111-111111111111";
const agentId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const sessionId = "agent-session-1";

const connectRequest = () => new Request(
  createMethodUrl(
    "https://api.example.test",
    AgentService.method.syncProjectAgentSessions,
  ),
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

describe("app Agent Connect adapter", () => {
  it("projects strict session summary and transcript snapshots", async () => {
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
    repositoryMocks.getTranscript.mockResolvedValue({
      session: {
        session_id: sessionId,
        project_id: projectId,
        run_id: "44444444-4444-4444-8444-444444444444",
        worker_id: "worker-1",
        agent_provider: "codex",
        started_at: "2026-08-30T02:03:00.000Z",
        last_event_at: "2026-08-30T02:03:04.000Z",
        event_count: 2,
        byte_count: 42,
      },
      entries: [{
        session_id: sessionId,
        entry_id: "message-1",
        sequence: 1,
        updated_sequence: 2,
        entry_type: "message",
        activity_kind: null,
        phase: "analysis",
        title: null,
        body: "Contract migrated",
        status: "completed",
        started_at: "2026-08-30T02:03:01.000Z",
        updated_at: "2026-08-30T02:03:02.000Z",
        completed_at: "2026-08-30T02:03:02.000Z",
      }],
    });

    const router = createConnectRouter({
      connect: true,
      grpc: false,
      grpcWeb: false,
      interceptors: [connectErrorInterceptor],
    });
    registerAppAgentService(
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
        getTranscript: repositoryMocks.getTranscript,
        listSessionSummaries: repositoryMocks.listSummaries,
      },
    );

    const handler = requireConnectHandler(
      router.handlers,
      AgentService.method.syncProjectAgentSessions,
    );

    const response = await createFetchHandler(handler)(connectRequest());

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

    const transcriptHandler = requireConnectHandler(
      router.handlers,
      AgentService.method.getProjectAgentTranscript,
    );
    const transcriptResponse = await createFetchHandler(transcriptHandler)(
      new Request(
        createMethodUrl(
          "https://api.example.test",
          AgentService.method.getProjectAgentTranscript,
        ),
        {
          method: "POST",
          headers: {
            "connect-protocol-version": "1",
            "content-type": "application/json",
          },
          body: JSON.stringify({ projectId, sessionId }),
        },
      ),
    );
    expect(transcriptResponse.status).toBe(200);
    expect(repositoryMocks.getTranscript).toHaveBeenCalledWith({
      db: {},
      archives: {},
      projectId,
      selector: { sessionId },
    });
    expect(await transcriptResponse.json()).toEqual({
      session: {
        sessionId,
        runId: "44444444-4444-4444-8444-444444444444",
        workerId: "worker-1",
        agentProvider: "AGENT_PROVIDER_CODEX",
        startedAt: "2026-08-30T02:03:00Z",
        lastEventAt: "2026-08-30T02:03:04Z",
      },
      entries: [{
        entryId: "message-1",
        sequence: "1",
        updatedSequence: "2",
        status: "PROJECT_AGENT_WORK_LOG_ENTRY_STATUS_COMPLETED",
        startedAt: "2026-08-30T02:03:01Z",
        updatedAt: "2026-08-30T02:03:02Z",
        completedAt: "2026-08-30T02:03:02Z",
        message: { phase: "analysis", text: "Contract migrated" },
      }],
    });
  });
});
