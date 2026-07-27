import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claimProjectAgentScheduleRun,
  completeProjectAgentScheduleRun,
  createProjectAgent,
  createProjectAgentSchedule,
  loadProjectAgents,
  loadSession,
  updateProjectAgent,
} from "./api";

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
      },
    );

    expect(agent).toMatchObject({
      provider: "grok",
      model: "grok-4.5",
      responsibility: "피드백을 분석해 액션 아이템 이슈를 만듭니다.",
      kind: "custom",
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

  it("normalizes legacy project agents that omit kind", async () => {
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
    ).resolves.toMatchObject([
      { kind: "auto_hunt" },
      { kind: "custom" },
    ]);
  });

  it("rejects explicit unsupported project agent kinds", async () => {
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
    ).rejects.toMatchObject({ name: "ZodError" });
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

  it("claims and completes a due agent schedule run", async () => {
    const claimToken = `briar_schedule_claim_${"a".repeat(64)}`;
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
      },
      status: "running",
      scheduledFor: "2026-07-27T09:00:00.000Z",
      leaseExpiresAt: "2026-07-27T11:00:00.000Z",
      startedAt: "2026-07-27T09:00:01.000Z",
      completedAt: null,
      resultSummary: null,
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
        { claimToken, status: "completed", resultSummary: "Audit completed." },
      ),
    ).resolves.toMatchObject({
      status: "completed",
      resultSummary: "Audit completed.",
    });
  });

  it("updates a project agent through its scoped endpoint", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const input = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            agent: {
              id: "11111111-1111-4111-8111-111111111111",
              projectId: "22222222-2222-4222-8222-222222222222",
              ...input,
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
          provider: "claude",
          model: "sonnet",
          responsibility: "릴리스 상태를 점검합니다.",
        },
      ),
    ).resolves.toMatchObject({
      name: "Release agent",
      provider: "claude",
      model: "sonnet",
      responsibility: "릴리스 상태를 점검합니다.",
      kind: "custom",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/projects/22222222-2222-4222-8222-222222222222/agents/11111111-1111-4111-8111-111111111111",
      ),
      expect.objectContaining({ method: "PUT" }),
    );
  });
});
