import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimedProjectAgentScheduleRun } from "../types";
import { repositoryWorkflowBootstrap } from "./auto-hunt-contract";
import {
  executeClaimedProjectAgentSchedule,
  pollProjectAgentSchedulesOnce,
  type ProjectAgentScheduleRunnerDependencies,
} from "./project-agent-schedule-runner";

const run: ClaimedProjectAgentScheduleRun = {
  id: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  scheduleId: "33333333-3333-4333-8333-333333333333",
  scheduleName: "Daily repository audit",
  agent: {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Auditor",
    provider: "codex",
    model: null,
    responsibility: "Audit the connected repository.",
    skill: "# Auditor\n\nAudit the connected repository.",
  },
  workflow: repositoryWorkflowBootstrap,
  status: "running",
  claimToken: `briar_schedule_claim_${"a".repeat(64)}`,
  scheduledFor: "2026-07-27T09:00:00.000Z",
  leaseExpiresAt: "2026-07-27T11:00:00.000Z",
  startedAt: "2026-07-27T09:00:01.000Z",
  completedAt: null,
  resultSummary: null,
  error: null,
};

const dependencies = (
  overrides: Partial<ProjectAgentScheduleRunnerDependencies> = {},
): ProjectAgentScheduleRunnerDependencies => ({
  claim: vi.fn(async () => run),
  complete: vi.fn(async (_projectId, _runId, input) => ({
    ...run,
    status: input.status,
    claimToken: undefined,
    leaseExpiresAt: null,
    completedAt: "2026-07-27T09:01:00.000Z",
    resultSummary:
      input.status === "completed" ? input.resultSummary : null,
    error: input.status === "failed" ? input.error : null,
  })),
  renew: vi.fn(async () => undefined),
  execute: vi.fn(async () => ({
    conversationId: "briar:project-1:thread-1",
    message: "Audit completed.",
    workspaceRoot: "/repo",
  })),
  log: vi.fn(),
  ...overrides,
});

beforeEach(() => {
  vi.stubGlobal("window", {
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("project agent schedule runner", () => {
  it("executes a claim and records the provider result", async () => {
    const current = dependencies();

    await executeClaimedProjectAgentSchedule(current, run);

    expect(current.execute).toHaveBeenCalledWith(run);
    expect(current.complete).toHaveBeenCalledWith(run.projectId, run.id, {
      claimToken: run.claimToken,
      status: "completed",
      resultSummary: "Audit completed.",
    });
  });

  it("records provider failures without losing the claimed run", async () => {
    const current = dependencies({
      execute: vi.fn(async () => {
        throw new Error("provider unavailable");
      }),
    });

    await executeClaimedProjectAgentSchedule(current, run);

    expect(current.complete).toHaveBeenCalledWith(run.projectId, run.id, {
      claimToken: run.claimToken,
      status: "failed",
      error: "provider unavailable",
    });
  });

  it("isolates a project claim failure and continues to the next project", async () => {
    const current = dependencies({
      claim: vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce(run),
    });

    await pollProjectAgentSchedulesOnce(current, ["project-a", "project-b"]);

    expect(current.claim).toHaveBeenCalledTimes(2);
    expect(current.execute).toHaveBeenCalledWith(run);
    expect(current.log).toHaveBeenCalledWith(
      "예약 실행 claim 실패 (project-a)",
      expect.any(Error),
    );
  });
});
