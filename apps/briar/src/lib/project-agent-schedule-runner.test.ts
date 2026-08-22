import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimedProjectAgentScheduleRun } from "../types";
import { repositoryWorkflowBootstrap } from "./auto-hunt-contract";
import {
  executeClaimedProjectAgentSchedule,
  pollProjectAgentSchedulesOnce,
  type ProjectAgentScheduleRunnerDependencies,
} from "./project-agent-schedule-runner";

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
    effort: null,
    responsibility: "Audit the connected repository.",
    skill: "# Auditor\n\nAudit the connected repository.",
    skills: [],
  },
  workflow: repositoryWorkflowBootstrap,
  status: "running",
  claimToken: `briar_schedule_claim_${"a".repeat(64)}`,
  scheduledFor: "2026-07-27T09:00:00.000Z",
  leaseExpiresAt: "2026-07-27T11:00:00.000Z",
  startedAt: "2026-07-27T09:00:01.000Z",
  completedAt: null,
  resultSummary: null,
  structuredResult: null,
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
    structuredResult: input.structuredResult,
    error: input.status === "failed" ? input.error : null,
  })),
  renew: vi.fn(async () => undefined),
  execute: vi.fn(async () => ({
    conversationId: "briar:project-1:thread-1",
    message: "Audit completed.",
    workspaceRoot: "/repo",
    structuredResult,
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
      structuredResult,
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
      structuredResult: {
        summary: "provider unavailable",
        outcome: "failed",
        importance: "important",
        urgency: "time_sensitive",
        impact: "issue",
        humanActionRequired: true,
        nextAction: "실패 원인을 확인하고 예약 작업을 다시 실행하세요.",
        dueAt: null,
      },
    });
  });

  it("claims all connected projects with one batched request", async () => {
    const current = dependencies({
      claim: vi.fn().mockResolvedValueOnce(run).mockResolvedValueOnce(null),
    });

    await pollProjectAgentSchedulesOnce(current, ["project-a", "project-b"]);

    expect(current.claim).toHaveBeenCalledTimes(2);
    expect(current.claim).toHaveBeenNthCalledWith(
      1,
      ["project-a", "project-b"],
    );
    expect(current.execute).toHaveBeenCalledWith(run);
  });

  it("stops the batch when claim fails", async () => {
    const current = dependencies({
      claim: vi.fn().mockRejectedValueOnce(new Error("offline")),
    });

    await pollProjectAgentSchedulesOnce(current, ["project-a", "project-b"]);

    expect(current.claim).toHaveBeenCalledOnce();
    expect(current.execute).not.toHaveBeenCalled();
    expect(current.log).toHaveBeenCalledWith(
      "예약 실행 batch claim 실패",
      expect.any(Error),
    );
  });
});
