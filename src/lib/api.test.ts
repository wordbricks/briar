import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createProjectAgent,
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
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
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
    });
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
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/projects/22222222-2222-4222-8222-222222222222/agents",
      ),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("requests project agents in the active locale", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ agents: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      loadProjectAgents(
        "token",
        "22222222-2222-4222-8222-222222222222",
        "zh",
      ),
    ).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/projects/22222222-2222-4222-8222-222222222222/agents?locale=zh",
      ),
      expect.any(Object),
    );
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
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/projects/22222222-2222-4222-8222-222222222222/agents/11111111-1111-4111-8111-111111111111",
      ),
      expect.objectContaining({ method: "PUT" }),
    );
  });
});
