import { describe, expect, it, vi } from "vitest";
import type { HuntRun, ProjectAgent } from "../types";
import { dispatchAutoHuntToWorkers } from "./auto-hunt-worker-dispatch";

const agent = {
  id: "agent-1",
  provider: "claude",
} as ProjectAgent;

function run(
  id: string,
  overrides: Partial<HuntRun> = {},
): HuntRun {
  return {
    id,
    runNumber: Number(id.replace(/\D/gu, "")),
    status: "queued",
    priority: 3,
    sourceCreatedAt: `2026-07-31T00:0${id.at(-1)}:00.000Z`,
    ...overrides,
  } as HuntRun;
}

describe("dispatchAutoHuntToWorkers", () => {
  it("dispatches the selected queued issues to any registered Worker", async () => {
    const dispatch = vi.fn(async () => undefined);
    const retry = vi.fn(async () => undefined);

    const result = await dispatchAutoHuntToWorkers(
      { dispatch, retry },
      {
        agent,
        maxIssues: 2,
        runs: [
          run("run-1", { priority: 4 }),
          run("run-2", { priority: 1 }),
          run("run-3", { priority: 2 }),
        ],
      },
    );

    expect(result.runIds).toEqual(["run-2", "run-3"]);
    expect(retry).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: "run-2" }),
      {
        agentId: agent.id,
        effort: null,
        model: null,
        provider: "claude",
        workerId: null,
        reassign: false,
      },
    );
    expect(dispatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: "run-3" }),
      {
        agentId: agent.id,
        effort: null,
        model: null,
        provider: "claude",
        workerId: null,
        reassign: false,
      },
    );
  });

  it("retries requested runs before reassigning them to a Worker", async () => {
    const dispatch = vi.fn(async () => undefined);
    const retry = vi.fn(async () => undefined);
    const blocked = run("run-4", {
      status: "blocked",
      dispatchedAt: "2026-07-31T00:00:00.000Z",
      workerId: "worker-1",
    });

    await dispatchAutoHuntToWorkers(
      { dispatch, retry },
      {
        agent,
        retryReason: "권한 복구 확인",
        runs: [blocked],
        targetRunIds: [blocked.id],
      },
    );

    expect(retry).toHaveBeenCalledWith(blocked, "권한 복구 확인");
    expect(dispatch).toHaveBeenCalledWith(blocked, {
      agentId: agent.id,
      effort: null,
      model: null,
      provider: "claude",
      workerId: null,
      reassign: true,
    });
  });

  it("prefers an issue model, then an issue provider, then the Agent model", async () => {
    const dispatch = vi.fn(async () => undefined);
    const retry = vi.fn(async () => undefined);
    const configuredAgent = {
      id: "agent-1",
      provider: "claude" as const,
      model: "sonnet",
    };

    await dispatchAutoHuntToWorkers(
      { dispatch, retry },
      {
        agent: configuredAgent,
        runs: [
          run("run-1"),
          run("run-2", { preferredProvider: "grok" }),
          run("run-3", {
            preferredProvider: "codex",
            preferredModel: "gpt-5.6-sol",
            preferredEffort: "xhigh",
          }),
        ],
        maxIssues: 3,
      },
    );

    expect(dispatch).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        provider: "claude",
        model: "sonnet",
        effort: null,
      }),
    );
    expect(dispatch).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        provider: "grok",
        model: null,
        effort: null,
      }),
    );
    expect(dispatch).toHaveBeenNthCalledWith(
      3,
      expect.anything(),
      expect.objectContaining({
        provider: "codex",
        model: "gpt-5.6-sol",
        effort: "xhigh",
      }),
    );
  });

  it("does not dispatch when a requested retry target is missing", async () => {
    const dispatch = vi.fn(async () => undefined);
    const retry = vi.fn(async () => undefined);

    await expect(
      dispatchAutoHuntToWorkers(
        { dispatch, retry },
        {
          agent,
          runs: [run("run-1")],
          targetRunIds: ["missing-run"],
        },
      ),
    ).rejects.toThrow(
      "재시도할 이슈를 현재 프로젝트에서 찾지 못했습니다.",
    );
    expect(retry).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does not retry a requested issue while prerequisites are unfinished", async () => {
    const dispatch = vi.fn(async () => undefined);
    const retry = vi.fn(async () => undefined);
    const blocked = run("run-4", {
      status: "blocked",
      executionReadiness: "waiting",
      waitingOnPrerequisiteCount: 1,
    });

    await expect(
      dispatchAutoHuntToWorkers(
        { dispatch, retry },
        {
          agent,
          runs: [blocked],
          targetRunIds: [blocked.id],
        },
      ),
    ).rejects.toThrow(
      "선행 이슈가 완료되지 않아 대기 이슈 처리를 시작할 수 없습니다.",
    );
    expect(retry).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects an empty queue without starting a local runtime", async () => {
    const dispatch = vi.fn(async () => undefined);
    const retry = vi.fn(async () => undefined);

    await expect(
      dispatchAutoHuntToWorkers(
        { dispatch, retry },
        {
          agent,
          runs: [run("run-1", { status: "backlog" })],
        },
      ),
    ).rejects.toThrow("대기 상태인 이슈가 없습니다.");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("propagates Worker dispatch failures without falling back locally", async () => {
    const dispatch = vi.fn(async () => {
      throw new Error("No worker is configured for the claude provider");
    });
    const retry = vi.fn(async () => undefined);

    await expect(
      dispatchAutoHuntToWorkers(
        { dispatch, retry },
        {
          agent,
          runs: [run("run-1"), run("run-2")],
          maxIssues: 2,
        },
      ),
    ).rejects.toThrow("No worker is configured for the claude provider");
    expect(dispatch).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
  });
});
