import { createHmac } from "node:crypto";
import * as Option from "effect/Option";
import { describe, expect, it, vi } from "vitest";
import worker from "./index";
import {
  assertChannelProposalAuthorScope,
  loadChannelCatalogSnapshot,
  resolveChannelProposalTargetProjectId,
} from "./channel-proposal-helpers";
import {
  projectMutationProject,
  projectScheduleClaimMutation,
} from "./realtime-scheduling";
import {
  readChannelReplyCompleteRequest,
  readIssueReplyCompleteRequest,
  readIssueRequest,
  readRunEvidenceRequest,
  readTranscriptRequest,
} from "./request-readers";
import {
  handleScheduledTask,
  type ScheduledTaskDependencies,
} from "./scheduled-task";
import {
  issueClaimExecutionConfig,
  issueReplyExecutionConfig,
} from "./agent-execution-config";
import { assertRunEventIdentityNotOverridden } from "./run-event-identity";
import { loadOrganizationInboxConditionalSnapshot } from "./organization-inbox-sync";
import {
  organizationUsageQuerySince,
  organizationUsageRunJson,
  projectUsageSummaryJson,
} from "./usage-json";
import { responseWithPostCommitCleanup } from "./post-commit-cleanup";
import {
  decodeAccountDeletionInput,
  decodeAccountProfileInput,
  decodeOrganizationMemberRoleInput,
  decodeProjectAgentScheduleBatchClaim,
} from "./account-organization-request-contract";
import {
  decodeExecutionPreferences,
  decodeIssueUpdateInput,
} from "./issue-request-contract";
import {
  decodeProjectAgentScheduleInput,
  decodeProjectAgentSessionInput,
} from "./project-request-contract";
import {
  decodePausedRunReworkInput,
  decodeRunEvent,
  decodeRunEvidenceInput,
  decodeRunReworkInput,
  decodeUsageRangeDays,
  decodeWorkflowStageLifecycleInput,
  parseProjectSettingsInput,
} from "./run-request-contract";
import {
  decodeProjectAgentScheduleRunCompletion,
  decodeWorkerRegister,
  decodeWorkerSettings,
} from "./worker-request-contract";
import { decodeTranscriptRequest } from "./transcript-request";
import { slackCreateIssueShortcutCallbackId } from "./slack";

const createScheduledTaskDependencies = (): ScheduledTaskDependencies => ({
  cleanupExpiredChannelReplySessions: vi.fn(async () => []),
  archiveCompletedLogs: vi.fn(async () => ({
    attemptedObjects: 0,
    completedObjects: 0,
    archivedRows: 0,
    failures: [],
  })),
  expireArchives: vi.fn(async () => 0),
  processArchiveCleanupQueue: vi.fn(async () => ({ deleted: 0, failed: 0 })),
  processSlackRevocationQueue: vi.fn(async () => ({
    revoked: 0,
    failed: 0,
    deadLettered: 0,
    deferred: 0,
  })),
  pruneExpiredDashboardChanges: vi.fn(async () => ({
    cutoff: "2026-08-03 00:00:00",
    deleted: 0,
    reachedBatchLimit: false,
  })),
  reconcileEnabledMergeQueueRuns: vi.fn(async () => ({
    runs: 0,
    registered: 0,
  })),
  reconcileGithubMergedRuns: vi.fn(async () => ({
    examined: 0,
    resumed: 0,
    alreadyResumed: 0,
    deferred: 0,
  })),
  reconcileManagedComputers: vi.fn(async () => ({
    skipped: true as const,
    reason: "not_configured" as const,
  })),
});
const scheduledController = (cron: string): ScheduledController => ({
  cron,
  scheduledTime: Date.parse("2026-08-10T00:17:00.000Z"),
  noRetry: vi.fn(),
});

const scheduledContext = () => {
  const pending: Promise<unknown>[] = [];
  return {
    context: {
      waitUntil(promise: Promise<unknown>) {
        pending.push(promise);
      },
    } as unknown as ExecutionContext,
    pending,
  };
};

const scheduledEnv = {
  DB: {} as D1Database,
  ARCHIVES: {} as R2Bucket,
  ATTACHMENTS: {} as R2Bucket,
} as unknown as Env;

describe("Worker HTTP contract", () => {
  it("skips the organization Inbox snapshot when its ETag is unchanged", async () => {
    const loadSnapshot = vi.fn(async () => ({ messages: ["expensive"] }));
    const result = await loadOrganizationInboxConditionalSnapshot({
      organizationId: "22222222-2222-4222-8222-222222222222",
      ifNoneMatch:
        'W/"organization-inbox:22222222-2222-4222-8222-222222222222:7"',
      readVersion: async () => 7,
      loadSnapshot,
    });

    expect(result).toEqual({
      etag: 'W/"organization-inbox:22222222-2222-4222-8222-222222222222:7"',
      snapshot: null,
    });
    expect(loadSnapshot).not.toHaveBeenCalled();
  });

  it("returns a committed response while cleanup remains registered in waitUntil", async () => {
    let resolveCleanup: ((value: unknown) => void) | undefined;
    const cleanup = new Promise<unknown>((resolve) => {
      resolveCleanup = resolve;
    });
    const scheduled = scheduledContext();
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const response = responseWithPostCommitCleanup(
        new Response(null, { status: 204 }),
        {
          context: scheduled.context,
          operation: "issue_delete",
          observedAt: "2026-08-11T00:00:00.000Z",
          tasks: [{ queue: "archive", run: () => cleanup }],
        },
      );

      expect(response.status).toBe(204);
      expect(scheduled.pending).toHaveLength(1);
      let settled = false;
      void scheduled.pending[0].then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);

      resolveCleanup?.({
        deleted: 1,
        failed: 0,
        encryptedCredential: "must-not-be-logged",
      });
      await scheduled.pending[0];
      expect(consoleLog).toHaveBeenCalledOnce();
      const log = String(consoleLog.mock.calls[0]?.[0]);
      expect(log).toContain('"deleted":1');
      expect(log).not.toContain("must-not-be-logged");
    } finally {
      consoleLog.mockRestore();
    }
  });

  it("keeps a successful response independent from rejected cleanup without a context", async () => {
    const secret = "xoxb-must-not-be-logged";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = responseWithPostCommitCleanup(
        new Response(null, { status: 204 }),
        {
          operation: "slack_uninstall",
          observedAt: "2026-08-11T00:00:00.000Z",
          tasks: [{
            queue: "slack",
            run: async () => {
              throw new Error(secret);
            },
          }],
        },
      );

      expect(response.status).toBe(204);
      await vi.waitFor(() => expect(consoleError).toHaveBeenCalledOnce());
      const log = String(consoleError.mock.calls[0]?.[0]);
      expect(log).toContain("Post-commit cleanup task rejected");
      expect(log).toContain('"errorType":"Error"');
      expect(log).not.toContain(secret);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("reads the channel cursor before its catalog snapshot", async () => {
    const reads: string[] = [];
    const snapshot = await loadChannelCatalogSnapshot(
      async () => {
        reads.push("cursor");
        return 41;
      },
      async () => {
        reads.push("channels");
        return [{ id: "channel-created-during-snapshot" }];
      },
    );

    expect(reads).toEqual(["cursor", "channels"]);
    expect(snapshot).toEqual({
      cursor: 41,
      channels: [{ id: "channel-created-during-snapshot" }],
    });
  });

  it("rejects identity overrides on claimed run events", () => {
    const run = { source: "issue", source_key: "existing-identity" } as const;
    expect(() =>
      assertRunEventIdentityNotOverridden({
        run,
        source: "issue",
        sourceKey: "briar-channel-proposal:predictable-id",
      })
    ).toThrow("identity cannot be changed");
    expect(() =>
      assertRunEventIdentityNotOverridden({
        run,
        source: "issue",
        sourceKey: "existing-identity",
      })
    ).not.toThrow();
  });

  it("keeps an Agent-bound channel proposal on its proposed project", () => {
    expect(
      resolveChannelProposalTargetProjectId({
        requestedProjectId: null,
        proposedProjectId: "project-a",
        defaultProjectId: "project-default",
      }),
    ).toBe("project-a");
    expect(() =>
      resolveChannelProposalTargetProjectId({
        requestedProjectId: "project-b",
        proposedProjectId: "project-a",
        defaultProjectId: "project-default",
      })
    ).toThrow("must match the Agent proposal");
    expect(
      resolveChannelProposalTargetProjectId({
        requestedProjectId: "project-b",
        proposedProjectId: null,
        defaultProjectId: "project-default",
      }),
    ).toBe("project-b");
    expect(
      resolveChannelProposalTargetProjectId({
        requestedProjectId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
        proposedProjectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        defaultProjectId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }),
    ).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });

  it("rejects proposals whose original Agent scope cannot be verified", () => {
    const organizationProposal = {
      channelOrganizationId: "organization-a",
      proposedProjectId: "project-a",
      replyAuthorAgentId: "agent-a",
      replyAuthorAgentOrganizationId: "organization-a",
      replyAuthorAgentProjectId: null,
    };
    expect(() => assertChannelProposalAuthorScope(organizationProposal))
      .not.toThrow();
    expect(() =>
      assertChannelProposalAuthorScope({
        ...organizationProposal,
        replyAuthorAgentId: null,
      })
    ).toThrow("can no longer be verified");
    expect(() =>
      assertChannelProposalAuthorScope({
        ...organizationProposal,
        replyAuthorAgentOrganizationId: "organization-b",
      })
    ).toThrow("can no longer be verified");
  });

  it("routes minute and six-hour scheduled work separately", async () => {
    const minuteDependencies = createScheduledTaskDependencies();
    const minute = scheduledContext();
    await handleScheduledTask(
      scheduledController("* * * * *"),
      scheduledEnv,
      minute.context,
      minuteDependencies,
    );
    await Promise.all(minute.pending);
    expect(minuteDependencies.reconcileGithubMergedRuns).toHaveBeenCalledOnce();
    expect(
      minuteDependencies.reconcileEnabledMergeQueueRuns,
    ).toHaveBeenCalledOnce();
    expect(
      minuteDependencies.pruneExpiredDashboardChanges,
    ).not.toHaveBeenCalled();
    expect(minuteDependencies.archiveCompletedLogs).not.toHaveBeenCalled();

    const sweepDependencies = createScheduledTaskDependencies();
    const sweep = scheduledContext();
    await handleScheduledTask(
      scheduledController("17 */6 * * *"),
      scheduledEnv,
      sweep.context,
      sweepDependencies,
    );
    await Promise.all(sweep.pending);
    expect(
      sweepDependencies.pruneExpiredDashboardChanges,
    ).toHaveBeenCalledOnce();
    expect(sweepDependencies.archiveCompletedLogs).toHaveBeenCalledOnce();
    expect(sweepDependencies.expireArchives).toHaveBeenCalledOnce();
    expect(sweepDependencies.processArchiveCleanupQueue).toHaveBeenCalledOnce();
    expect(sweepDependencies.processSlackRevocationQueue).toHaveBeenCalledOnce();
    expect(sweepDependencies.reconcileGithubMergedRuns).toHaveBeenCalledOnce();
    expect(
      sweepDependencies.reconcileEnabledMergeQueueRuns,
    ).not.toHaveBeenCalled();

    const unknownDependencies = createScheduledTaskDependencies();
    const unknown = scheduledContext();
    const unknownController = scheduledController("0 0 * * *");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await handleScheduledTask(
        unknownController,
        scheduledEnv,
        unknown.context,
        unknownDependencies,
      );
      expect(unknown.pending).toHaveLength(0);
      expect(unknownController.noRetry).toHaveBeenCalledOnce();
      expect(
        unknownDependencies.pruneExpiredDashboardChanges,
      ).not.toHaveBeenCalled();
      expect(unknownDependencies.reconcileGithubMergedRuns).not.toHaveBeenCalled();
      expect(
        unknownDependencies.reconcileEnabledMergeQueueRuns,
      ).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("keeps scheduled maintenance running when dashboard pruning fails", async () => {
    const dependencies = createScheduledTaskDependencies();
    dependencies.pruneExpiredDashboardChanges = vi.fn(async () => {
      throw new Error("D1 prune unavailable");
    });
    const scheduled = scheduledContext();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await handleScheduledTask(
        scheduledController("17 */6 * * *"),
        scheduledEnv,
        scheduled.context,
        dependencies,
      );
      await expect(scheduled.pending[0]).rejects.toThrow("D1 prune unavailable");
      expect(dependencies.archiveCompletedLogs).toHaveBeenCalledOnce();
      expect(dependencies.expireArchives).toHaveBeenCalledOnce();
      expect(dependencies.processArchiveCleanupQueue).toHaveBeenCalledOnce();
      expect(dependencies.reconcileGithubMergedRuns).toHaveBeenCalledOnce();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("uses execution settings only from sources matching the claimed reply provider", () => {
    expect(
      issueReplyExecutionConfig({
        provider: "codex",
        preferred: {
          provider: "claude",
          model: "claude-opus-4-1",
          effort: "high",
        },
        requested: {
          provider: "claude",
          model: "claude-sonnet-4-0",
          effort: "medium",
        },
        activeSkill: {
          provider: "claude",
          model: "claude-sonnet-4-0",
          effort: "medium",
        },
        agent: {
          provider: "codex",
          model: "gpt-5.6-sol",
          effort: "xhigh",
        },
      }),
    ).toEqual({ model: "gpt-5.6-sol", effort: "xhigh" });
    expect(
      issueReplyExecutionConfig({
        provider: "codex",
        preferred: {
          provider: "claude",
          model: "claude-opus-4-1",
          effort: "high",
        },
        requested: { provider: null, model: null, effort: null },
        activeSkill: null,
        agent: null,
      }),
    ).toEqual({ model: null, effort: null });
  });

  it("keeps the approved dispatch snapshot ahead of issue preferences", () => {
    expect(
      issueClaimExecutionConfig({
        preferred: {
          provider: "codex",
          model: "gpt-5.6-sol",
          effort: "xhigh",
        },
        requested: {
          provider: "claude",
          model: "claude-sonnet-4-0",
          effort: "medium",
        },
        activeSkill: {
          provider: "grok",
          model: "grok-4",
          effort: "high",
        },
        agent: {
          provider: "codex",
          model: "gpt-5.6-sol",
          effort: "high",
        },
      }),
    ).toEqual({
      provider: "claude",
      model: "claude-sonnet-4-0",
      effort: "medium",
    });

    expect(
      issueReplyExecutionConfig({
        provider: "claude",
        preferred: {
          provider: "claude",
          model: "claude-opus-4-1",
          effort: "high",
        },
        requested: {
          provider: "claude",
          model: "claude-sonnet-4-0",
          effort: "medium",
        },
        activeSkill: null,
        agent: null,
      }),
    ).toEqual({ model: "claude-sonnet-4-0", effort: "medium" });

    expect(
      issueReplyExecutionConfig({
        provider: "codex",
        preferred: {
          provider: "codex",
          model: "run-default",
          effort: "medium",
        },
        requested: {
          provider: "codex",
          model: "run-requested",
          effort: "high",
        },
        activeSkill: {
          provider: "codex",
          model: "mentioned-agent-skill",
          effort: "xhigh",
        },
        agent: {
          provider: "codex",
          model: "mentioned-agent",
          effort: "high",
        },
        prioritizeAgent: true,
      }),
    ).toEqual({ model: "mentioned-agent-skill", effort: "xhigh" });
  });

  it("classifies a malformed project workflow separately from checkpoint policy errors", () => {
    expect(() =>
      parseProjectSettingsInput({
        velenOrg: null,
        dataSource: null,
        linear: { enabled: false, source: null, teamKey: null },
        githubRepository: null,
        workflow: {
          version: 2,
          requirements: [],
          stages: [{ id: "implementing", label: "Implement", required: true }],
          execution: {},
          completion: { requiredStages: ["implementing"] },
        },
      })
    ).toThrow(expect.objectContaining({
      code: "INVALID_PROJECT_WORKFLOW",
      issues: ["version 2 execution.checkpoints is required"],
    }));
  });

  it("preserves structured issues for project workflow shape errors", () => {
    const invalidWorkflow = {
      version: 2,
      strategy: "path",
      commands: { setup: null, test: "bun test", typecheck: null },
      stages: [{ id: "verify", label: "Verify", required: true }],
      execution: {
        mode: "checkpointed",
        checkpoints: [{
          key: "Invalid Key",
          title: "Invalid checkpoint",
          stage: "verify",
          required: true,
          command: "bun test",
        }],
      },
      completion: { requiredStages: ["verify"] },
    };

    try {
      parseProjectSettingsInput({ workflow: invalidWorkflow });
      throw new Error("Expected parseProjectSettingsInput to fail");
    } catch (error) {
      expect(error).toMatchObject({
        code: "INVALID_PROJECT_WORKFLOW",
        message: "Invalid project workflow",
        issues: expect.arrayContaining([
          expect.objectContaining({
            path: ["workflow", "execution", "checkpoints", 0, "key"],
          }),
        ]),
      });
    }
  });

  it("validates idempotent workflow stage lifecycle requests", () => {
    expect(
      decodeWorkflowStageLifecycleInput({
        requestId: "11111111-1111-4111-8111-111111111111",
        attempt: 2,
        revision: 3,
        actor: "briar-workflow",
      }),
    ).toMatchObject({ attempt: 2, revision: 3 });
    expect(() =>
      decodeWorkflowStageLifecycleInput({
        requestId: "not-a-uuid",
        attempt: 0,
        actor: "",
      }),
    ).toThrow();
  });

  it("accepts Worker execution metrics only with a run attempt", () => {
    const metrics = {
      inputTokens: 1_000,
      outputTokens: 250,
      cacheReadTokens: 800,
      cacheWriteTokens: null,
      reasoningOutputTokens: 100,
      totalTokens: 1_250,
      durationMs: 90_000,
    };
    expect(
      decodeTranscriptRequest({
        sessionId: "detached-run",
        runId: "11111111-1111-4111-8111-111111111111",
        runAttempt: 2,
        projectId: "22222222-2222-4222-8222-222222222222",
        workerId: "worker-1",
        agentProvider: "codex",
        executionMetrics: metrics,
        events: [{ sequence: 1, direction: "server", payload: {} }],
      }).executionMetrics,
    ).toEqual(metrics);
    expect(() =>
      decodeTranscriptRequest({
        sessionId: "detached-run",
        runId: "11111111-1111-4111-8111-111111111111",
        agentProvider: "codex",
        executionMetrics: metrics,
        events: [{ sequence: 1, direction: "server", payload: {} }],
      }),
    ).toThrow(/runId and runAttempt/iu);
  });

  it("accepts provider costs only for an exact execution attempt", () => {
    const costRecord = {
      costKey: "codex:turn:turn-1:cost",
      usageKey: null,
      sessionId: "session-1",
      scopeId: "turn-1",
      turnId: "turn-1",
      agentProvider: "codex" as const,
      modelProvider: "openai",
      model: "gpt-5.6-sol",
      canonicalModel: null,
      modelSource: "providerReported" as const,
      source: "codex.turn.completed.cost",
      amountUsdTicks: 12_345_678,
      observedAt: "2026-08-10T00:00:00.000Z",
    };
    const input = {
      sessionId: "detached-run",
      runId: "11111111-1111-4111-8111-111111111111",
      runAttempt: 2,
      executionId: "33333333-3333-4333-8333-333333333333",
      projectId: "22222222-2222-4222-8222-222222222222",
      workerId: "worker-1",
      agentProvider: "codex" as const,
      costRecords: [costRecord],
      events: [{ sequence: 1, direction: "server" as const, payload: {} }],
    };

    expect(decodeTranscriptRequest(input).costRecords).toEqual([costRecord]);
    expect(() =>
      decodeTranscriptRequest({ ...input, executionId: undefined }),
    ).toThrow(/executionId is required with costRecords/iu);
    expect(() =>
      decodeTranscriptRequest({ ...input, runAttempt: undefined }),
    ).toThrow(/runAttempt is required with costRecords/iu);
  });

  it("bounds organization usage windows to the supported calendar ranges", () => {
    expect(decodeUsageRangeDays("7")).toBe(7);
    expect(decodeUsageRangeDays("30")).toBe(30);
    expect(decodeUsageRangeDays("90")).toBe(90);
    for (const invalid of ["", "0", "91", "7.5", "all"]) {
      expect(() => decodeUsageRangeDays(invalid)).toThrow();
    }
    expect(
      organizationUsageQuerySince(
        90,
        Date.parse("2026-08-09T12:00:00.000Z"),
      ),
    ).toBe("2026-05-10T12:00:00.000Z");
  });

  it("serializes only the lightweight usage run projection", () => {
    const result = organizationUsageRunJson({
      id: "11111111-1111-4111-8111-111111111111",
      project_id: "22222222-2222-4222-8222-222222222222",
      status: "running",
      paused_at: "2026-08-01T00:01:00.000Z",
      execution_metrics_json: JSON.stringify({
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 80,
        cacheWriteTokens: null,
        reasoningOutputTokens: 5,
        totalTokens: 120,
        durationMs: 1_000,
      }),
      claimed_by: "worker",
      claimed_at: "2026-08-01T00:00:00.000Z",
      claim_attempts: 1,
      worker_id: "worker-1",
      preferred_agent_provider: null,
      preferred_agent_model: null,
      requested_agent_provider: "codex",
      requested_agent_model: "gpt-5.6-sol",
      execution_provider: "codex",
      execution_model: "gpt-5.6-sol",
      started_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:01:00.000Z",
      completed_at: null,
    }, {
      costRecords: [
        {
          execution_id: "33333333-3333-4333-8333-333333333333",
          run_id: "11111111-1111-4111-8111-111111111111",
          project_id: "22222222-2222-4222-8222-222222222222",
          run_attempt: 1,
          claim_attempt: 1,
          worker_id: "worker-1",
          claimed_at: "2026-08-01T00:00:00.000Z",
          cost_key: "codex:turn:turn-1:cost",
          usage_key: "codex:turn:turn-1:usage",
          session_id: "session-1",
          turn_id: "turn-1",
          scope_id: "turn-1",
          agent_provider: "codex",
          model_provider: "openai",
          model: "gpt-5.6-sol",
          canonical_model: null,
          model_source: "providerReported",
          source: "codex.turn.completed.cost",
          amount_usd_ticks: 12_345_678,
          observed_at: "2026-08-01T00:01:00.000Z",
          recorded_at: "2026-08-01T00:01:01.000Z",
        },
      ],
      estimatedCostRecords: [
        {
          executionId: "44444444-4444-4444-8444-444444444444",
          projectId: "22222222-2222-4222-8222-222222222222",
          runAttempt: 1,
          claimAttempt: 1,
          workerId: "worker-1",
          claimedAt: "2026-08-01T00:00:00.000Z",
          usageKey: "codex:turn:turn-2:usage",
          sessionId: "session-1",
          scopeId: "turn-2",
          turnId: "turn-2",
          agentProvider: "codex",
          modelProvider: "openai",
          model: "gpt-5.6-sol",
          canonicalModel: null,
          modelSource: "providerReported",
          usageSource: "codex.turn.completed.usage",
          pricingKey: "gpt-5.6-sol",
          amountUsdTicks: 2_500_000,
          observedAt: "2026-08-01T00:02:00.000Z",
          costSource: "modelPriced",
        },
      ],
    });

    expect(result).toMatchObject({
      projectId: "22222222-2222-4222-8222-222222222222",
      status: "paused",
      executionProvider: "codex",
      executionModel: "gpt-5.6-sol",
      executionMetrics: { totalTokens: 120 },
      costRecords: [
        {
          costKey: "codex:turn:turn-1:cost",
          usageKey: "codex:turn:turn-1:usage",
          costSource: "providerReported",
          amountUsdTicks: 12_345_678,
        },
      ],
      estimatedCostRecords: [
        {
          usageKey: "codex:turn:turn-2:usage",
          pricingKey: "gpt-5.6-sol",
          costSource: "modelPriced",
          amountUsdTicks: 2_500_000,
        },
      ],
    });
    expect(result).not.toHaveProperty("workflow");
    expect(result).not.toHaveProperty("attachments");
    expect(result).not.toHaveProperty("events");
    expect(
      organizationUsageRunJson({
        ...({
          id: "11111111-1111-4111-8111-111111111111",
          project_id: "22222222-2222-4222-8222-222222222222",
          status: "completed",
          paused_at: null,
          claimed_by: null,
          claimed_at: null,
          claim_attempts: 1,
          worker_id: null,
          preferred_agent_provider: null,
          preferred_agent_model: null,
          requested_agent_provider: null,
          requested_agent_model: null,
          execution_provider: null,
          execution_model: null,
          started_at: "2026-08-01T00:00:00.000Z",
          updated_at: "2026-08-01T00:01:00.000Z",
          completed_at: "2026-08-01T00:01:00.000Z",
        } as const),
        execution_metrics_json: "not-json",
      }).executionMetrics,
    ).toBeNull();
  });

  it("reduces project usage ledger totals to a home-page summary", () => {
    const generatedAt = Date.parse("2026-08-12T12:00:00.000Z");
    const summary = projectUsageSummaryJson([{
      id: "11111111-1111-4111-8111-111111111111",
      project_id: "22222222-2222-4222-8222-222222222222",
      status: "completed",
      paused_at: null,
      execution_metrics_json: JSON.stringify({
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 80,
        cacheWriteTokens: null,
        reasoningOutputTokens: 5,
        totalTokens: 120,
        durationMs: 1_000,
      }),
      claimed_by: "worker",
      claimed_at: "2026-08-10T00:00:00.000Z",
      claim_attempts: 1,
      worker_id: "worker-1",
      preferred_agent_provider: null,
      preferred_agent_model: null,
      requested_agent_provider: "codex",
      requested_agent_model: "gpt-5.6-sol",
      execution_provider: "codex",
      execution_model: "gpt-5.6-sol",
      started_at: "2026-08-10T00:00:00.000Z",
      updated_at: "2026-08-10T00:01:00.000Z",
      completed_at: "2026-08-10T00:01:00.000Z",
      has_usage_ledger: 1,
      source_created_at: "2026-08-09T00:00:00.000Z",
      created_by_user_id: "user-1",
      created_by_name: "Ada",
      agent_id: "agent-1",
      agent_name: "Mango",
    }], [{
      run_id: "11111111-1111-4111-8111-111111111111",
      total_tokens: 37,
      usage_records: 2,
      observed_at: "2026-08-10T00:00:30.000Z",
    }], "day", generatedAt);

    expect(summary).toMatchObject({
      period: "day",
      rangeStart: "2026-07-30T00:00:00.000Z",
      rangeEnd: "2026-08-13T00:00:00.000Z",
      totalTokens: 37,
      trackedDurationMs: 1_000,
      observedRuns: 1,
      reportedRuns: 1,
      completedIssues: 1,
      issueCreators: [{ id: "user-1", name: "Ada", issues: 1 }],
      agents: [{ id: "agent-1", name: "Mango", issues: 1 }],
      generatedAt: "2026-08-12T12:00:00.000Z",
    });
    expect(summary.timeline.at(-3)).toMatchObject({
      startAt: "2026-08-10T00:00:00.000Z",
      completedIssues: 1,
      totalTokens: 37,
    });
  });

  it("accepts preferred provider and model on issue creation", async () => {
    const issueRequest = () =>
      new Request(
        "https://briar-api.example/projects/22222222-2222-4222-8222-222222222222/issues",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: "선호 프로바이더 이슈",
            description: null,
            priority: 2,
            assigneeUserId: null,
            status: "queued",
            preferredProvider: "claude",
            preferredModel: "sonnet",
            preferredEffort: "high",
            fullAuto: true,
          }),
        },
      );
    const { input } = await readIssueRequest(issueRequest());
    expect(input.preferredProvider).toBe("claude");
    expect(input.preferredModel).toBe("sonnet");
    expect(input.preferredEffort).toBe("high");
    expect(input.fullAuto).toBe(true);
  });

  it("rejects an effort preference without a provider on issue creation", async () => {
    const issueRequest = () =>
      new Request(
        "https://briar-api.example/projects/22222222-2222-4222-8222-222222222222/issues",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: "잘못된 선호 effort",
            description: null,
            priority: 2,
            assigneeUserId: null,
            status: "queued",
            preferredProvider: null,
            preferredModel: null,
            preferredEffort: "high",
          }),
        },
      );
    await expect(readIssueRequest(issueRequest())).rejects.toThrow();
  });

  it("rejects an effort preference without a model on issue creation", async () => {
    const issueRequest = () =>
      new Request(
        "https://briar-api.example/projects/22222222-2222-4222-8222-222222222222/issues",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: "잘못된 선호 effort",
            description: null,
            priority: 2,
            assigneeUserId: null,
            status: "queued",
            preferredProvider: "claude",
            preferredModel: null,
            preferredEffort: "high",
          }),
        },
      );
    await expect(readIssueRequest(issueRequest())).rejects.toThrow();
  });

  it("rejects a preferred model without a provider on issue creation", async () => {
    const issueRequest = () =>
      new Request(
        "https://briar-api.example/projects/22222222-2222-4222-8222-222222222222/issues",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: "잘못된 선호 모델",
            description: null,
            priority: 2,
            assigneeUserId: null,
            status: "queued",
            preferredProvider: null,
            preferredModel: "sonnet",
          }),
        },
      );
    await expect(readIssueRequest(issueRequest())).rejects.toThrow();
  });

  it("accepts provider-owned models without a server release", async () => {
    const issueRequest = () =>
      new Request(
        "https://briar-api.example/projects/22222222-2222-4222-8222-222222222222/issues",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: "지원하지 않는 모델",
            description: null,
            priority: 2,
            assigneeUserId: null,
            status: "queued",
            preferredProvider: "codex",
            preferredModel: "sonnet",
          }),
        },
      );
    await expect(readIssueRequest(issueRequest())).resolves.toMatchObject({
      input: { preferredProvider: "codex", preferredModel: "sonnet" },
    });
  });

  it("requires an email confirmation for account deletion", () => {
    expect(
      decodeAccountDeletionInput({
        confirmation: " jay@example.com ",
      }),
    ).toEqual({ confirmation: "jay@example.com" });
    expect(() =>
      decodeAccountDeletionInput({ confirmation: "DELETE" }),
    ).toThrow();
    expect(() =>
      decodeAccountDeletionInput({
        confirmation: "jay@example.com",
        bypass: true,
      }),
    ).toThrow();
  });

  it("normalizes and validates account profiles", () => {
    expect(
      decodeAccountProfileInput({
        username: " Jay_Dev ",
        name: " Jay Kim ",
        image: "data:image/webp;base64,aA==",
      }),
    ).toEqual({
      username: "jay_dev",
      name: "Jay Kim",
      image: "data:image/webp;base64,aA==",
    });
    expect(
      decodeAccountProfileInput({
        username: "jay_dev",
        name: "Jay Kim",
        image: "https://lh3.googleusercontent.com/a/example=s96-c",
      }),
    ).toEqual({
      username: "jay_dev",
      name: "Jay Kim",
      image: "https://lh3.googleusercontent.com/a/example=s96-c",
    });
    expect(() =>
      decodeAccountProfileInput({
        username: "has spaces",
        name: "Jay",
        image: null,
      }),
    ).toThrow();
    expect(() =>
      decodeAccountProfileInput({
        username: "jay",
        name: "Jay",
        image: "data:image/svg+xml;base64,aA==",
      }),
    ).toThrow();
    expect(() =>
      decodeAccountProfileInput({
        username: "jay",
        name: "Jay",
        image: "http://example.com/avatar.png",
      }),
    ).toThrow();
  });

  it("validates structural issue model effort preferences", () => {
    expect(
      decodeExecutionPreferences({
        provider: "codex",
        model: "gpt-5.6-sol",
        effort: "ultra",
      }),
    ).toEqual({
      provider: "codex",
      model: "gpt-5.6-sol",
      effort: "ultra",
    });
    expect(() =>
      decodeExecutionPreferences({
        provider: null,
        model: "gpt-5.6-sol",
        effort: null,
      }),
    ).toThrow(/provider is required/iu);
    expect(
      decodeExecutionPreferences({
        provider: "grok",
        model: "grok-4.6",
        effort: "xhigh",
      }),
    ).toEqual({ provider: "grok", model: "grok-4.6", effort: "xhigh" });
  });

  it("accepts one Worker emoji or image and rejects invalid icon text", () => {
    expect(
      decodeWorkerSettings({
        icon: { type: "emoji", value: "👩🏽‍💻" },
      }),
    ).toEqual({ icon: { type: "emoji", value: "👩🏽‍💻" } });
    expect(
      decodeWorkerSettings({
        icon: { type: "image", value: "data:image/webp;base64,aA==" },
      }),
    ).toEqual({
      icon: { type: "image", value: "data:image/webp;base64,aA==" },
    });
    expect(() =>
      decodeWorkerSettings({
        icon: { type: "emoji", value: "worker" },
      }),
    ).toThrow(/one emoji/u);
    expect(decodeWorkerSettings({ icon: null })).toEqual({ icon: null });
  });

  it("accepts Worker provider usage health and all supported providers during registration", () => {
    expect(
      decodeWorkerRegister({
        label: "janet",
        deviceIdentity: `briar_device_${"a".repeat(64)}`,
        agentProvider: "codex",
        providers: [
          "codex",
          "claude",
          "cursor",
          "grok",
          "agy",
          "opencode",
          "openrouter",
        ],
        providerHealth: {
          codex: {
            installed: true,
            authenticated: true,
            healthy: true,
            reason: null,
            usageExhausted: false,
            maxUsedPercent: 3,
          },
          claude: {
            installed: true,
            authenticated: true,
            healthy: true,
            reason: null,
            usageExhausted: false,
            maxUsedPercent: null,
          },
          cursor: {
            installed: true,
            authenticated: true,
            healthy: true,
            reason: null,
            usageExhausted: false,
            maxUsedPercent: null,
          },
          grok: {
            installed: true,
            authenticated: true,
            healthy: false,
            reason: "usage_exhausted",
            usageExhausted: true,
            maxUsedPercent: 100,
          },
          agy: {
            installed: true,
            authenticated: true,
            healthy: true,
            reason: null,
            usageExhausted: false,
            maxUsedPercent: null,
          },
          opencode: {
            installed: true,
            authenticated: true,
            healthy: true,
            reason: null,
            usageExhausted: false,
            maxUsedPercent: null,
          },
          openrouter: {
            installed: true,
            authenticated: true,
            healthy: true,
            reason: null,
            usageExhausted: false,
            maxUsedPercent: null,
          },
        },
        versions: { briar: "1.2.116" },
      }),
    ).toMatchObject({
      providers: [
        "codex",
        "claude",
        "cursor",
        "grok",
        "agy",
        "opencode",
        "openrouter",
      ],
      providerHealth: {
        codex: { usageExhausted: false, maxUsedPercent: 3 },
        claude: { usageExhausted: false, maxUsedPercent: null },
        cursor: { usageExhausted: false, maxUsedPercent: null },
        grok: { usageExhausted: true, maxUsedPercent: 100 },
        agy: { usageExhausted: false, maxUsedPercent: null },
        opencode: { usageExhausted: false, maxUsedPercent: null },
        openrouter: { usageExhausted: false, maxUsedPercent: null },
      },
    });
  });

  it("requires an actionable structured handoff for blocked work", () => {
    const blockedEvent = {
      runId: "11111111-1111-4111-8111-111111111111",
      status: "blocked" as const,
      eventKey: "BRIAR-42:blocked:github-auth",
      occurredAt: "2026-07-31T00:00:00.000Z",
      actor: "briar-workflow",
      repository: "example/briar",
      detail:
        "GitHub sign-in expired, so Briar cannot open the pull request and review cannot begin.",
      structuredResult: {
        summary:
          "GitHub sign-in expired, so Briar cannot open the pull request and review cannot begin.",
        outcome: "blocked" as const,
        importance: "important" as const,
        urgency: "normal" as const,
        impact: "issue" as const,
        humanActionRequired: true,
        nextAction:
          "A repository owner should sign in to GitHub on the worker computer, confirm the account is active, and retry this issue.",
        dueAt: null,
      },
    };

    expect(decodeRunEvent(blockedEvent).structuredResult?.nextAction).toContain(
      "repository owner",
    );
    expect(() =>
      decodeRunEvent({ ...blockedEvent, structuredResult: null }),
    ).toThrow(/structured blocked result/u);
    expect(() =>
      decodeRunEvent({
        ...blockedEvent,
        structuredResult: {
          ...blockedEvent.structuredResult,
          outcome: "failed",
        },
      }),
    ).toThrow(/blocked structured outcome/u);
    expect(() =>
      decodeRunEvent({
        ...blockedEvent,
        structuredResult: {
          ...blockedEvent.structuredResult,
          humanActionRequired: false,
          nextAction: null,
        },
      }),
    ).toThrow(/exact human next action/u);
  });

  it("validates synchronized agent session snapshots", () => {
    const snapshot = {
        dispatchGroupId: "dispatch-1",
        agentId: "11111111-1111-4111-8111-111111111111",
        agentName: "Inbox Agent",
        sessionType: "dispatch",
        trigger: "manual",
        scheduleId: null,
        scheduleRunId: null,
        parentSessionId: null,
        request: "Process queued issues",
        status: "running",
        issues: [{
          runId: "run-1",
          runNumber: 1,
          sourceKey: "AH-1",
          title: "Synchronize agent state",
          outcome: "pending",
          summary: null,
        }],
        startedAt: "2026-07-30T00:00:00.000Z",
        completedAt: null,
        conversationId: null,
        summary: null,
        error: null,
        events: [{
          id: "event-1",
          type: "started",
          occurredAt: "2026-07-30T00:00:00.000Z",
        }],
        updatedAt: "2026-07-30T00:00:00.000Z",
      };
    expect(decodeProjectAgentSessionInput(snapshot)).toMatchObject({
      agentName: "Inbox Agent",
      status: "running",
    });
    expect(
      decodeProjectAgentSessionInput({
        ...snapshot,
        status: "skipped",
        completedAt: "2026-07-30T00:01:00.000Z",
        summary: "No queued issues.",
        events: [
          ...snapshot.events,
          {
            id: "event-2",
            type: "skipped",
            occurredAt: "2026-07-30T00:01:00.000Z",
          },
        ],
        updatedAt: "2026-07-30T00:01:00.000Z",
      }).status,
    ).toBe("skipped");
  });

  it("accepts only assignable organization member roles", () => {
    expect(decodeOrganizationMemberRoleInput({ role: "admin" })).toEqual({
      role: "admin",
    });
    expect(() =>
      decodeOrganizationMemberRoleInput({ role: "owner" }),
    ).toThrow();
  });

  it("accepts exact workflow evidence names containing spaces and slashes", () => {
    expect(
      decodeRunEvidenceInput({
        evidenceKey: "LOCAL-1:local_qa:signoff",
        stage: "local_qa",
        type: "  signoff/app worker  ",
        status: "passed",
        observedAt: "2026-07-28T00:00:00.000Z",
        actor: "briar-workflow",
      }).type,
    ).toBe("signoff/app worker");
  });

  it("parses evidence images from multipart CLI requests", async () => {
    const evidence = {
      evidenceKey: "LOCAL-1:local_qa:screenshot",
      stage: "local_qa",
      type: "ui_screenshot",
      status: "passed",
      observedAt: "2026-07-28T00:00:00.000Z",
      actor: "briar-workflow",
    };
    const form = new FormData();
    form.append("evidence", JSON.stringify(evidence));
    form.append(
      "images",
      new File([new Uint8Array([137, 80, 78, 71])], "dashboard.png", {
        type: "image/png",
      }),
    );

    const parsed = await readRunEvidenceRequest(
      new Request("https://briar-api.example/runs/run/evidence", {
        method: "POST",
        headers: { "Content-Length": "1024" },
        body: form,
      }),
    );

    expect(parsed.input).toEqual(evidence);
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.name).toBe("dashboard.png");
    expect(parsed.images[0]?.type).toBe("image/png");
  });

  it("accepts transcript batches above the generic JSON body limit", async () => {
    const payload = {
      sessionId: "large-transcript-session",
      agentProvider: "codex" as const,
      events: Array.from({ length: 20 }, (_, index) => ({
        sequence: index + 1,
        direction: "server" as const,
        payload: { text: "x".repeat(16 * 1024) },
      })),
    };
    const body = JSON.stringify(payload);
    expect(new TextEncoder().encode(body).byteLength).toBeGreaterThan(262_144);

    await expect(readTranscriptRequest(new Request(
      "https://briar-api.example/transcripts",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      },
    ))).resolves.toEqual(payload);
  });

  it("keeps the transcript-specific JSON body limit bounded", async () => {
    const body = JSON.stringify({
      sessionId: "oversized-transcript-session",
      agentProvider: "codex",
      events: Array.from({ length: 70 }, (_, index) => ({
        sequence: index + 1,
        direction: "server",
        payload: { text: "x".repeat(16 * 1024) },
      })),
    });

    await expect(readTranscriptRequest(new Request(
      "https://briar-api.example/transcripts",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      },
    ))).rejects.toThrow("Request body too large");
  });

  it("maps Effect transcript schema failures to an HTTP 400 response", async () => {
    const response = await worker.fetch(
      new Request("https://briar-api.example/transcripts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: "invalid-transcript",
          agentProvider: "codex",
          events: [],
        }),
      }),
      {
        BETTER_AUTH_SECRET: "test-secret-at-least-thirty-two-characters",
        GOOGLE_CLIENT_ID: "test-client",
        GOOGLE_CLIENT_SECRET: "test-secret",
      } as never,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: "Invalid request",
      issues: [{
        path: ["events"],
        message: expect.any(String),
      }],
    });
  });

  it("parses channel reply images from multipart Worker complete requests", async () => {
    const complete = {
      organizationId: "11111111-1111-4111-8111-111111111111",
      workerId: "worker-1",
      claimToken: "briar_channel_claim_secret",
      result: {
        body: "Here is the captured screen.",
        document: null,
        issueProposal: null,
      },
    };
    const form = new FormData();
    form.append("complete", JSON.stringify(complete));
    form.append(
      "attachments",
      new File([new Uint8Array([137, 80, 78, 71])], "screenshot.png", {
        type: "image/png",
      }),
    );

    const parsed = await readChannelReplyCompleteRequest(
      new Request("https://briar-api.example/channel-reply-claims/job/complete", {
        method: "POST",
        headers: { "Content-Length": "2048" },
        body: form,
      }),
    );

    expect(parsed.input).toMatchObject({
      organizationId: complete.organizationId,
      workerId: "worker-1",
      result: { body: "Here is the captured screen." },
    });
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]).toMatchObject({
      name: "screenshot.png",
      type: "image/png",
    });
  });

  it("keeps JSON channel reply completion compatible when no image is attached", async () => {
    const parsed = await readChannelReplyCompleteRequest(
      new Request("https://briar-api.example/channel-reply-claims/job/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId: "11111111-1111-4111-8111-111111111111",
          workerId: "worker-1",
          claimToken: "briar_channel_claim_secret",
          result: { body: "Answer", document: null, issueProposal: null },
        }),
      }),
    );
    expect(parsed.attachments).toEqual([]);
    expect(parsed.input.result).toMatchObject({ body: "Answer" });
  });

  it("parses issue reply images from the shared multipart completion contract", async () => {
    const complete = {
      projectId: "11111111-1111-4111-8111-111111111111",
      workerId: "worker-1",
      claimToken: `briar_reply_claim_${"a".repeat(64)}`,
      body: "Here is the generated mockup.",
      proposedAction: null,
      executionProposal: null,
      skillExecutionProposal: null,
    };
    const form = new FormData();
    form.append("complete", JSON.stringify(complete));
    form.append(
      "attachments",
      new File([new Uint8Array([137, 80, 78, 71])], "mockup.png", {
        type: "image/png",
      }),
    );

    const parsed = await readIssueReplyCompleteRequest(
      new Request("https://briar-api.example/issue-reply-claims/job/complete", {
        method: "POST",
        headers: { "Content-Length": "2048" },
        body: form,
      }),
    );

    expect(parsed.input).toMatchObject(complete);
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]).toMatchObject({
      name: "mockup.png",
      type: "image/png",
    });
  });

  it("keeps JSON issue reply completion compatible without images", async () => {
    const parsed = await readIssueReplyCompleteRequest(
      new Request("https://briar-api.example/issue-reply-claims/job/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: "11111111-1111-4111-8111-111111111111",
          workerId: "worker-1",
          claimToken: `briar_reply_claim_${"b".repeat(64)}`,
          body: "Answer",
        }),
      }),
    );
    expect(parsed.attachments).toEqual([]);
    expect(parsed.input.body).toBe("Answer");
  });

  it("rejects a failed channel reply that also includes images", async () => {
    const form = new FormData();
    form.append("complete", JSON.stringify({
      organizationId: "11111111-1111-4111-8111-111111111111",
      workerId: "worker-1",
      claimToken: "briar_channel_claim_secret",
      error: "provider unavailable",
    }));
    form.append(
      "attachments",
      new File([new Uint8Array([137, 80, 78, 71])], "screenshot.png", {
        type: "image/png",
      }),
    );
    await expect(
      readChannelReplyCompleteRequest(
        new Request("https://briar-api.example/channel-reply-claims/job/complete", {
          method: "POST",
          headers: { "Content-Length": "2048" },
          body: form,
        }),
      ),
    ).rejects.toThrow("cannot include images");
  });

  it("requires an explicit earlier stage and reason for run rework", () => {
    expect(
      decodeRunReworkInput({
        requestId: "11111111-1111-4111-8111-111111111111",
        workflowStage: "implementing",
        reason: "Local QA found a product-code defect.",
        actor: "briar-workflow",
      }),
    ).toEqual({
      requestId: "11111111-1111-4111-8111-111111111111",
      workflowStage: "implementing",
      reason: "Local QA found a product-code defect.",
      actor: "briar-workflow",
    });
    expect(() =>
      decodeRunReworkInput({
        requestId: "11111111-1111-4111-8111-111111111111",
        workflowStage: "implementing",
        reason: " ",
        actor: "briar-workflow",
      }),
    ).toThrow();
  });

  it("requires exact checkpoint identity for paused run rework", () => {
    expect(
      decodePausedRunReworkInput({
        requestId: "11111111-1111-4111-8111-111111111111",
        workflowStage: "local_qa",
        reason: "Keep the result in the Result tab and verify the revised copy.",
        checkpointKey: "after-local-qa",
        attempt: 2,
        revision: 3,
      }),
    ).toMatchObject({
      workflowStage: "local_qa",
      checkpointKey: "after-local-qa",
      attempt: 2,
      revision: 3,
    });
    expect(() =>
      decodePausedRunReworkInput({
        requestId: "11111111-1111-4111-8111-111111111111",
        workflowStage: "local_qa",
        reason: "Apply review feedback",
        checkpointKey: "after-local-qa",
        attempt: 2,
      }),
    ).toThrow();
  });

  it("normalizes recurring agent schedule input", () => {
    expect(
      decodeProjectAgentScheduleInput({
        agentId: "11111111-1111-4111-8111-111111111111",
        name: "  Weekly audit  ",
        recurrence: "weekly",
        timeOfDay: "09:30",
        dayOfWeek: 1,
        timeZone: "Asia/Seoul",
      }),
    ).toEqual({
      agentId: "11111111-1111-4111-8111-111111111111",
      name: "Weekly audit",
      recurrence: "weekly",
      timeOfDay: "09:30",
      dayOfWeek: 1,
      intervalValue: 1,
      intervalUnit: "day",
      daysOfWeek: [],
      notificationLevel: "important_updates",
      timeZone: "Asia/Seoul",
    });
    expect(
      decodeProjectAgentScheduleInput({
        agentId: "11111111-1111-4111-8111-111111111111",
        name: "Daily audit",
        recurrence: "daily",
        timeOfDay: "08:00",
        dayOfWeek: 4,
        timeZone: "Etc/UTC",
      }).dayOfWeek,
    ).toBeNull();
    expect(() =>
      decodeProjectAgentScheduleInput({
        agentId: "11111111-1111-4111-8111-111111111111",
        name: "Invalid zone",
        recurrence: "daily",
        timeOfDay: "08:00",
        timeZone: "Mars/Olympus",
      }),
    ).toThrow(/Invalid IANA time zone/u);
  });

  it("normalizes custom schedule days and requires a weekly selection", () => {
    expect(
      decodeProjectAgentScheduleInput({
        agentId: "11111111-1111-4111-8111-111111111111",
        name: "Alternating review",
        recurrence: "custom",
        timeOfDay: "09:00",
        intervalValue: 2,
        intervalUnit: "week",
        daysOfWeek: [5, 1, 5],
        notificationLevel: "none",
        timeZone: "Asia/Seoul",
      }),
    ).toMatchObject({
      recurrence: "custom",
      intervalValue: 2,
      intervalUnit: "week",
      daysOfWeek: [1, 5],
      notificationLevel: "none",
    });
    expect(() =>
      decodeProjectAgentScheduleInput({
        agentId: "11111111-1111-4111-8111-111111111111",
        name: "Missing weekdays",
        recurrence: "custom",
        timeOfDay: "09:00",
        intervalUnit: "week",
        daysOfWeek: [],
        timeZone: "Asia/Seoul",
      }),
    ).toThrow(/Choose at least one weekday/u);
  });

  it("validates editable issue fields", () => {
    expect(
      decodeIssueUpdateInput({
        title: "  Updated issue  ",
        description: null,
        priority: 1,
        assigneeUserId: "member-1",
      }),
    ).toEqual({
      title: "Updated issue",
      description: null,
      priority: 1,
      assigneeUserId: "member-1",
    });
    expect(() =>
      decodeIssueUpdateInput({
        title: "",
        description: null,
        priority: 5,
      }),
    ).toThrow();
  });

  it("requires a matching outcome payload for schedule-run completion", () => {
    const claimToken = `briar_schedule_claim_${"a".repeat(64)}`;
    expect(
      decodeProjectAgentScheduleRunCompletion({
        claimToken,
        status: "completed",
        resultSummary: "Repository audit completed.",
        structuredResult: {
          summary: "Repository audit completed.",
          outcome: "completed",
          importance: "routine",
          urgency: "normal",
          impact: "issue",
          humanActionRequired: false,
          nextAction: null,
          dueAt: null,
        },
        error: null,
      }),
    ).toEqual({
      claimToken,
      status: "completed",
      resultSummary: "Repository audit completed.",
      structuredResult: {
        summary: "Repository audit completed.",
        outcome: "completed",
        importance: "routine",
        urgency: "normal",
        impact: "issue",
        humanActionRequired: false,
        nextAction: null,
        dueAt: null,
      },
      error: null,
    });
    expect(() =>
      decodeProjectAgentScheduleRunCompletion({
        claimToken,
        status: "failed",
        resultSummary: null,
        structuredResult: {
          summary: "Runner stopped.",
          outcome: "failed",
          importance: "important",
          urgency: "time_sensitive",
          impact: "issue",
          humanActionRequired: true,
          nextAction: "Inspect the runner.",
          dueAt: null,
        },
        error: null,
      }),
    ).toThrow(/failed runs require an error/u);
    expect(() =>
      decodeProjectAgentScheduleRunCompletion({
        claimToken,
        status: "completed",
        resultSummary: "A legacy summary.",
        structuredResult: {
          summary: "A structured summary.",
          outcome: "completed",
          importance: "routine",
          urgency: "normal",
          impact: "issue",
          humanActionRequired: false,
          nextAction: null,
          dueAt: null,
        },
        error: null,
      }),
    ).toThrow(/resultSummary must match structuredResult.summary/u);
  });

  it("publishes schedule claims only when the route handles a real claim", () => {
    const projectId = "22222222-2222-4222-8222-222222222222";
    const pathname = `/projects/${projectId}/agent-schedule-runs/claim`;
    expect(projectScheduleClaimMutation(pathname, "POST", 200)).toBe(true);
    expect(projectMutationProject(pathname, "POST", 200)).toBeNull();
    expect(projectScheduleClaimMutation(
      "/agent-schedule-runs/claim",
      "POST",
      200,
    )).toBe(true);
    expect(projectMutationProject(
      `/projects/${projectId}/agent-schedules`,
      "POST",
      201,
    )).toBe(projectId);
    expect(projectMutationProject(
      `/projects/${projectId}/agent-sessions/session-1`,
      "PUT",
      200,
    )).toBeNull();
    expect(decodeProjectAgentScheduleBatchClaim({
      projectIds: [projectId, projectId],
    })).toEqual({ projectIds: [projectId, projectId] });
  });

  it("rejects a GitHub webhook before touching the database when its signature is invalid", async () => {
    const prepare = vi.fn();
    const response = await worker.fetch(
      new Request("https://briar-api.example/github/webhooks", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-delivery": "33333333-3333-4333-8333-333333333333",
          "x-github-event": "ping",
          "x-hub-signature-256": `sha256=${"0".repeat(64)}`,
        },
        body: JSON.stringify({ zen: "Keep it logically awesome." }),
      }),
      {
        DB: { prepare },
        GITHUB_WEBHOOK_SECRET: "github-webhook-test-secret",
      } as never,
    );

    expect(response.status).toBe(401);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("maps malformed GitHub webhook payloads to the GitHub validation response", async () => {
    const secret = "github-webhook-test-secret";
    const body = JSON.stringify({ hook_id: 42 });
    const signature = `sha256=${
      createHmac("sha256", secret).update(body).digest("hex")
    }`;
    const response = await worker.fetch(
      new Request("https://briar-api.example/github/webhooks", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-delivery": "33333333-3333-4333-8333-333333333333",
          "x-github-event": "ping",
          "x-hub-signature-256": signature,
        },
        body,
      }),
      {
        DB: { prepare: vi.fn() },
        GITHUB_WEBHOOK_SECRET: secret,
      } as never,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: "Invalid GitHub webhook",
      issues: [{ path: ["zen"], message: expect.any(String) }],
    });
  });

  it("stops reading an oversized GitHub webhook before signature verification", async () => {
    const prepare = vi.fn();
    const response = await worker.fetch(
      new Request("https://briar-api.example/github/webhooks", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-delivery": "33333333-3333-4333-8333-333333333333",
          "x-github-event": "ping",
          "x-hub-signature-256": `sha256=${"0".repeat(64)}`,
        },
        body: "x".repeat(1_048_577),
      }),
      {
        DB: { prepare },
        GITHUB_WEBHOOK_SECRET: "github-webhook-test-secret",
      } as never,
    );

    expect(response.status).toBe(413);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("acknowledges /create immediately on the command and legacy event URLs", async () => {
    const signingSecret = "test-slack-signing-secret";
    const pendingInstallation = new Promise<never>(() => {});
    const first = vi.fn(() => pendingInstallation);
    const bind = vi.fn(() => ({ first }));
    const prepare = vi.fn(() => ({ bind }));
    const waitUntil = vi.fn();
    const env = {
      DB: { prepare },
      SLACK_SIGNING_SECRET: signingSecret,
    } as never;
    const ctx = {
      waitUntil,
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext;

    const request = (pathname: string) => {
      const body = new URLSearchParams({
        team_id: "T123",
        channel_id: "C123",
        user_id: "U123",
        command: "/create",
        text: "Prefilled title",
        trigger_id: "123.456.test",
        response_url:
          "https://hooks.slack.com/commands/T123/B123/response-token",
      }).toString();
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = `v0=${
        createHmac("sha256", signingSecret)
          .update(`v0:${timestamp}:${body}`)
          .digest("hex")
      }`;
      return new Request(`https://briar-api.example${pathname}`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-slack-request-timestamp": timestamp,
          "x-slack-signature": signature,
        },
        body,
      });
    };

    for (const pathname of ["/slack/commands", "/slack/events"]) {
      const response = await worker.fetch(request(pathname), env, ctx);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("");
    }
    expect(waitUntil).toHaveBeenCalledTimes(2);
    expect(first).toHaveBeenCalledTimes(2);
  });

  it("acknowledges the Briar create-issue global shortcut immediately", async () => {
    const signingSecret = "test-slack-signing-secret";
    const pendingInstallation = new Promise<never>(() => {});
    const first = vi.fn(() => pendingInstallation);
    const bind = vi.fn(() => ({ first }));
    const prepare = vi.fn(() => ({ bind }));
    const waitUntil = vi.fn();
    const env = {
      DB: { prepare },
      SLACK_SIGNING_SECRET: signingSecret,
    } as never;
    const ctx = {
      waitUntil,
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext;
    const body = new URLSearchParams({
      payload: JSON.stringify({
        type: "shortcut",
        callback_id: slackCreateIssueShortcutCallbackId,
        trigger_id: "123.456.shortcut",
        team: { id: "T123" },
        user: { id: "U123" },
      }),
    }).toString();
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = `v0=${createHmac("sha256", signingSecret)
      .update(`v0:${timestamp}:${body}`)
      .digest("hex")}`;

    const response = await worker.fetch(
      new Request("https://briar-api.example/slack/interactions", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-slack-request-timestamp": timestamp,
          "x-slack-signature": signature,
        },
        body,
      }),
      env,
      ctx,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(waitUntil).toHaveBeenCalledOnce();
    expect(first).toHaveBeenCalledOnce();
  });
});
