import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addIssueDependency,
  claimProjectAgentScheduleRun,
  completeProjectAgentScheduleRun,
  createIssueMessage,
  createProjectAgent,
  createProjectAgentSchedule,
  deleteProjectAgent,
  deleteIssue,
  dispatchHuntRun,
  deleteProjectAgentSchedule,
  loadDashboard,
  loadDashboardDelta,
  loadProjectAgentSessions,
  loadProjectAgentScheduleRuns,
  loadProjectAgents,
  loadRunEvidence,
  loadRunEvidenceImage,
  loadSession,
  removeIssueDependency,
  updateProjectAgent,
  updateProjectAgentSchedule,
  updateOrganizationMemberRole,
  updateIssue,
  updateIssueExecutionPreferences,
  upsertProjectAgentSession,
  waitForIssueAgentReply,
} from "./api";
import { repositoryWorkflowBootstrap } from "./auto-hunt-contract";
import { demoDashboard } from "./demo-data";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API errors", () => {
  it("preserves the HTTP status for authentication decisions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify({ message: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    await expect(loadSession("expired-token")).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      message: "Unauthorized",
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

  it("returns a durable worker reply job for an @briar message", async () => {
    const projectId = "22222222-2222-4222-8222-222222222222";
    const runId = "11111111-1111-4111-8111-111111111111";
    const message = {
      id: "33333333-3333-4333-8333-333333333333",
      runId,
      parentMessageId: null,
      body: "@briar summarize this",
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

  it("polls the server until the assigned worker persists its reply", async () => {
    const projectId = "22222222-2222-4222-8222-222222222222";
    const runId = "11111111-1111-4111-8111-111111111111";
    const triggerMessageId = "33333333-3333-4333-8333-333333333333";
    const reply = {
      id: "55555555-5555-4555-8555-555555555555",
      runId,
      parentMessageId: triggerMessageId,
      body: "The worker fixed the retry race.",
      author: { id: null, name: "Briar · Codex", image: null, provider: "codex" },
      replyCount: 0,
      createdAt: "2026-07-31T00:00:01.000Z",
      updatedAt: "2026-07-31T00:00:01.000Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            agentReply: { status: "running", error: null },
            message: null,
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            agentReply: { status: "completed", error: null },
            message: reply,
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      waitForIssueAgentReply(
        "token",
        projectId,
        runId,
        triggerMessageId,
        { pollIntervalMs: 0, timeoutMs: 1_000 },
      ),
    ).resolves.toEqual(reply);
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
            status: "running",
            issues: [],
            startedAt: "2026-07-30T00:00:00.000Z",
            completedAt: null,
            conversationId: null,
            workspaceRoot: null,
            summary: null,
            error: null,
            events: [],
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
        status: "running",
        localOwner: false,
      }),
    ]);
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
          events: currentEvents,
          ...legacyRun
        } = run;
        return {
          ...legacyRun,
          events: currentEvents.map((event) => {
            const { revision: _revision, ...legacyEvent } = event;
            return legacyEvent;
          }),
        };
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
    expect(dashboard.runs[0].events[0].revision).toBe(1);
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
        provider: "codex",
        model: null,
        responsibility: "Audit the connected repository.",
        skill: "# Repository auditor\n\nAudit the connected repository.",
      },
      workflow: repositoryWorkflowBootstrap,
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
      claimProjectAgentScheduleRun(
        "token",
        "22222222-2222-4222-8222-222222222222",
      ),
    ).resolves.toMatchObject({ id: run.id, claimToken });
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
        provider: "codex",
        model: null,
        responsibility: "Audit the connected repository.",
        skill: "# Repository auditor\n\nAudit the connected repository.",
      },
      workflow: repositoryWorkflowBootstrap,
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
