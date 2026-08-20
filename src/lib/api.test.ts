import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  addIssueDependency,
  acceptChannelProposal,
  acceptChannelExecutionProposal,
  acceptChannelSkillExecutionProposal,
  acceptIssueExecutionProposal,
  acceptIssueSkillExecutionProposal,
  beginDeviceAuthorization,
  claimProjectAgentScheduleRuns,
  completeProjectAgentScheduleRun,
  completeIssueResultReview,
  createChannel,
  createChannelWebhook,
  createIssue,
  createIssueMessage,
  createOrganizationInvitation,
  createProjectAgent,
  createProjectAgentSchedule,
  deleteChannel,
  deleteProjectAgent,
  deleteIssue,
  transferIssue,
  dispatchHuntRun,
  errorWithMessage,
  deleteProjectAgentSchedule,
  loadDashboard,
  loadChannelMessageDocument,
  loadDashboardDelta,
  loadIssueConversationDelta,
  loadIssueConversationSnapshot,
  loadInboxFeed,
  loadStatusTrayRuns,
  loadAgentUsageReport,
  loadAgentUsageRuns,
  loadProjectAgentSessions,
  loadProjectAgentSessionChanges,
  loadProjectAgentScheduleRuns,
  loadProjectAgents,
  loadProjectUsageSummary,
  loadRunEvidence,
  loadRunEvidenceImage,
  loadRunEvents,
  listChannelWebhooks,
  removeIssueDependency,
  revokeChannelWebhook,
  rotateChannelWebhook,
  runProjectAgentTaskOnWorker,
  sendChannelMessage,
  reworkPausedHuntRun,
  setChannelMember,
  updateProjectAgent,
  updateProjectAgentSchedule,
  updateOrganizationMemberRole,
  updateChannelWebhook,
  updateIssue,
  updateIssueCheckpoints,
  updateIssueExecutionPreferences,
  updateChannelThreadSubscription,
  updateIssueSubscription,
  updateProjectSettings,
  upsertProjectAgentSession,
} from "./api";
import { cloneAutoHuntWorkflow } from "./auto-hunt-contract";
import { demoDashboard, demoRunEvents } from "./demo-data";
import {
  errorDiagnosticOccurrenceKey,
  errorDiagnosticsForMessage,
} from "./error-diagnostics";
import type { AgentSkillExecutionProposal } from "../types";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API error diagnostics", () => {
  it("records request context for a transport failure", async () => {
    const error = new TypeError("diagnostic-api-load-failed");
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw error;
    }));

    await expect(loadDashboard("token", "project-1")).rejects.toBe(error);

    expect(errorDiagnosticOccurrenceKey(error.message)).not.toBeNull();
    const details = errorDiagnosticsForMessage(error.message);
    expect(details).toContain("Scope: api_request");
    expect(details).toContain("Request method: GET");
    expect(details).toContain("Request path: /projects/<redacted>/dashboard");
  });
});

describe("Project settings", () => {
  it("omits read-only checkpoint policy when updating project settings", async () => {
    const fetchMock = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) =>
      new Response(JSON.stringify({ settings: demoDashboard.settings }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await updateProjectSettings(
      "token",
      "project-1",
      demoDashboard.settings,
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).not.toHaveProperty("checkpointPolicy");
    expect(body).toEqual({
      velenOrg: demoDashboard.settings.velenOrg,
      dataSource: demoDashboard.settings.dataSource,
      linear: demoDashboard.settings.linear,
      githubRepository: demoDashboard.settings.githubRepository,
      workflow: demoDashboard.settings.workflow,
    });
  });
});

describe("API errors", () => {
  it("accepts a channel proposal in the selected project", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        outcome: "accepted",
        projectId: "project-2",
        resultRunId: "run-2",
      }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      acceptChannelProposal(
        "token",
        "organization-1",
        "channel-1",
        "proposal-1",
        "project-2",
      ),
    ).resolves.toEqual({
      outcome: "accepted",
      projectId: "project-2",
      resultRunId: "run-2",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/organizations/organization-1/channels/channel-1/proposals/proposal-1/accept",
      ),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ projectId: "project-2" }),
      }),
    );
  });

  it("submits create-and-execute settings in the same channel approval", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        outcome: "accepted",
        projectId: "project-2",
        resultRunId: "run-2",
        executionProposal: { id: "execution-2", status: "accepted" },
        dispatch: { runId: "run-2", outcome: "dispatched" },
      }), { headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const execution = {
      provider: "codex" as const,
      model: "gpt-5.6-sol",
      effort: "high" as const,
      workerId: "worker-1",
    };

    await acceptChannelProposal(
      "token",
      "organization-1",
      "channel-1",
      "proposal-1",
      "project-2",
      execution,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ projectId: "project-2", execution }),
      }),
    );
  });

  it("sends only user-selected settings for channel execution approval", async () => {
    const response = {
      proposal: { id: "execution-1", status: "accepted" },
      outcome: "accepted",
      projectId: "project-1",
      runId: "run-1",
      dispatch: { outcome: "dispatched" },
    };
    const fetchMock = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => new Response(JSON.stringify(response), {
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const input = {
      provider: "codex" as const,
      model: "gpt-5.6-sol",
      effort: "xhigh" as const,
      workerId: "worker-1",
    };

    await expect(acceptChannelExecutionProposal(
      "token",
      "organization-1",
      "channel-1",
      "execution-1",
      input,
    )).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/organizations/organization-1/channels/channel-1/proposals/execution-1/accept-execution",
      ),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)))
      .not.toHaveProperty("requestId");
  });

  it("keeps the conversation run and execution proposal IDs distinct", async () => {
    const fetchMock = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => new Response(JSON.stringify({
      proposal: { id: "execution-1", status: "accepted" },
      outcome: "accepted",
      projectId: "project-1",
      runId: "target-run",
      dispatch: { outcome: "dispatched" },
    }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await acceptIssueExecutionProposal(
      "token",
      "project-1",
      "conversation-run",
      "execution-1",
      { provider: "claude", model: "opus", effort: "high", workerId: null },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/projects/project-1/runs/conversation-run/issue-execution-proposals/execution-1/accept",
      ),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          provider: "claude",
          model: "opus",
          effort: "high",
          workerId: null,
        }),
      }),
    );
  });

  it("accepts a saved Skill only with exact immutable evidence and a canonical session", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const agentId = "22222222-2222-4222-8222-222222222222";
    const skillId = "33333333-3333-4333-8333-333333333333";
    const pending: AgentSkillExecutionProposal = {
      id: "proposal-skill-1",
      type: "request_agent_skill_execute",
      status: "pending",
      projectId,
      agentId,
      agentName: "Release Agent",
      skillId,
      skillName: "iOS deploy",
      request: "Ship the iOS app",
      provider: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
      createdAt: "2026-08-11T00:00:00.000Z",
      acceptedAt: null,
      requestedWorkerId: null,
      requestedWorkerLabel: null,
      resultSessionId: null,
      delegatedByAgentId: null,
      delegatedByAgentName: null,
    };
    const accepted = {
      ...pending,
      status: "accepted" as const,
      acceptedAt: "2026-08-11T00:01:00.000Z",
      requestedWorkerId: "worker-1",
      requestedWorkerLabel: "Build Mac",
      resultSessionId: "session-1",
    };
    const session = {
      id: "session-1",
      projectId,
      dispatchGroupId: "session-1",
      agentId,
      agentName: "Release Agent",
      skillId,
      sessionType: "task",
      trigger: "manual",
      scheduleId: null,
      scheduleRunId: null,
      parentSessionId: null,
      request: pending.request,
      status: "running",
      issues: [],
      startedAt: "2026-08-11T00:01:00.000Z",
      completedAt: null,
      conversationId: null,
      workspaceRoot: null,
      requestedWorkerId: "worker-1",
      workerId: "worker-1",
      summary: null,
      error: null,
      events: [],
      dispatchEvents: [],
      workers: [],
      updatedAt: "2026-08-11T00:01:00.000Z",
    };
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        outcome: "accepted",
        proposal: accepted,
        projectId,
        session,
      }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(acceptChannelSkillExecutionProposal(
      "token",
      "organization-1",
      "channel-1",
      pending,
      { workerId: "worker-1" },
    )).resolves.toEqual(expect.objectContaining({
      proposal: accepted,
      session: expect.objectContaining({ id: "session-1", localOwner: false }),
    }));
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/organizations/organization-1/channels/channel-1/skill-execution-proposals/proposal-skill-1/accept",
      ),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ workerId: "worker-1" }),
      }),
    );

    fetchMock.mockImplementationOnce(async () =>
      new Response(JSON.stringify({
        outcome: "accepted",
        proposal: { ...accepted, skillName: "Tampered Skill" },
        projectId,
        session,
      }), { headers: { "Content-Type": "application/json" } }));
    await expect(acceptIssueSkillExecutionProposal(
      "token",
      projectId,
      "conversation-run",
      pending,
      { workerId: "worker-1" },
    )).rejects.toThrow("inconsistent immutable evidence");
  });

  it("adds a member to a channel with the member role", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ members: [] }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await setChannelMember(
      "token",
      "organization-1",
      "channel-1",
      "user/1",
      true,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/organizations/organization-1/channels/channel-1/members/user%2F1",
      ),
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ role: "member" }),
      }),
    );
  });

  it("preserves API validation metadata when adding context to an error", () => {
    const original = new ApiError(
      400,
      "Invalid project workflow",
      "INVALID_PROJECT_WORKFLOW",
      ["version 2 execution.checkpoints is required"],
    );

    expect(errorWithMessage(original, `${original.message} (cleanup failed)`))
      .toMatchObject({
        name: "ApiError",
        status: 400,
        message: "Invalid project workflow (cleanup failed)",
        code: "INVALID_PROJECT_WORKFLOW",
        issues: ["version 2 execution.checkpoints is required"],
      });
  });

  it("requests paused rework with exact checkpoint identity and feedback", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          runId: "run-1",
          outcome: "reworked",
          attempt: 1,
          revision: 2,
          workflowStage: "local_qa",
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      reworkPausedHuntRun(
        "token",
        "project-1",
        "run-1",
        {
          workflowStage: "local_qa",
          reason: "결과 탭의 문구를 수정하고 다시 검증해 주세요.",
          checkpoint: { key: "after-local-qa", attempt: 1, revision: 1 },
        },
        "11111111-1111-4111-8111-111111111111",
      ),
    ).resolves.toMatchObject({ outcome: "reworked", revision: 2 });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/projects/project-1/runs/run-1/rework"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          requestId: "11111111-1111-4111-8111-111111111111",
          workflowStage: "local_qa",
          reason: "결과 탭의 문구를 수정하고 다시 검증해 주세요.",
          checkpointKey: "after-local-qa",
          attempt: 1,
          revision: 1,
        }),
      }),
    );
  });

  it("passes the selected method, locale, and account-switch choice", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              device_code: "device-code",
              user_code: "USER-CODE",
              verification_uri_complete:
                "https://briar-api.example/device?user_code=USER-CODE",
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    await expect(
      beginDeviceAuthorization("briar-web", {
        method: "email",
        locale: "zh",
        switchAccount: true,
      }),
    ).resolves.toMatchObject({
      verificationUrl:
        "https://briar-api.example/device?user_code=USER-CODE&client=web&method=email&locale=zh&switch_account=1",
    });
  });

  it("builds a shareable web invitation URL from the server path", async () => {
    const invitation = {
      id: "invitation-1",
      organizationId: "organization-1",
      organizationName: "Briar",
      initialProjectId: "project-1",
      initialProjectName: "Website",
      email: "invitee@example.com",
      emailHint: "i***@example.com",
      role: "member" as const,
      status: "pending" as const,
      expiresAt: "2026-08-10T00:00:00.000Z",
      acceptedAt: null,
      createdAt: "2026-08-03T00:00:00.000Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              invitation,
              invitePath: "/app/invitations/briar_invite_example",
            }),
            { status: 201, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    await expect(
      createOrganizationInvitation("token", "organization-1", {
        email: invitation.email,
        initialProjectId: invitation.initialProjectId,
        role: invitation.role,
      }),
    ).resolves.toEqual({
      invitation,
      inviteUrl:
        "https://briar.wordbricks.ai/app/invitations/briar_invite_example",
    });
  });

  it("updates an issue through its project-scoped run endpoint", async () => {
    const projectId = "22222222-2222-4222-8222-222222222222";
    const runId = "11111111-1111-4111-8111-111111111111";
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Response(
          JSON.stringify({
            runId,
            ...JSON.parse(String(init?.body)),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      updateIssue("token", projectId, runId, {
        title: "Updated issue",
        description: "Updated description",
        priority: 1,
        attachments: [],
      }),
    ).resolves.toEqual({
      runId,
      title: "Updated issue",
      description: "Updated description",
      priority: 1,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/projects/${projectId}/runs/${runId}`),
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          title: "Updated issue",
          description: "Updated description",
          priority: 1,
        }),
      }),
    );
  });

  it("uploads issue update attachments as multipart form data", async () => {
    const projectId = "22222222-2222-4222-8222-222222222222";
    const runId = "11111111-1111-4111-8111-111111111111";
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const form = init?.body instanceof FormData ? init.body : new FormData();
        return new Response(
          JSON.stringify({
            runId,
            title: form.get("title"),
            description: form.get("description"),
            priority: Number(form.get("priority")),
            assigneeUserId: null,
            attachments: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const image = new File(["image"], "inline.png", { type: "image/png" });
    const reference = "draft-inline-1";

    const result = await updateIssue("token", projectId, runId, {
      title: "Updated issue",
      description: `![inline.png](briar-attachment://${reference})`,
      priority: 1,
      attachments: [image],
      attachmentReferences: [reference],
      keptAttachmentIds: [],
    });
    expect(result).toMatchObject({
      runId,
      title: "Updated issue",
      priority: 1,
    });
    const [calledUrl, init] = fetchMock.mock.calls[0]!;
    expect(String(calledUrl)).toContain(
      `/projects/${projectId}/runs/${runId}`,
    );
    expect(init?.method).toBe("PATCH");
    const body = init?.body as FormData;
    expect(body.get("title")).toBe("Updated issue");
    expect(body.get("attachmentReferences")).toBe(
      JSON.stringify([reference]),
    );
    expect(body.get("keptAttachmentIds")).toBe(JSON.stringify([]));
    const uploaded = body.getAll("attachments") as File[];
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]?.name).toBe("inline.png");
  });

  it("toggles the current member's issue subscription", async () => {
    const projectId = "22222222-2222-4222-8222-222222222222";
    const runId = "11111111-1111-4111-8111-111111111111";
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ runId, subscribers: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await updateIssueSubscription("token", projectId, runId, true);
    await updateIssueSubscription("token", projectId, runId, false);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(`/projects/${projectId}/runs/${runId}/subscription`),
      expect.objectContaining({ method: "PUT" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(`/projects/${projectId}/runs/${runId}/subscription`),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("toggles the current member's channel thread subscription", async () => {
    const organizationId = "11111111-1111-4111-8111-111111111111";
    const channelId = "22222222-2222-4222-8222-222222222222";
    const messageId = "33333333-3333-4333-8333-333333333333";
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ rootMessageId: messageId, subscribers: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await updateChannelThreadSubscription(
      "token",
      organizationId,
      channelId,
      messageId,
      true,
    );
    await updateChannelThreadSubscription(
      "token",
      organizationId,
      channelId,
      messageId,
      false,
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(
        `/organizations/${organizationId}/channels/${channelId}/messages/${messageId}/subscription`,
      ),
      expect.objectContaining({ method: "PUT" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(
        `/organizations/${organizationId}/channels/${channelId}/messages/${messageId}/subscription`,
      ),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("records a result review through the project-scoped run endpoint", async () => {
    const projectId = "22222222-2222-4222-8222-222222222222";
    const runId = "11111111-1111-4111-8111-111111111111";
    const review = {
      userId: "reviewer-1",
      name: "Reviewer",
      username: "reviewer",
      image: null,
      completedAt: "2026-08-02T01:00:00.000Z",
    };
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(review), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      completeIssueResultReview("token", projectId, runId),
    ).resolves.toEqual(review);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        `/projects/${projectId}/runs/${runId}/result-reviews`,
      ),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("deletes an issue through its project-scoped run endpoint", async () => {
    const projectId = "22222222-2222-4222-8222-222222222222";
    const runId = "11111111-1111-4111-8111-111111111111";
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteIssue("token", projectId, runId)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/projects/${projectId}/runs/${runId}`),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("transfers an issue through its project-scoped transfer endpoint", async () => {
    const projectId = "22222222-2222-4222-8222-222222222222";
    const targetProjectId = "33333333-3333-4333-8333-333333333333";
    const runId = "11111111-1111-4111-8111-111111111111";
    const response = {
      runId,
      sourceProjectId: projectId,
      targetProjectId,
      outcome: "transferred",
    };
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      transferIssue("token", projectId, runId, targetProjectId),
    ).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        `/projects/${projectId}/runs/${runId}/transfer`,
      ),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ targetProjectId }),
      }),
    );
  });

  it("adds and removes an issue prerequisite through the dependency endpoint", async () => {
    const projectId = "22222222-2222-4222-8222-222222222222";
    const dependentRunId = "11111111-1111-4111-8111-111111111111";
    const prerequisiteRunId = "33333333-3333-4333-8333-333333333333";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            dependentRunId,
            prerequisiteRunId,
            outcome: "created",
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      addIssueDependency(
        "token",
        projectId,
        dependentRunId,
        prerequisiteRunId,
      ),
    ).resolves.toMatchObject({ outcome: "created" });
    await expect(
      removeIssueDependency(
        "token",
        projectId,
        dependentRunId,
        prerequisiteRunId,
      ),
    ).resolves.toBeUndefined();

    const endpoint = `/projects/${projectId}/runs/${dependentRunId}/dependencies/${prerequisiteRunId}`;
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(endpoint),
      expect.objectContaining({ method: "PUT" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(endpoint),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("sends preferred provider and model when creating an issue without attachments", async () => {
    const projectId = "22222222-2222-4222-8222-222222222222";
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            runId: "11111111-1111-4111-8111-111111111111",
            sourceKey: "briar-issue:test",
            stage: "queued",
            status: "queued",
            assigneeUserId: null,
            attachments: [],
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createIssue("token", projectId, {
      title: "선호 실행 이슈",
      description: null,
      priority: 2,
      status: "queued",
      attachments: [],
      preferredProvider: "claude",
      preferredModel: "sonnet",
      preferredEffort: "high",
      fullAuto: true,
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      title: "선호 실행 이슈",
      preferredProvider: "claude",
      preferredModel: "sonnet",
      preferredEffort: "high",
      fullAuto: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/projects/${projectId}/issues`),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("updates issue execution preferences independently of issue content", async () => {
    const projectId = "22222222-2222-4222-8222-222222222222";
    const runId = "11111111-1111-4111-8111-111111111111";
    const preferences = {
      provider: "codex" as const,
      model: "gpt-5.6-sol",
      effort: "xhigh" as const,
    };
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Response(
          JSON.stringify({ runId, ...JSON.parse(String(init?.body)) }),
          { headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      updateIssueExecutionPreferences(
        "token",
        projectId,
        runId,
        preferences,
      ),
    ).resolves.toEqual({ runId, ...preferences });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        `/projects/${projectId}/runs/${runId}/preferences`,
      ),
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify(preferences),
      }),
    );
  });

  it("updates issue-specific checkpoints independently of issue content", async () => {
    const projectId = "22222222-2222-4222-8222-222222222222";
    const runId = "11111111-1111-4111-8111-111111111111";
    const checkpoints = [{
      key: "issue-after-local_qa",
      stage: "local_qa",
      position: "after" as const,
    }];
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ runId, checkpoints }), {
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      updateIssueCheckpoints("token", projectId, runId, checkpoints),
    ).resolves.toEqual({ runId, checkpoints });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        `/projects/${projectId}/runs/${runId}/checkpoints`,
      ),
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ checkpoints }),
      }),
    );
  });

  it("sends model and effort when dispatching an issue now", async () => {
    const projectId = "22222222-2222-4222-8222-222222222222";
    const runId = "11111111-1111-4111-8111-111111111111";
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            runId,
            agentId: null,
            provider: "claude",
            model: "opus",
            effort: "high",
            requestedWorkerId: null,
            requestedByUserId: "owner",
            dispatchMode: "any",
            dispatchedAt: "2026-07-31T00:00:00.000Z",
            outcome: "dispatched",
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await dispatchHuntRun("token", projectId, runId, {
      provider: "claude",
      model: "opus",
      effort: "high",
      workerId: null,
      persistPreferences: true,
    });
    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
    );
    expect(body).toMatchObject({
      provider: "claude",
      model: "opus",
      effort: "high",
      persistPreferences: true,
    });
    expect(body).not.toHaveProperty("agentId");
  });

  it("returns a durable worker reply job for a Project Agent mention", async () => {
    const projectId = "22222222-2222-4222-8222-222222222222";
    const runId = "11111111-1111-4111-8111-111111111111";
    const message = {
      id: "33333333-3333-4333-8333-333333333333",
      runId,
      parentMessageId: null,
      body: "@developer summarize this",
      author: { id: "owner", name: "Owner", image: null, provider: null },
      replyCount: 0,
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:00.000Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            message,
            agentReply: {
              id: "44444444-4444-4444-8444-444444444444",
              triggerMessageId: message.id,
              status: "queued",
              error: null,
            },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(
      createIssueMessage("token", projectId, runId, {
        body: message.body,
        parentMessageId: null,
      }),
    ).resolves.toEqual({
      message,
      agentReply: expect.objectContaining({ status: "queued" }),
    });
  });

  it("loads issue conversations through snapshot and cursor delta endpoints", async () => {
    const projectId = "22222222-2222-4222-8222-222222222222";
    const runId = "11111111-1111-4111-8111-111111111111";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        cursor: 7,
        messages: [],
        agentReplies: [],
      }), { headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        cursor: 9,
        hasMore: false,
        changed: false,
      }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      loadIssueConversationSnapshot("token", projectId, runId),
    ).resolves.toEqual({ cursor: 7, messages: [], agentReplies: [] });
    await expect(
      loadIssueConversationDelta("token", projectId, runId, 7),
    ).resolves.toEqual({ cursor: 9, hasMore: false, changed: false });

    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      `/projects/${projectId}/runs/${runId}/messages`,
    );
    expect(fetchMock.mock.calls[1]?.[0]).toContain(
      `/projects/${projectId}/runs/${runId}/messages/delta?cursor=7`,
    );
  });

  it("canonicalizes parent message IDs in JSON replies", async () => {
    const parentMessageId = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
    const clientMessageId = "CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        clientMessageId: clientMessageId.toLowerCase(),
        parentMessageId: parentMessageId.toLowerCase(),
      });
      return new Response(
        JSON.stringify({
          message: {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            runId: "11111111-1111-4111-8111-111111111111",
            parentMessageId: parentMessageId.toLowerCase(),
            body: "답글",
            author: { id: "owner", name: "Owner", image: null, provider: null },
            replyCount: 0,
            createdAt: "2026-08-08T00:00:00.000Z",
            updatedAt: "2026-08-08T00:00:00.000Z",
          },
          agentReply: null,
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await createIssueMessage("token", "project-1", "11111111-1111-4111-8111-111111111111", {
      body: "답글",
      clientMessageId,
      parentMessageId,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("uploads pasted conversation images as multipart form data", async () => {
    const projectId = "22222222-2222-4222-8222-222222222222";
    const runId = "11111111-1111-4111-8111-111111111111";
    const reference = crypto.randomUUID();
    const clientMessageId = crypto.randomUUID();
    const image = new File(["image"], "clipboard.png", { type: "image/png" });
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const form = init?.body as FormData;
      expect(form).toBeInstanceOf(FormData);
      expect(form.get("body")).toContain(`briar-attachment://${reference}`);
      expect(form.get("attachmentReferences")).toBe(JSON.stringify([reference]));
      expect(form.get("clientMessageId")).toBe(clientMessageId);
      expect(form.getAll("attachments")).toEqual([image]);
      return new Response(
        JSON.stringify({
          message: {
            id: crypto.randomUUID(),
            runId,
            parentMessageId: null,
            body: String(form.get("body")),
            attachments: [],
            author: { id: "owner", name: "Owner", image: null, provider: null },
            replyCount: 0,
            createdAt: "2026-08-05T00:00:00.000Z",
            updatedAt: "2026-08-05T00:00:00.000Z",
          },
          agentReply: null,
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await createIssueMessage("token", projectId, runId, {
      body: `스크린샷\n\n![clipboard.png](briar-attachment://${reference})`,
      clientMessageId,
      parentMessageId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
      attachments: [image],
      attachmentReferences: [reference],
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const form = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(form.get("parentMessageId")).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });

  it("loads synchronized agent sessions as remote-owned snapshots", async () => {
    const projectId = "22222222-2222-4222-8222-222222222222";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({
          sessions: [{
            id: "session-1",
            projectId,
            dispatchGroupId: "",
            agentId: null,
            sessionType: "task",
            trigger: "manual",
            scheduleId: null,
            scheduleRunId: null,
            parentSessionId: null,
            request: "Review the repository",
            status: "skipped",
            issues: [],
            startedAt: "2026-07-30T00:00:00.000Z",
            completedAt: "2026-07-30T00:01:00.000Z",
            conversationId: null,
            workspaceRoot: null,
            summary: "No queued issues.",
            error: null,
            events: [{
              id: "event-1",
              type: "skipped",
              occurredAt: "2026-07-30T00:01:00.000Z",
            }],
            dispatchEvents: [],
            workers: [],
            updatedAt: "2026-07-30T00:00:00.000Z",
          }],
        }), {
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(loadProjectAgentSessions("token", projectId)).resolves.toEqual([
      expect.objectContaining({
        id: "session-1",
        status: "skipped",
        localOwner: false,
      }),
    ]);
  });

  it("uses the Agent session cursor and ETag for unchanged polls", async () => {
    const projectId = "22222222-2222-4222-8222-222222222222";
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("If-None-Match")).toBe(
        '"project-agent-sessions:project:7"',
      );
      return new Response(null, {
        status: 304,
        headers: { ETag: '"project-agent-sessions:project:7"' },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadProjectAgentSessionChanges("token", projectId, {
      cursor: 7,
      etag: '"project-agent-sessions:project:7"',
    })).resolves.toMatchObject({
      state: { cursor: 7 },
      notModified: true,
      sessions: [],
      deletedSessionIds: [],
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      `/projects/${projectId}/agent-sessions/changes?cursor=7`,
    );
  });

  it("uses the organization Inbox ETag for unchanged polls", async () => {
    const organizationId = "22222222-2222-4222-8222-222222222222";
    const etag = `W/"organization-inbox:${organizationId}:7"`;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("If-None-Match")).toBe(etag);
      return new Response(null, { status: 304, headers: { ETag: etag } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadInboxFeed("token", organizationId, { etag }))
      .resolves.toEqual({
        state: { etag },
        notModified: true,
        messages: [],
      });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      `/organizations/${organizationId}/inbox`,
    );
  });

  it("reads the authoritative subscribed issue ids from the Inbox feed", async () => {
    const organizationId = "22222222-2222-4222-8222-222222222222";
    const runId = "11111111-1111-4111-8111-111111111111";
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({
        messages: [],
        subscribedIssueIds: [runId, null, 3],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    ));

    await expect(loadInboxFeed("token", organizationId, null))
      .resolves.toMatchObject({
        notModified: false,
        messages: [],
        subscribedIssueIds: [runId],
      });
  });

  it("canonicalizes the Agent ID before running a task on a Worker", async () => {
    const projectId = "22222222-2222-4222-8222-222222222222";
    const agentId = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        session: {
          id: "session-1",
          projectId,
          dispatchGroupId: "session-1",
          agentId: body.agentId,
          sessionType: "task",
          trigger: "manual",
          scheduleId: null,
          scheduleRunId: null,
          parentSessionId: null,
          request: body.request,
          status: "running",
          issues: [],
          startedAt: "2026-07-30T00:00:00.000Z",
          completedAt: null,
          conversationId: null,
          workspaceRoot: null,
          requestedWorkerId: body.workerId,
          workerId: body.workerId,
          summary: null,
          error: null,
          events: [{
            id: "event-1",
            type: "started",
            occurredAt: "2026-07-30T00:00:00.000Z",
          }],
          dispatchEvents: [],
          workers: [],
          updatedAt: "2026-07-30T00:00:00.000Z",
        },
      }), {
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await runProjectAgentTaskOnWorker("token", projectId, {
      agentId,
      request: "Review the repository",
      workerId: "worker-1",
      skillId: "33333333-3333-4333-8333-333333333333",
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.agentId).toBe(agentId.toLowerCase());
  });

  it("uploads only the shareable agent session snapshot", async () => {
    const projectId = "22222222-2222-4222-8222-222222222222";
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({
          session: {
            id: "session-1",
            projectId,
            ...body,
            workspaceRoot: null,
            dispatchEvents: [],
            workers: [],
          },
        }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await upsertProjectAgentSession("token", {
      id: "session-1",
      projectId,
      dispatchGroupId: "",
      agentId: undefined,
      agentName: "Inbox Agent",
      sessionType: "task",
      trigger: "manual",
      request: "Review the repository",
      status: "running",
      issues: [],
      startedAt: "2026-07-30T00:00:00.000Z",
      completedAt: null,
      conversationId: null,
      workspaceRoot: "/Users/dev/private-repository",
      summary: null,
      error: null,
      events: [],
      dispatchEvents: [],
      workers: [],
      updatedAt: "2026-07-30T00:00:00.000Z",
      localOwner: true,
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).not.toHaveProperty("workspaceRoot");
    expect(body).not.toHaveProperty("localOwner");
    expect(body).toMatchObject({
      agentId: null,
      agentName: "Inbox Agent",
      status: "running",
      updatedAt: "2026-07-30T00:00:00.000Z",
    });
  });

  it("updates an organization member role through the member endpoint", async () => {
    const organizationId = "22222222-2222-4222-8222-222222222222";
    const userId = "user/member";
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ members: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      updateOrganizationMemberRole(
        "token",
        organizationId,
        userId,
        "admin",
      ),
    ).resolves.toEqual({ members: [] });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        `/organizations/${organizationId}/members/user%2Fmember`,
      ),
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ role: "admin" }),
      }),
    );
  });

  it("defaults missing dashboard revision numbers for older API payloads", async () => {
    const legacyDashboard = {
      ...demoDashboard,
      runs: demoDashboard.runs.map((run) => {
        const {
          currentRevision: _currentRevision,
          ...legacyRun
        } = run;
        return legacyRun;
      }),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(legacyDashboard), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const dashboard = await loadDashboard(
      "token",
      demoDashboard.project.id,
    );

    expect(dashboard.runs[0].currentRevision).toBe(1);
    expect(dashboard.runs[0]).not.toHaveProperty("events");
  });

  it("loads lightweight organization usage runs without dashboard requests", async () => {
    const organizationId = "11111111-1111-4111-8111-111111111111";
    const usageRun = {
      id: "22222222-2222-4222-8222-222222222222",
      projectId: "33333333-3333-4333-8333-333333333333",
      status: "completed",
      executionMetrics: {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 80,
        cacheWriteTokens: null,
        reasoningOutputTokens: 5,
        totalTokens: 120,
        durationMs: 1_000,
      },
      claimedBy: "worker",
      claimedAt: "2026-08-01T00:00:00.000Z",
      claimAttempts: 1,
      workerId: "worker-1",
      preferredProvider: null,
      preferredModel: null,
      requestedProvider: "codex",
      requestedModel: "gpt-5.6-sol",
      executionProvider: "codex",
      executionModel: "gpt-5.6-sol",
      startedAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:01:00.000Z",
      completedAt: "2026-08-01T00:01:00.000Z",
    };
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({
          runs: [usageRun],
          generatedAt: "2026-08-09T00:00:00.000Z",
          pricing: {
            status: "live",
            source: "https://example.com/current-rates.json",
            fetchedAt: "2026-08-09T00:00:00.000Z",
            knownModels: 2_500,
          },
        }), {
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      loadAgentUsageRuns("token", organizationId, 90),
    ).resolves.toEqual([usageRun]);
    await expect(
      loadAgentUsageReport("token", organizationId, 90),
    ).resolves.toMatchObject({
      runs: [usageRun],
      pricing: { status: "live", knownModels: 2_500 },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        `/organizations/${organizationId}/usage/runs?days=90`,
      ),
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
    expect(
      String(fetchMock.mock.calls[0]?.[0]),
    ).not.toContain("/dashboard");
  });

  it("normalizes usage reports from servers without pricing metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          runs: [],
          generatedAt: "2026-08-09T00:00:00.000Z",
        }),
      ),
    );

    await expect(
      loadAgentUsageReport(
        "token",
        "11111111-1111-4111-8111-111111111111",
      ),
    ).resolves.toMatchObject({
      runs: [],
      pricing: {
        status: "unavailable",
        fetchedAt: null,
        knownModels: 0,
      },
    });
  });

  it("loads a project-scoped usage summary for the home page", async () => {
    const projectId = "22222222-2222-4222-8222-222222222222";
    const summary = {
      period: "week",
      rangeStart: "2026-05-25T00:00:00.000Z",
      rangeEnd: "2026-08-17T00:00:00.000Z",
      totalTokens: 1_234,
      trackedDurationMs: 56_000,
      observedRuns: 8,
      reportedRuns: 7,
      completedIssues: 6,
      timeline: [],
      issueCreators: [],
      agents: [],
      generatedAt: "2026-08-12T00:00:00.000Z",
    };
    const fetchMock = vi.fn(async () => Response.json(summary));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      loadProjectUsageSummary("token", projectId, "week"),
    ).resolves.toEqual(summary);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/projects/${projectId}/usage/summary?period=week`),
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
  });

  it("loads and normalizes timeline events from the run detail endpoint", async () => {
    const projectId = "22222222-2222-4222-8222-222222222222";
    const runId = "11111111-1111-4111-8111-111111111111";
    const [{
      revision: _revision,
      actorName: _actorName,
      ...legacyEvent
    }] = demoRunEvents["demo-1"];
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ events: [legacyEvent] }), {
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const events = await loadRunEvents("token", projectId, runId);

    expect(events[0].revision).toBe(1);
    expect(events[0].actorName).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/projects/${projectId}/runs/${runId}/events`),
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
  });

  it("requests dashboard changes after the supplied cursor", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        cursor: 18,
        hasMore: false,
        runs: [],
        deletedRunIds: ["deleted-run"],
        workers: [],
        organizationProviders: [],
        generatedAt: "2026-08-01T00:00:00.000Z",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      loadDashboardDelta("token", demoDashboard.project.id, 17),
    ).resolves.toMatchObject({ cursor: 18, deletedRunIds: ["deleted-run"] });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        `/projects/${demoDashboard.project.id}/dashboard/delta?cursor=17`,
      ),
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
  });

  it("loads the organization status tray projection", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        runs: [{
          projectId: "project-1",
          projectName: "Briar",
          id: "run-1",
          title: "Optimize tray polling",
          status: "running",
          workflowStage: "implementing",
          workflowStageLabel: "Implement",
          startedAt: "2026-08-11T00:00:00.000Z",
          updatedAt: "2026-08-11T00:01:00.000Z",
          lastEventAt: "2026-08-11T00:01:00.000Z",
        }],
        generatedAt: "2026-08-11T00:01:00.000Z",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      loadStatusTrayRuns("token", "organization-1"),
    ).resolves.toMatchObject({
      runs: [expect.objectContaining({ id: "run-1", projectId: "project-1" })],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/organizations/organization-1/status-tray/runs",
      ),
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
  });

  it("loads run evidence through the user-authenticated project endpoint", async () => {
    const projectId = "22222222-2222-4222-8222-222222222222";
    const runId = "11111111-1111-4111-8111-111111111111";
    const evidence = [{
      key: "LOCAL-1:local_qa:local_ci_result",
      attempt: 1,
      revision: 2,
      stage: "local_qa",
      type: "local_ci_result",
      status: "passed",
      detail: "Focused checks passed.",
      command: "bun run test",
      url: null,
      metadata: null,
      actor: "briar-workflow",
      observedAt: "2026-07-28T00:00:00.000Z",
      recordedAt: "2026-07-28T00:00:01.000Z",
      requiredRevision: 2,
      canonical: true,
    }];
    let capturedInit: RequestInit | undefined;
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedInit = init;
        return new Response(
          JSON.stringify({ runId, attempt: 1, revision: 2, evidence }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadRunEvidence("token", projectId, runId)).resolves.toEqual(
      evidence,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/projects/${projectId}/runs/${runId}/evidence`),
      expect.any(Object),
    );
    expect(
      new Headers(capturedInit?.headers).get("Authorization"),
    ).toBe("Bearer token");
  });

  it("loads a protected run evidence image with the user token", async () => {
    const imageBlob = new Blob(["image"], { type: "image/png" });
    let capturedInit: RequestInit | undefined;
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedInit = init;
        return new Response(imageBlob, { status: 200 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      loadRunEvidenceImage("token", {
        id: "image-1",
        filename: "finished-ui.png",
        contentType: "image/png",
        byteSize: 5,
        sha256: "abc",
        position: 0,
        url: "/projects/project-1/runs/run-1/evidence/images/image-1",
      }),
    ).resolves.toEqual(imageBlob);
    expect(
      new Headers(capturedInit?.headers).get("Authorization"),
    ).toBe("Bearer token");
  });

  it("creates a project agent with its provider, model, and responsibility", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const input = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            agent: {
              id: "11111111-1111-4111-8111-111111111111",
              projectId: "22222222-2222-4222-8222-222222222222",
              name: "Feedback 분석 에이전트",
              provider: input.provider,
              model: input.model,
              responsibility: input.responsibility,
              skill: "# Feedback agent\n\nAnalyze feedback.",
              createdAt: "2026-07-26T00:00:00.000Z",
              updatedAt: "2026-07-26T00:00:00.000Z",
            },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const agent = await createProjectAgent(
      "token",
      "22222222-2222-4222-8222-222222222222",
      {
        name: "Feedback 분석 에이전트",
        provider: "grok",
        model: "grok-4.5",
        responsibility: "피드백을 분석해 액션 아이템 이슈를 만듭니다.",
        calendarColor: "#0f9f76",
      },
    );

    expect(agent).toMatchObject({
      provider: "grok",
      model: "grok-4.5",
      responsibility: "피드백을 분석해 액션 아이템 이슈를 만듭니다.",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/projects/22222222-2222-4222-8222-222222222222/agents",
      ),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("requests project agents in the active locale", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ agents: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      loadProjectAgents("token", "22222222-2222-4222-8222-222222222222", "zh"),
    ).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/projects/22222222-2222-4222-8222-222222222222/agents?locale=zh",
      ),
      expect.any(Object),
    );
  });

  it("loads project agents without a special kind", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            agents: [
              {
                id: "11111111-1111-4111-8111-111111111111",
                projectId: "22222222-2222-4222-8222-222222222222",
                name: "자동 사냥 에이전트",
                provider: "codex",
                model: null,
                responsibility:
                  "모든 대기중인 이슈에 대해서 자동사냥을 수행하는것",
                skill: "# 자동 사냥 에이전트\n\n자동사냥을 수행합니다.",
                createdAt: "2026-07-26T00:00:00.000Z",
                updatedAt: "2026-07-26T00:00:00.000Z",
              },
              {
                id: "33333333-3333-4333-8333-333333333333",
                projectId: "22222222-2222-4222-8222-222222222222",
                name: "Feedback agent",
                provider: "grok",
                model: null,
                responsibility: "Analyze feedback.",
                skill: "# Feedback agent\n\nAnalyze feedback.",
                createdAt: "2026-07-26T00:00:00.000Z",
                updatedAt: "2026-07-26T00:00:00.000Z",
              },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }),
    );

    await expect(
      loadProjectAgents(
        "token",
        "22222222-2222-4222-8222-222222222222",
        "ko",
      ),
    ).resolves.toHaveLength(2);
  });

  it("ignores legacy project agent kind fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            agents: [
              {
                id: "11111111-1111-4111-8111-111111111111",
                projectId: "22222222-2222-4222-8222-222222222222",
                name: "Unknown agent",
                provider: "codex",
                model: null,
                responsibility: "Unknown responsibility.",
                skill: "# Unknown agent\n\nUnknown responsibility.",
                kind: "unknown",
                createdAt: "2026-07-26T00:00:00.000Z",
                updatedAt: "2026-07-26T00:00:00.000Z",
              },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }),
    );

    await expect(
      loadProjectAgents(
        "token",
        "22222222-2222-4222-8222-222222222222",
        "en",
      ),
    ).resolves.toEqual([
      expect.not.objectContaining({ kind: expect.anything() }),
    ]);
  });

  it("creates an agent schedule with its recurrence and time zone", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const input = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            schedule: {
              id: "11111111-1111-4111-8111-111111111111",
              projectId: "22222222-2222-4222-8222-222222222222",
              agentId: input.agentId,
              agentName: "Auto Hunt agent",
              agentProvider: "codex",
              name: input.name,
              recurrence: input.recurrence,
              timeOfDay: input.timeOfDay,
              dayOfWeek: input.dayOfWeek,
              timeZone: input.timeZone,
              enabled: true,
              createdAt: "2026-07-27T00:00:00.000Z",
              updatedAt: "2026-07-27T00:00:00.000Z",
            },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const schedule = await createProjectAgentSchedule(
      "token",
      "22222222-2222-4222-8222-222222222222",
      {
        agentId: "33333333-3333-4333-8333-333333333333",
        name: "Weekday repository audit",
        recurrence: "weekdays",
        timeOfDay: "09:00",
        dayOfWeek: null,
        timeZone: "Asia/Seoul",
      },
    );

    expect(schedule).toMatchObject({
      agentName: "Auto Hunt agent",
      recurrence: "weekdays",
      timeOfDay: "09:00",
      timeZone: "Asia/Seoul",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/projects/22222222-2222-4222-8222-222222222222/agent-schedules",
      ),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("updates and deletes an agent schedule through its scoped endpoint", async () => {
    const projectId = "22222222-2222-4222-8222-222222222222";
    const scheduleId = "11111111-1111-4111-8111-111111111111";
    const agentId = "33333333-3333-4333-8333-333333333333";
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          const input = JSON.parse(String(init?.body));
          return new Response(
            JSON.stringify({
              schedule: {
                id: scheduleId,
                projectId,
                agentId,
                agentName: "Release agent",
                agentProvider: "codex",
                ...input,
                enabled: true,
                createdAt: "2026-07-27T00:00:00.000Z",
                updatedAt: "2026-07-27T01:00:00.000Z",
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        },
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const input = {
      agentId,
      name: "Weekly release review",
      recurrence: "weekly" as const,
      timeOfDay: "16:30",
      dayOfWeek: 5,
      timeZone: "Asia/Seoul",
    };
    await expect(
      updateProjectAgentSchedule("token", projectId, scheduleId, input),
    ).resolves.toMatchObject(input);
    await expect(
      deleteProjectAgentSchedule("token", projectId, scheduleId),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(
        `/projects/${projectId}/agent-schedules/${scheduleId}`,
      ),
      expect.objectContaining({ method: "PUT" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(
        `/projects/${projectId}/agent-schedules/${scheduleId}`,
      ),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("treats an already deleted agent schedule as a successful delete", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ message: "Project agent schedule not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      deleteProjectAgentSchedule(
        "token",
        "22222222-2222-4222-8222-222222222222",
        "11111111-1111-4111-8111-111111111111",
      ),
    ).resolves.toBeUndefined();
  });

  it("claims and completes a due agent schedule run", async () => {
    const claimToken = `briar_schedule_claim_${"a".repeat(64)}`;
    const structuredResult = {
      summary: "Audit completed.",
      outcome: "completed",
      importance: "routine",
      urgency: "normal",
      impact: "issue",
      humanActionRequired: false,
      nextAction: null,
      dueAt: null,
    } as const;
    const run = {
      id: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
      scheduleId: "33333333-3333-4333-8333-333333333333",
      scheduleName: "Daily project audit",
      agent: {
        id: "44444444-4444-4444-8444-444444444444",
        name: "Repository auditor",
        description: "",
        provider: "codex",
        model: null,
        responsibility: "Audit the connected repository.",
        skill: "# Repository auditor\n\nAudit the connected repository.",
        skills: [],
      },
      workflow: cloneAutoHuntWorkflow(),
      status: "running",
      scheduledFor: "2026-07-27T09:00:00.000Z",
      leaseExpiresAt: "2026-07-27T11:00:00.000Z",
      startedAt: "2026-07-27T09:00:01.000Z",
      completedAt: null,
      resultSummary: null,
      structuredResult: null,
      error: null,
    } as const;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ run: { ...run, claimToken } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            run: {
              ...run,
              status: "completed",
              leaseExpiresAt: null,
              completedAt: "2026-07-27T09:01:00.000Z",
              resultSummary: "Audit completed.",
              structuredResult,
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      claimProjectAgentScheduleRuns(
        "token",
        ["22222222-2222-4222-8222-222222222222"],
      ),
    ).resolves.toMatchObject({ id: run.id, claimToken });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("/agent-schedule-runs/claim"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          projectIds: ["22222222-2222-4222-8222-222222222222"],
        }),
      }),
    );
    await expect(
      completeProjectAgentScheduleRun(
        "token",
        "22222222-2222-4222-8222-222222222222",
        run.id,
        {
          claimToken,
          status: "completed",
          resultSummary: "Audit completed.",
          structuredResult,
        },
      ),
    ).resolves.toMatchObject({
      status: "completed",
      resultSummary: "Audit completed.",
      structuredResult,
    });
  });

  it("loads agent schedule execution history", async () => {
    const run = {
      id: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
      scheduleId: "33333333-3333-4333-8333-333333333333",
      scheduleName: "Daily project audit",
      agent: {
        id: "44444444-4444-4444-8444-444444444444",
        name: "Repository auditor",
        description: "",
        provider: "codex",
        model: null,
        effort: null,
        responsibility: "Audit the connected repository.",
        skill: "# Repository auditor\n\nAudit the connected repository.",
        skills: [],
      },
      workflow: cloneAutoHuntWorkflow(),
      status: "completed",
      scheduledFor: "2026-07-27T09:00:00.000Z",
      leaseExpiresAt: null,
      startedAt: "2026-07-27T09:00:01.000Z",
      completedAt: "2026-07-27T09:01:00.000Z",
      resultSummary: "Audit completed.",
      structuredResult: {
        summary: "Audit completed.",
        outcome: "completed",
        importance: "routine",
        urgency: "normal",
        impact: "issue",
        humanActionRequired: false,
        nextAction: null,
        dueAt: null,
      },
      error: null,
    } as const;
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ runs: [run] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      loadProjectAgentScheduleRuns(
        "token",
        "22222222-2222-4222-8222-222222222222",
      ),
    ).resolves.toEqual([run]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/projects/22222222-2222-4222-8222-222222222222/agent-schedule-runs",
      ),
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
  });

  it("updates a project agent through its scoped endpoint", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const input = JSON.parse(String(init?.body));
        expect(input.codexPet).toEqual({ slug: "firefly--lingxiaotian" });
        return new Response(
          JSON.stringify({
            agent: {
              id: "11111111-1111-4111-8111-111111111111",
              projectId: "22222222-2222-4222-8222-222222222222",
              ...input,
              skills: input.skills.map((skill: Record<string, unknown>, index: number) => ({
                id: `skill-${index + 1}`,
                agentId: "11111111-1111-4111-8111-111111111111",
                ...skill,
                createdAt: "2026-07-26T00:00:00.000Z",
                updatedAt: "2026-07-27T00:00:00.000Z",
              })),
              codexPet: {
                slug: "firefly--lingxiaotian",
                name: "Firefly",
                author: "Lingxiaotian",
                license: "CC BY-NC 4.0",
                spriteVersion: 1,
                spriteSheetUrl:
                  "/projects/22222222-2222-4222-8222-222222222222/agents/11111111-1111-4111-8111-111111111111/spritesheet",
              },
              skill: "# Release agent\n\n릴리스 상태를 점검합니다.",
              createdAt: "2026-07-26T00:00:00.000Z",
              updatedAt: "2026-07-27T00:00:00.000Z",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      updateProjectAgent(
        "token",
        "22222222-2222-4222-8222-222222222222",
        "11111111-1111-4111-8111-111111111111",
        {
          name: "Release agent",
          avatar: "data:image/webp;base64,aA==",
          codexPet: {
            slug: "firefly--lingxiaotian",
            name: "Firefly",
            author: "Lingxiaotian",
            license: "CC BY-NC 4.0",
            spriteVersion: 1,
            spriteSheetUrl: null,
          },
          provider: "claude",
          model: "sonnet",
          responsibility: "릴리스 상태를 점검합니다.",
          skills: [
            {
              name: "릴리스 점검",
              instructions: "릴리스 상태를 점검합니다.",
              provider: "claude",
              model: "sonnet",
              effort: null,
              kind: "custom",
              position: 0,
            },
          ],
          calendarColor: "#8b5cf6",
        },
      ),
    ).resolves.toMatchObject({
      name: "Release agent",
      avatar: "data:image/webp;base64,aA==",
      codexPet: expect.objectContaining({
        slug: "firefly--lingxiaotian",
        spriteSheetUrl: expect.stringContaining("/spritesheet"),
      }),
      provider: "claude",
      model: "sonnet",
      responsibility: "릴리스 상태를 점검합니다.",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/projects/22222222-2222-4222-8222-222222222222/agents/11111111-1111-4111-8111-111111111111",
      ),
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("deletes an agent through its project-scoped endpoint", async () => {
    const fetchMock = vi.fn(
      async () => new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      deleteProjectAgent(
        "token",
        "22222222-2222-4222-8222-222222222222",
        "11111111-1111-4111-8111-111111111111",
      ),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/projects/22222222-2222-4222-8222-222222222222/agents/11111111-1111-4111-8111-111111111111",
      ),
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});

describe("channel message API", () => {
  it("sends the selected visibility when creating a channel", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      channel: {},
    }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await createChannel("token", "org-1", {
      name: "Private notes",
      visibility: "private",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/organizations/org-1/channels"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Private notes", visibility: "private" }),
      }),
    );
  });

  it("deletes a channel through its organization-scoped endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ deleted: true }),
      { headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      deleteChannel("token", "org-1", "channel-1"),
    ).resolves.toEqual({ deleted: true });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/organizations/org-1/channels/channel-1",
      ),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("uses the channel-scoped webhook management routes", async () => {
    const webhook = {
      id: "webhook-1",
      channelId: "channel-1",
      name: "Deploy notifier",
      active: true,
      lastUsedAt: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    };
    const fetchMock = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => new Response(JSON.stringify({
      webhooks: [webhook],
      webhook,
      url: "https://example.com/hooks/channels/webhook-1/secret",
    }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await listChannelWebhooks("token", "org-1", "channel-1");
    await createChannelWebhook("token", "org-1", "channel-1", "Deploy notifier");
    await updateChannelWebhook(
      "token",
      "org-1",
      "channel-1",
      "webhook-1",
      "Release notifier",
    );
    await rotateChannelWebhook("token", "org-1", "channel-1", "webhook-1");
    await revokeChannelWebhook("token", "org-1", "channel-1", "webhook-1");

    const calls = fetchMock.mock.calls;
    expect(calls[0]?.[0]).toContain(
      "/organizations/org-1/channels/channel-1/webhooks",
    );
    expect(calls[1]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ name: "Deploy notifier" }),
    });
    expect(calls[2]?.[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ name: "Release notifier" }),
    });
    expect(calls[3]?.[0]).toContain("/webhooks/webhook-1/rotate");
    expect(calls[3]?.[1]).toMatchObject({ method: "POST" });
    expect(calls[4]?.[0]).toContain("/webhooks/webhook-1");
    expect(calls[4]?.[1]).toMatchObject({ method: "DELETE" });
  });

  it("keeps attachment-only fields out of JSON channel messages", async () => {
    const preferredDeviceId = "c0000000-0000-4000-8000-000000000123";
    const clientMessageId = "d0000000-0000-4000-8000-000000000123";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        body: "Hello",
        clientMessageId,
        parentMessageId: null,
        mentionedUserIds: [],
        mentionedAgentIds: [],
        preferredDeviceId,
      });
      return new Response(
        JSON.stringify({ message: {}, agentReplies: [] }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await sendChannelMessage("token", "org-1", "channel-1", {
      body: "Hello",
      clientMessageId,
      parentMessageId: null,
      mentionedUserIds: [],
      mentionedAgentIds: [],
      preferredDeviceId,
      attachments: [],
      attachmentReferences: [],
    });

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("loads a channel document from its member-authenticated route", async () => {
    const fetchMock = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => new Response(JSON.stringify({
      document: {
        messageId: "message-1",
        title: "Rollout plan",
        markdown: "# Rollout",
        projectId: null,
      },
    }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadChannelMessageDocument(
      "token",
      "org-1",
      "channel-1",
      "message-1",
    )).resolves.toMatchObject({
      document: { title: "Rollout plan", markdown: "# Rollout" },
    });
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      "/organizations/org-1/channels/channel-1/messages/message-1/document",
    );
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Authorization"))
      .toBe("Bearer token");
  });

  it("uploads channel images and attachment references as multipart form data", async () => {
    const reference = crypto.randomUUID();
    const clientMessageId = crypto.randomUUID();
    const preferredDeviceId = "c0000000-0000-4000-8000-000000000123";
    const image = new File(["image"], "clipboard.png", { type: "image/png" });
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const form = init?.body as FormData;
      expect(form).toBeInstanceOf(FormData);
      expect(form.get("body")).toContain(`briar-attachment://${reference}`);
      expect(form.get("clientMessageId")).toBe(clientMessageId);
      expect(form.get("mentionedAgentIds")).toBe(JSON.stringify(["agent-1"]));
      expect(form.get("preferredDeviceId")).toBe(preferredDeviceId);
      expect(form.get("attachmentReferences")).toBe(JSON.stringify([reference]));
      expect(form.getAll("attachments")).toEqual([image]);
      return new Response(
        JSON.stringify({
          message: {
            id: crypto.randomUUID(),
            channelId: "channel-1",
            parentMessageId: null,
            author: {
              type: "user",
              id: "owner",
              name: "Owner",
              email: "owner@example.com",
              image: null,
            },
            body: String(form.get("body")),
            mentionedUserIds: [],
            mentionedAgentIds: ["agent-1"],
            attachments: [],
            replyCount: 0,
            lastReplyAt: null,
            document: null,
            proposal: null,
            createdAt: "2026-08-07T00:00:00.000Z",
          },
          agentReplies: [],
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await sendChannelMessage("token", "org-1", "channel-1", {
      body: `Screenshot\n\n![clipboard.png](briar-attachment://${reference})`,
      clientMessageId,
      parentMessageId: null,
      mentionedUserIds: [],
      mentionedAgentIds: ["agent-1"],
      preferredDeviceId,
      attachments: [image],
      attachmentReferences: [reference],
    });

    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
