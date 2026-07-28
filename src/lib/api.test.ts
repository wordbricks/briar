import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claimProjectAgentScheduleRun,
  completeProjectAgentScheduleRun,
  createProjectAgent,
  createProjectAgentSchedule,
  deleteIssue,
  deleteProjectAgentSchedule,
  loadProjectAgentScheduleRuns,
  loadProjectAgents,
  loadRunEvidence,
  loadSession,
  updateProjectAgent,
  updateProjectAgentSchedule,
  updateIssue,
} from "./api";
import { repositoryWorkflowBootstrap } from "./auto-hunt-contract";

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
});
