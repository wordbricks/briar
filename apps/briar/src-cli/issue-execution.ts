import {
  readFile,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import {
  agentExecutionCostRecordsFromObservations,
  agentExecutionMetrics,
  agentExecutionTokenUsageFromObservations,
  agentExecutionUsageRecordsFromObservations,
  createAgentExecutionUsageCollector,
} from "../src/lib/agent-execution-metrics";
import { type ModelEffort } from "../src/lib/agent-provider-contract";
import { type AgentProvider } from "../src/lib/agent-provider";
import {
  createDetachedTranscriptSequencer,
  detachedAgentPrompt,
  detachedPayloadDirection,
  detachedProviderBlockedRunEvent,
  detachedProviderBlockFromPayload,
  detachedRunContinuationPrompt,
  detachedRunDisposition,
  detachedRunRecoveryPrompt,
  detachedRunTurnDecision,
  detachedTranscriptPayload,
  detachedTranscriptSessionId,
  type DetachedAgent,
} from "./agent-runner";
import { agentImageAttachments } from "../src-agent/runner-attachments";
import { sidecarProviderRaw } from "../src-agent/sidecar-protocol";
import {
  detachedProviderTurnFailure,
  logDetachedProviderTurnDiagnostic,
  runDetachedProviderTurn,
} from "./detached-provider-turn";
import { ChannelActivityPublisher } from "./channel-activity-publisher";
import {
  createWorkerTranscriptBatcher,
  reportIssueExecutionTelemetry,
} from "./worker-transcript-client";
import {
  errorDelayMs,
  issueWorkerSessionDirectory,
  interruptibleSleep,
  workerCliPath,
  workerExecutionPath,
  type WorkerExecutionCheckpoint,
} from "./worker";
import {
  maintainTerminalIssueWorktree,
  projectWorktreeRoot,
  recordCompletedWorktree,
} from "./worktree";
import { briarIssueUrl } from "./github-pr";
import {
  decodeConfig,
  type Config,
  type ProjectConfig,
} from "./config-contract";
import {
  decodeDetachedAgentEffortOption,
  decodeDetachedAgentSkillsOption,
} from "./detached-agent-options";
import {
  type ClaimedRun,
  type DetachedAgentClaim,
  type DetachedAgentSkill,
} from "./worker-queue-contract";
import {
  providerExecutionEnvironment,
  configDirectory,
  value,
  saveConfigAt,
  runGit,
  worktreeSettings,
} from "./command-support";
import {
  downloadClaimAttachment,
  allocateClaimWorkspace,
} from "./worktree-commands";
import {
  createAuthenticatedWorkerExecutionClient,
  workClaimIdentityToProto,
} from "./worker-queue-client";
import { workerRunEventRequest } from "./run-event-proto";

const activeReplyActivityPublishers = new Map<
  string,
  ChannelActivityPublisher
>();
const activeCachedAnalysisWorktreePaths = new Map<string, number>();

function retainCachedAnalysisWorktree(path: string) {
  activeCachedAnalysisWorktreePaths.set(
    path,
    (activeCachedAnalysisWorktreePaths.get(path) ?? 0) + 1,
  );
}

function releaseCachedAnalysisWorktree(path: string) {
  const remaining = (activeCachedAnalysisWorktreePaths.get(path) ?? 1) - 1;
  if (remaining <= 0) {
    activeCachedAnalysisWorktreePaths.delete(path);
  } else {
    activeCachedAnalysisWorktreePaths.set(path, remaining);
  }
}

function detachedAgentWithActiveSkill(
  agent: DetachedAgentClaim,
  activeSkill: DetachedAgentSkill | null | undefined,
): DetachedAgent {
  return {
    ...agent,
    activeSkill: activeSkill ?? null,
  };
}

function detachedReplyAgent(input: {
  workId: string;
  provider: AgentProvider;
  model: string | null;
  effort?: ModelEffort | null;
  agent?: DetachedAgentClaim | null;
  activeSkill?: DetachedAgentSkill | null;
  snapshot: Record<string, unknown>;
  fallbackName: string;
  scope?: DetachedAgent["scope"];
}): DetachedAgent {
  const snapshotAgent = Predicate.isObject(input.snapshot.agent)
    ? input.snapshot.agent
    : null;
  const snapshotSkills = decodeDetachedAgentSkillsOption(snapshotAgent?.skills);
  const baseAgent = input.agent ?? {
    id: typeof snapshotAgent?.id === "string" && snapshotAgent.id.trim()
      ? snapshotAgent.id
      : input.workId,
    name: typeof snapshotAgent?.name === "string" && snapshotAgent.name.trim()
      ? snapshotAgent.name
      : input.fallbackName,
    provider: input.provider,
    model: input.model,
    effort:
      typeof snapshotAgent?.effort === "string" &&
        Option.isSome(decodeDetachedAgentEffortOption(snapshotAgent.effort))
        ? snapshotAgent.effort
        : null,
    responsibility: typeof snapshotAgent?.responsibility === "string"
      ? snapshotAgent.responsibility
      : "",
    skill: typeof snapshotAgent?.skill === "string" ? snapshotAgent.skill : "",
    skills: Option.getOrElse(snapshotSkills, () => []),
  };
  return {
    ...baseAgent,
    // The top-level execution fields are snapshotted by the server and remain
    // authoritative during rolling upgrades, even when Agent defaults change.
    provider: input.provider,
    model: input.model,
    effort: input.effort !== undefined
      ? input.effort
      : input.activeSkill?.effort ?? baseAgent.effort,
    activeSkill: input.activeSkill ?? null,
    scope: input.scope,
  };
}

async function runClaimedIssue(
  config: Config,
  project: ProjectConfig,
  issue: ClaimedRun,
  workerToken: string,
  signal: AbortSignal,
  reportCheckpoint?: (value: WorkerExecutionCheckpoint) => void,
) {
  const runtimeDirectory = issueWorkerSessionDirectory(configDirectory, issue);
  const runtimeConfig = structuredClone(config);
  runtimeConfig.projects = runtimeConfig.projects.map((candidate) =>
    candidate.id === project.id
      ? {
          ...candidate,
          activeClaim: {
            runId: issue.runId,
            sourceKey: issue.sourceKey,
            token: issue.claimToken,
            leaseExpiresAt: issue.leaseExpiresAt,
          },
        }
      : candidate,
  );
  await saveConfigAt(runtimeDirectory, runtimeConfig);
  try {
    await runClaimedIssueInRuntime(
      runtimeConfig,
      project,
      issue,
      workerToken,
      signal,
      runtimeDirectory,
      reportCheckpoint,
    );
  } finally {
    await rm(runtimeDirectory, { recursive: true, force: true });
  }
}

async function runClaimedIssueInRuntime(
  config: Config,
  project: ProjectConfig,
  issue: ClaimedRun,
  workerToken: string,
  signal: AbortSignal,
  runtimeDirectory: string,
  reportCheckpoint?: (value: WorkerExecutionCheckpoint) => void,
) {
  const execution = issue.execution ??
    (issue.agent
      ? {
          provider: issue.agent.provider,
          model: issue.agent.model,
          effort: issue.agent.effort,
        }
      : null);
  if (!execution) {
    throw new Error("이 실행에 사용할 프로바이더가 지정되지 않았습니다.");
  }
  const activeProject =
    config.projects.find((candidate) => candidate.id === project.id) ?? project;
  const executionRpc = createAuthenticatedWorkerExecutionClient(
    config.apiUrl,
    workerToken,
  );
  const runEventTarget = {
    case: "work" as const,
    value: workClaimIdentityToProto(issue),
  };
  const { workspace, workspaceError } = await allocateClaimWorkspace(
    config,
    activeProject,
    issue,
    runtimeDirectory,
  );
  if (!workspace?.path) {
    throw new Error(
      `Worker workspace allocation failed: ${workspaceError ?? "no workspace"}`,
    );
  }
  reportCheckpoint?.({ workspacePath: workspace.path });

  const provider = execution.provider;
  const attachments = await Promise.all(
    issue.attachments.map(async (attachment) => {
      try {
        return {
          ...attachment,
          localPath: await downloadClaimAttachment(
            config.apiUrl,
            workerToken,
            project.id,
            issue.runId,
            attachment,
            runtimeDirectory,
          ),
          downloadError: null,
        };
      } catch (error) {
        return {
          ...attachment,
          localPath: null,
          downloadError: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  const logicalAgent = issue.agent
    ? detachedAgentWithActiveSkill(issue.agent, issue.activeSkill)
    : null;
  const prompt = detachedAgentPrompt({
    agent: logicalAgent,
    snapshot: {
      runId: issue.runId,
      runNumber: issue.runNumber,
      currentAttempt: issue.currentAttempt,
      currentRevision: issue.currentRevision,
      source: issue.source,
      sourceKey: issue.sourceKey,
      title: issue.title,
      issueDescription: issue.description,
      briarIssueUrl: briarIssueUrl(
        config.apiUrl,
        project.id,
        issue.runId,
      ),
      priority: issue.priority,
      sourceCreatedAt: issue.sourceCreatedAt,
      createdByUserId: issue.createdByUserId,
      context: issue.context,
      reviewFeedback: issue.reviewFeedback,
      workflow: issue.workflow,
      startStage: issue.startStage,
      resumeContext: issue.resumeContext,
      attachments,
      conversation: issue.messages,
    },
    workspacePath: workspace.path,
    startStage: issue.startStage,
    resumeContext: issue.resumeContext,
  });
  const fullAccess = activeProject.autoHunt?.sandbox?.fullAccess ?? true;
  const sessionId = detachedTranscriptSessionId(
    issue.runId,
    issue.executionId,
  );
  const environment = providerExecutionEnvironment(config, provider, {
    ...process.env,
    PATH: workerExecutionPath(),
    BRIAR_CLI: workerCliPath(),
    BRIAR_WORKER_TOKEN: workerToken,
    BRIAR_PROJECT_ID: project.id,
    BRIAR_CONFIG_HOME: runtimeDirectory,
  });

  const detachedAgent: DetachedAgent = {
    id: logicalAgent?.id ?? issue.runId,
    name: logicalAgent?.name ?? "Briar Worker",
    provider: execution.provider,
    model: execution.model,
    effort: execution.effort,
    responsibility: logicalAgent?.responsibility ?? "",
    skill: logicalAgent?.skill ?? "",
    skills: logicalAgent?.skills ?? [],
    activeSkill: logicalAgent?.activeSkill ?? null,
  };
  const providerAttachments = agentImageAttachments(attachments);

  const executionStartedAt = Date.now();
  const transcriptSequencer = createDetachedTranscriptSequencer(
    issue.claimAttempts,
  );
  const usageCollector = createAgentExecutionUsageCollector(provider, {
    configuredModel: execution.model,
  });
  const transcriptBatcher = createWorkerTranscriptBatcher({
    apiUrl: config.apiUrl,
    token: workerToken,
    projectId: project.id,
    work: issue,
    sessionId,
    agentProvider: provider,
    onError: (error) => {
      console.error(
        `transcript upload failed for ${issue.sourceKey}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    },
  });
  let conversationId: string | null = issue.handoffContext?.conversationId ?? null;
  if (conversationId) reportCheckpoint?.({ conversationId });
  let nextPrompt = prompt;
  let turnNumber = 0;
  let consecutiveProviderTurnFailures = 0;
  try {
    for (;;) {
      turnNumber += 1;
      let runnerBlock: ReturnType<typeof detachedProviderBlockFromPayload> = null;
      const turn = await runDetachedProviderTurn({
        agent: detachedAgent,
        prompt: nextPrompt,
        workspacePath: workspace.path,
        fullAccess,
        conversationId,
        attachments:
          turnNumber === 1 || !conversationId
            ? providerAttachments
            : undefined,
        environment,
        signal,
        diagnosticContext: {
          runId: issue.runId,
          workId: issue.runId,
          executionId: issue.executionId ?? null,
          attempt: issue.currentAttempt,
          workType: "issue",
          turnNumber,
        },
        onDiagnostic: logDetachedProviderTurnDiagnostic,
        onConversationId: (nextConversationId) => {
          conversationId = nextConversationId;
          reportCheckpoint?.({ conversationId: nextConversationId });
        },
        onPayload: async (output, line) => {
          usageCollector.observe(
            sidecarProviderRaw(output),
            new Date().toISOString(),
          );
          runnerBlock ??= detachedProviderBlockFromPayload(output);
          const direction = detachedPayloadDirection(output);
          const payload = detachedTranscriptPayload(output, line);
          const transcriptSequence = transcriptSequencer.nextForPayload(payload);
          if (transcriptSequence !== null) {
            await transcriptBatcher.enqueue({
              sequence: transcriptSequence,
              direction,
              payload,
            });
          }
        },
      });
      await transcriptBatcher.flush();
      conversationId = turn.conversationId;
      if (runnerBlock) {
        await executionRpc.recordRunEvent(
          workerRunEventRequest({
            projectId: project.id,
            target: runEventTarget,
            event: detachedProviderBlockedRunEvent({
              block: runnerBlock,
              runId: issue.runId,
              attempt: issue.currentAttempt,
              actor: `briar-worker:${activeProject.executionWorker?.workerId ?? "unknown"}`,
              repository: issue.repository,
              model: execution.model,
              occurredAt: new Date().toISOString(),
            }),
          }),
        );
        return;
      }
      const turnFailure = detachedProviderTurnFailure(turn);

      const runtimeConfig = decodeConfig(
        JSON.parse(await readFile(join(runtimeDirectory, "config.json"), "utf8")),
      );
      const disposition = detachedRunDisposition(
        runtimeConfig.projects.find((candidate) => candidate.id === project.id)
          ?.activeClaim,
        issue.runId,
      );
      const turnDecision = detachedRunTurnDecision(disposition, turnFailure);
      if (turnDecision === "stop") return;

      if (turnDecision === "recover" && turnFailure) {
        consecutiveProviderTurnFailures += 1;
        console.error(
          `recovering ${issue.sourceKey}: agent turn ${turnNumber} failed while the run remained active: ${turnFailure}`,
        );
        nextPrompt = detachedRunRecoveryPrompt({
          runId: issue.runId,
          sourceKey: issue.sourceKey,
          failure: turnFailure,
        });
        if (!conversationId) {
          nextPrompt = `${nextPrompt}\n\nThe provider did not return a reusable conversation ID, so the durable issue context follows again.\n\n${prompt}`;
        }
        await interruptibleSleep(
          errorDelayMs(consecutiveProviderTurnFailures, 30_000),
          signal,
        );
        continue;
      }
      consecutiveProviderTurnFailures = 0;

      console.error(
        `continuing ${issue.sourceKey}: agent turn ${turnNumber} ended while the run remained active`,
      );
      nextPrompt = detachedRunContinuationPrompt({
        runId: issue.runId,
        sourceKey: issue.sourceKey,
      });
      if (!conversationId) {
        nextPrompt = `${nextPrompt}\n\nThe provider did not return a reusable conversation ID, so the durable issue context follows again.\n\n${prompt}`;
      }
    }
  } catch (error) {
    if (!signal.aborted) {
      try {
        await executionRpc.recordRunEvent(
          workerRunEventRequest({
            projectId: project.id,
            target: runEventTarget,
            event: {
              status: "failed",
              workflowStage: null,
              eventKey: `detached:${issue.currentAttempt}:agent-failed`,
              occurredAt: new Date().toISOString(),
              actor: `briar-worker:${activeProject.executionWorker?.workerId ?? "unknown"}`,
              repository: issue.repository,
              detail: error instanceof Error ? error.message : String(error),
              pullRequestUrls: [],
            },
          }),
        );
      } catch {
        // A cancellation or reassignment invalidates the claim before the
        // process exits. That expected late write must not hide the root error.
      }
    }
    throw error;
  } finally {
    await transcriptBatcher.flush();
    const usageObservations = usageCollector.finish();
    const usageRecords = agentExecutionUsageRecordsFromObservations(
      usageObservations,
    );
    const costRecords = agentExecutionCostRecordsFromObservations(
      usageCollector.finishCosts(),
    );
    const executionMetrics = agentExecutionMetrics(
      Date.now() - executionStartedAt,
      agentExecutionTokenUsageFromObservations(usageObservations),
    );
    try {
      await reportIssueExecutionTelemetry({
        apiUrl: config.apiUrl,
        token: workerToken,
        projectId: project.id,
        work: issue,
        agentProvider: provider,
        executionMetrics,
        usageObservations: usageRecords,
        costObservations: costRecords,
      });
    } catch (error) {
      console.error(
        `execution metrics upload failed for ${issue.sourceKey}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (workspace.type === "worktree") {
      try {
        let completedAt: string | undefined;
        try {
          const runtimeConfig = decodeConfig(
            JSON.parse(await readFile(join(runtimeDirectory, "config.json"), "utf8")),
          );
          const runtimeClaim = runtimeConfig.projects.find(
            (candidate) => candidate.id === project.id,
          )?.activeClaim;
          if (
            runtimeClaim?.runId === issue.runId &&
            runtimeClaim.terminalStatus === "completed"
          ) {
            completedAt = runtimeClaim.finishedAt;
          }
        } catch {
          // Maintenance still compacts reproducible artifacts without a
          // completion timestamp; deletion remains disabled.
        }
        if (completedAt) {
          await recordCompletedWorktree(
            projectWorktreeRoot(worktreeSettings(project).root, project.id),
            {
              runId: issue.runId,
              path: workspace.path,
              branch: workspace.branch,
              completedAt,
            },
          );
        }
        const maintenance = await maintainTerminalIssueWorktree(
          runGit,
          project.repositoryPath,
          { path: workspace.path, branch: workspace.branch },
          { baseRef: workspace.baseRef, ...(completedAt ? { completedAt } : {}) },
        );
        console.error(
          `worktree maintenance for ${issue.sourceKey}: ${JSON.stringify(maintenance)}`,
        );
      } catch (error) {
        console.error(
          `worktree maintenance failed for ${issue.sourceKey}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}

export {
  activeReplyActivityPublishers,
  activeCachedAnalysisWorktreePaths,
  retainCachedAnalysisWorktree,
  releaseCachedAnalysisWorktree,
  detachedAgentWithActiveSkill,
  detachedReplyAgent,
  runClaimedIssue,
  runClaimedIssueInRuntime,
};
